import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'bulk_e2e';
const COLL = 'orders';
const OPEN = 1_500;
const CLOSED = 120;

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

async function withClient<T>(uri: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** 1 500 open and 120 closed orders. */
async function seed(uri: string): Promise<void> {
  await withClient(uri, async (client) => {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    const docs = Array.from({ length: OPEN + CLOSED }, (_, i) => ({
      n: i,
      status: i < OPEN ? 'open' : 'closed',
    }));
    await client.db(DB).collection(COLL).insertMany(docs);
  });
}

async function countOf(uri: string, filter: object): Promise<number> {
  return withClient(uri, (client) => client.db(DB).collection(COLL).countDocuments(filter));
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** The digits of a count as shown ("1 500" with narrow no-break spaces → 1500). */
async function shownCount(locator: Locator): Promise<number> {
  return Number((await locator.innerText()).replace(/\D/g, ''));
}

test('updateMany on 1 500 documents needs the collection name typed; preview count = result', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await seed(mongo.uri);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Bulk', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Bulk');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  // Apply the filter in the query bar; the bulk panel works on the applied query.
  await window.getByTestId('query-filter').fill('{ status: "open" }');
  await window.getByTestId('query-run').click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  await window.getByTestId('bulk-open').click();
  const panel = window.getByTestId('bulk-panel');
  await expect(panel).toBeVisible();
  await expect(window.getByTestId('bulk-execute')).toBeDisabled();
  await window.getByTestId('bulk-update').fill('{ $set: { status: "archived" }, $inc: { n: 0 } }');
  await expect(window.getByTestId('bulk-command')).toContainText(
    'db.orders.updateMany({ status: "open" }, { $set: { status: "archived" }, $inc: { n: 0 } })',
  );
  await window.getByTestId('bulk-preview').click();
  const matched = window.getByTestId('bulk-matched');
  await expect(matched).toBeVisible();
  const previewed = await shownCount(matched);
  expect(previewed).toBe(OPEN);
  await expect(window.getByTestId('bulk-sample-doc').first()).toContainText('status: "open"');
  await panel.screenshot({ path: join(SHOTS, 'bulk-preview.png') });

  // Over 1 000 documents: the dialog only confirms once the collection name is typed.
  await window.getByTestId('bulk-execute').click();
  const dialog = window.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(window.getByTestId('confirm-operation')).toContainText('updateMany(');
  const ok = window.getByTestId('confirm-ok');
  await expect(ok).toBeDisabled();
  await window.getByTestId('confirm-type').fill('order');
  await expect(ok).toBeDisabled();
  await window.screenshot({ path: join(SHOTS, 'bulk-confirm.png') });
  // Nothing was written while the dialog waits.
  expect(await countOf(mongo.uri, { status: 'archived' })).toBe(0);
  await window.getByTestId('confirm-type').fill(COLL);
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(dialog).toBeHidden();

  const outcome = window.getByTestId('bulk-outcome');
  await expect(outcome).toContainText('Updated');
  const text = (await outcome.innerText()).replace(/\u202f/g, ' ');
  // "Updated 1 500 documents (1 500 matched)."
  const [modified, executed] = (text.match(/\d[\d ]*\d/g) ?? []).map((s) =>
    Number(s.replace(/\D/g, '')),
  );
  expect(executed).toBe(previewed);
  expect(modified).toBe(previewed);
  expect(await countOf(mongo.uri, { status: 'archived' })).toBe(OPEN);
  expect(await countOf(mongo.uri, { status: 'closed' })).toBe(CLOSED);
  // The tab reads its page again: no open orders are left for the filter.
  await expect(window.getByTestId('pager-rows')).toContainText('No documents');
});

test('deleteMany: preview count equals the deleted count; cancel deletes nothing', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await seed(mongo.uri);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Bulk', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Bulk');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await window.getByTestId('query-filter').fill('{ status: "closed" }');
  await window.getByTestId('query-run').click();

  await window.getByTestId('bulk-open').click();
  await window.getByTestId('bulk-mode-delete').click();
  await expect(window.getByTestId('bulk-command')).toContainText(
    'db.orders.deleteMany({ status: "closed" })',
  );
  await window.getByTestId('bulk-preview').click();
  const previewed = await shownCount(window.getByTestId('bulk-matched'));
  expect(previewed).toBe(CLOSED);
  await window.getByTestId('bulk-panel').screenshot({ path: join(SHOTS, 'bulk-delete.png') });

  await window.getByTestId('bulk-execute').click();
  await expect(window.getByTestId('confirm-type')).toHaveCount(0);
  await window.getByTestId('confirm-cancel').click();
  expect(await countOf(mongo.uri, {})).toBe(OPEN + CLOSED);

  await window.getByTestId('bulk-execute').click();
  await window.getByTestId('confirm-ok').click();
  const outcome = window.getByTestId('bulk-outcome');
  await expect(outcome).toContainText('Deleted');
  expect(await shownCount(outcome)).toBe(previewed);
  expect(await countOf(mongo.uri, {})).toBe(OPEN);
});
