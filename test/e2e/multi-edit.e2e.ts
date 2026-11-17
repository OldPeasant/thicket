import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Int32, MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

// Edit a field across selected rows (multi-doc-edit): in the table view, select rows while
// editing, set or remove one field, and save them together: one confirm dialog with the document
// count, one conflict-checked updateOne per document.

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'multi_edit_e2e';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

async function saveProfile(window: Page, name: string, uri: string): Promise<void> {
  const response = await window.evaluate(
    (p) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `save-${p.name}`,
        method: 'profiles.save',
        params: {
          profile: { name: p.name, connectionString: p.uri, readOnly: false, production: false },
        },
      }),
    { name, uri },
  );
  expect(response).toMatchObject({ ok: true });
}

interface Order {
  _id: number;
  status?: string;
  qty?: Int32;
  note?: string;
}

async function withClient<T>(uri: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Four orders `{_id: i, status: 'open', qty: Int32(i), note}` in `coll`. */
async function seed(uri: string, coll: string): Promise<void> {
  await withClient(uri, async (client) => {
    const c = client.db(DB).collection<Order>(coll);
    await c.drop().catch(() => undefined);
    await c.insertMany(
      [1, 2, 3, 4].map((i) => ({ _id: i, status: 'open', qty: new Int32(i), note: `n${i}` })),
    );
  });
}

/** All stored orders of `coll` by `_id`, with BSON types kept. */
async function storedAll(uri: string, coll: string): Promise<Order[]> {
  return withClient(uri, (client) =>
    client
      .db(DB)
      .collection<Order>(coll)
      .find({}, { promoteValues: false })
      .sort({ _id: 1 })
      .toArray(),
  );
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** Connects, opens the collection in the table view and turns on edit mode. */
async function openTable(window: Page, profile: string, coll: string): Promise<void> {
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', profile);
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', coll).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–4');
  await expect(window.getByTestId('view-table')).toHaveAttribute('aria-pressed', 'true');
  // No checkboxes before editing.
  await expect(window.getByTestId('row-select')).toHaveCount(0);
  await window.getByTestId('edit-mode').click();
  await expect(window.getByTestId('row-select')).toHaveCount(4);
}

/** Selects the first three rows and fills "status set to <value>". */
async function selectThreeAndSet(window: Page, value: string): Promise<void> {
  for (const n of [0, 1, 2]) await window.getByTestId('row-select').nth(n).check();
  await expect(window.getByTestId('multi-edit-count')).toHaveText('3 rows selected');
  await window.getByTestId('multi-edit-field').fill('status');
  await window.getByTestId('multi-edit-value').fill(value);
  await expect(window.getByTestId('multi-edit-save')).toHaveText('Save 3 documents');
}

test('select 3 rows, set a field, save: 3 documents updated', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_multi';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Local', mongo.uri);
  await openTable(window, 'Local', coll);

  await selectThreeAndSet(window, '"shipped"');
  await screenshot(electronApp, window, join(SHOTS, 'multi-edit-selected.png'));
  await window.getByTestId('multi-edit-save').click();

  // One confirm dialog for the batch, with the number of documents.
  const dialog = window.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Update 3 documents');
  await expect(window.getByTestId('confirm-detail')).toContainText('Updates 3 documents');
  await expect(window.getByTestId('confirm-operation')).toContainText('updateOne');
  await expect(window.getByTestId('confirm-operation')).toContainText('"shipped"');
  await screenshot(electronApp, window, join(SHOTS, 'multi-edit-confirm.png'));
  await window.getByTestId('confirm-ok').click();
  await expect(dialog).toHaveCount(0);

  await expect(window.getByTestId('multi-edit-summary')).toHaveText('Saved 3 documents.');
  const docs = await storedAll(mongo.uri, coll);
  expect(docs.map((d) => d.status)).toEqual(['shipped', 'shipped', 'shipped', 'open']);
  // Only the field changed: the other fields keep their values and BSON types.
  expect(docs.map((d) => d.qty)).toEqual([1, 2, 3, 4].map((i) => new Int32(i)));
  expect(docs.map((d) => d.note)).toEqual(['n1', 'n2', 'n3', 'n4']);
  // The page shows the saved values (read back); the selection stays for another edit.
  await expect(window.getByTestId('multi-edit-count')).toHaveText('3 rows selected');

  // Remove a field across the same rows (still selected).
  await window.getByTestId('multi-edit-field').fill('note');
  await window.getByTestId('multi-edit-action').selectOption('unset');
  await window.getByTestId('multi-edit-save').click();
  await window.getByTestId('confirm-ok').click();
  await expect(window.getByTestId('multi-edit-summary')).toHaveText('Saved 3 documents.');
  const after = await storedAll(mongo.uri, coll);
  expect(after.map((d) => d.note)).toEqual([undefined, undefined, undefined, 'n4']);
  await window.getByTestId('view-raw').click();
  await expect(window.getByTestId('raw-text')).toContainText('status: "shipped"');
});

