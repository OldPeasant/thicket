import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { BSON, Decimal128, Int32, MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

// "Undo last save" (undo-last-save): Thicket keeps the pre-save version of a document's last save
// and writes it back with the same conflict check as Save. The server state is checked with the
// driver.

const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');
const DB = 'undo_save_e2e';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

interface Order {
  _id: number;
  status?: string;
  total?: Decimal128;
  qty?: Int32;
}

async function withColl<T>(
  uri: string,
  coll: string,
  body: (c: import('mongodb').Collection<Order>) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await body(client.db(DB).collection<Order>(coll));
  } finally {
    await client.close();
  }
}

/** Three orders `{_id: i, status, total: Decimal128, qty: Int32}`. */
async function seed(uri: string, coll: string): Promise<void> {
  await withColl(uri, coll, async (c) => {
    await c.drop().catch(() => undefined);
    await c.insertMany(
      [1, 2, 3].map((i) => ({
        _id: i,
        status: 'open',
        total: Decimal128.fromString(`${i}0.50`),
        qty: new Int32(i),
      })),
    );
  });
}

/** The stored document as canonical EJSON (types and field order kept). */
async function storedText(uri: string, coll: string, id: number): Promise<string> {
  const doc = await withColl(uri, coll, (c) => c.findOne({ _id: id }, { promoteValues: false }));
  return BSON.EJSON.stringify(doc, { relaxed: false });
}

async function saveProfile(window: Page, uri: string): Promise<void> {
  const response = await window.evaluate(
    (connectionString) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: 'save-local',
        method: 'profiles.save',
        params: {
          profile: { name: 'Local', connectionString, readOnly: false, production: false },
        },
      }),
    uri,
  );
  expect(response).toMatchObject({ ok: true });
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

async function openCollection(window: Page, coll: string): Promise<void> {
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Local');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', coll).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–3');
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(3);
  await window.getByTestId('edit-mode').click();
  await expect(window.getByTestId('edit-mode')).toHaveAttribute('aria-pressed', 'true');
}

async function typeValue(window: Page, n: number, key: string, value: string): Promise<void> {
  const input = window
    .getByTestId('result-doc')
    .nth(n)
    .locator(`.field[data-node$=".${key}"] app-bson-input input`)
    .first();
  await input.fill(value);
  await input.press('Tab');
}

/** Edits two fields of the first document and saves them. */
async function editAndSave(window: Page): Promise<void> {
  await typeValue(window, 0, 'total', '99.95');
  await typeValue(window, 0, 'qty', '7');
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
}

test('save, then Undo last save: the server document equals the original', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo';
  await seed(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  const first = window.getByTestId('result-doc').first();
  await expect(first.getByTestId('doc-undo-save')).toHaveCount(0);
  await editAndSave(window);
  expect(await storedText(mongo.uri, coll, 1)).not.toBe(original);

  const undo = first.getByTestId('doc-undo-save');
  await expect(undo).toBeEnabled();
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'undo-last-save-offered.png'));
  await undo.click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');

  // Checked with the driver: the same fields, types and order as before the save.
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
  await expect(undo).toHaveCount(0);
  await expect(window.getByTestId('edit-count')).toHaveCount(0);
});

test('Undo last save reports a conflict instead of overwriting a newer server change', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_conflict';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await editAndSave(window);
  // Another client changes a saved field.
  await withColl(mongo.uri, coll, (c) => c.updateOne({ _id: 1 }, { $set: { qty: new Int32(8) } }));
  const changed = await storedText(mongo.uri, coll, 1);

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  const message = window.getByTestId('edit-message');
  await expect(message).toContainText(
    'Not undone: the document was changed on the server since the save.',
  );
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'undo-last-save-conflict.png'));

  // Nothing was overwritten.
  expect(await storedText(mongo.uri, coll, 1)).toBe(changed);
  await expect(window.getByTestId('result-doc').first().getByTestId('doc-undo-save')).toHaveCount(
    0,
  );
});

/** Deletes the top-level field `key` of the first document with its "Delete key" button and saves. */
async function removeFieldAndSave(window: Page, key: string): Promise<void> {
  await window
    .getByTestId('result-doc')
    .first()
    .locator(`.field[data-node$=".${key}"] .del-btn`)
    .first()
    .click();
  await expect(window.getByTestId('edit-count')).toHaveText('1 change');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
}

// Added by the test-writer: a save that removes a field. MongoDB appends a field that $set adds
// back, so only the replace path restores the original field order.
test('Undo last save of a removed field restores it in its original place', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_removed';
  await seed(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await removeFieldAndSave(window, 'status');
  const saved = await withColl(mongo.uri, coll, (c) => c.findOne({ _id: 1 }));
  expect(saved).not.toHaveProperty('status');

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');
  // Same fields, types and order (status before total again).
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
});

// Added by the test-writer, TW-1: the undo of a field removal replaces the whole document, but
// its conflict check covers only the removed field, so a newer server change to another field
// would be overwritten. Expected (acceptance criterion 2): a conflict, nothing overwritten.
test('Undo last save of a removed field does not overwrite a newer change to another field', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_removed_conflict';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await removeFieldAndSave(window, 'status');
  // Another client changes qty, a field the save did not touch.
  await withColl(mongo.uri, coll, (c) => c.updateOne({ _id: 1 }, { $set: { qty: new Int32(8) } }));
  const changed = await storedText(mongo.uri, coll, 1);

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toContainText('Not undone');

  expect(await storedText(mongo.uri, coll, 1)).toBe(changed);
});