test('one document changed on the server: it is reported, the others are saved', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_conflict';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Local', mongo.uri);
  await openTable(window, 'Local', coll);

  await selectThreeAndSet(window, '"shipped"');
  // Someone else changes document 2 after it was loaded.
  await withClient(mongo.uri, (client) =>
    client
      .db(DB)
      .collection<Order>(coll)
      .updateOne({ _id: 2 }, { $set: { status: 'held' } }),
  );
  await window.getByTestId('multi-edit-save').click();
  await expect(window.getByTestId('confirm-detail')).toContainText('Updates 3 documents');
  await window.getByTestId('confirm-ok').click();

  await expect(window.getByTestId('multi-edit-summary')).toContainText('Saved 2 documents.');
  await expect(window.getByTestId('multi-edit-summary')).toContainText('1 not saved');
  await expect(window.getByTestId('multi-edit-conflict')).toHaveCount(1);
  await expect(window.getByTestId('multi-edit-conflict')).toContainText('2');
  await expect(window.getByTestId('multi-edit-conflict')).toContainText(
    'changed on the server since it was loaded',
  );
  await screenshot(
    electronApp,
    window.getByTestId('multi-edit'),
    join(SHOTS, 'multi-edit-conflict.png'),
  );
  const docs = await storedAll(mongo.uri, coll);
  // The conflicting document keeps the server's change; the others are saved.
  expect(docs.map((d) => d.status)).toEqual(['shipped', 'held', 'shipped', 'open']);
  // The page now shows the server version of the conflicting document and the saved ones.
  await window.getByTestId('view-raw').click();
  const raw = window.getByTestId('raw-text');
  await expect(raw).toContainText('status: "held"');
  await expect(raw).toContainText('status: "shipped"');
});

test('one document deleted on the server: the report stays, the others are saved', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_deleted';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Local', mongo.uri);
  await openTable(window, 'Local', coll);

  await selectThreeAndSet(window, '"shipped"');
  // Someone else deletes document 1 (the first selected row) after it was loaded.
  await withClient(mongo.uri, (client) =>
    client.db(DB).collection<Order>(coll).deleteOne({ _id: 1 }),
  );
  await window.getByTestId('multi-edit-save').click();
  await expect(window.getByTestId('confirm-detail')).toContainText('Updates 3 documents');
  await window.getByTestId('confirm-ok').click();

  // The batch report is still shown after the deleted row left the page.
  await expect(window.getByTestId('multi-edit-summary')).toHaveText(
    'Saved 2 documents. 1 not saved: deleted on the server since they were loaded (removed from the page).',
  );
  await expect(window.getByTestId('multi-edit-conflict')).toHaveCount(1);
  await expect(window.getByTestId('multi-edit-conflict')).toContainText(
    'deleted on the server since it was loaded',
  );
  const docs = await storedAll(mongo.uri, coll);
  expect(docs.map((d) => [Number(d._id), d.status])).toEqual([
    [2, 'shipped'],
    [3, 'shipped'],
    [4, 'open'],
  ]);
  // Rows 2 and 3 moved up and stay selected; row 4 is not selected.
  const boxes = window.getByTestId('row-select');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(2)).not.toBeChecked();
  await expect(window.getByTestId('multi-edit-count')).toHaveText('2 rows selected');
});
