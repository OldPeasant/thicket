import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { type Document, MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'doc_paging_e2e';
const COLL = 'big';
const ITEMS = 50_000;

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

const sku = (i: number) => `SKU-${String(i).padStart(6, '0')}`;

/**
 * One document with a 50 000-item array (about 2 MB of BSON, above the 1 MiB large-document
 * threshold), and the profiler on: `system.profile` is the log of every command the app sends.
 */
async function seed(uri: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const db = client.db(DB);
    await db.dropDatabase();
    await db.collection<{ _id: string; name: string; items: unknown[] }>(COLL).insertOne({
      _id: 'big',
      name: 'large order',
      items: Array.from({ length: ITEMS }, (_, i) => ({ sku: sku(i), qty: i })),
    });
    await db.command({ profile: 2 });
  } finally {
    await client.close();
  }
}

/** The commands the app sent to the collection (the server's profiler), oldest first. */
async function commandLog(uri: string): Promise<Document[]> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await client
      .db(DB)
      .collection('system.profile')
      .find({ ns: `${DB}.${COLL}`, 'command.comment': { $regex: '^thicket:' } })
      .sort({ ts: 1 })
      .toArray();
  } finally {
    await client.close();
  }
}

/** The `[skip, limit]` of each `docs.getSlice` aggregation in the log. */
function sliceReads(log: Document[]): [number, number][] {
  return log
    .filter((entry) => entry['op'] === 'command' && entry['command']?.aggregate === COLL)
    .map((entry) => entry['command'].pipeline?.[2]?.$project?.items?.$cond?.[1]?.$slice)
    .filter((slice): slice is [string, number, number] => Array.isArray(slice))
    .map(([, skip, limit]) => [skip, limit]);
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('a 50 000-item array document opens in < 2 s and pages via docs.getSlice', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await seed(mongo.uri);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Big', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();

  const conn = treeNode(window, 'conn', 'Big');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();

  // Open the collection: the document and the first page of its items show within 2 s.
  const pager = window.getByTestId('nested-pager');
  const range = window.getByTestId('nested-pager-range');
  const started = Date.now();
  await treeNode(window, 'coll', COLL).click();
  await expect(range).toHaveText('1–100 of 50,000 items', { timeout: 2_000 });
  const openMs = Date.now() - started;
  console.log(`opened the 50 000-item document in ${openMs} ms`);
  expect(openMs).toBeLessThan(2_000);
  await expect(window.getByText(sku(0), { exact: true })).toBeVisible();
  await expect(window.getByTestId('slice-note')).toBeVisible();

  // The find sent only the first page of items: the log has the find, no slice read yet.
  let log = await commandLog(mongo.uri);
  expect(log.some((entry) => entry['command']?.find === COLL)).toBe(true);
  expect(sliceReads(log)).toEqual([]);

  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'doc-paging-open.png'));

  // Next page: items 101–200, read with docs.getSlice.
  await pager.getByTestId('nested-pager-next').click();
  await expect(range).toHaveText('101–200 of 50,000 items');
  await expect(window.getByText(sku(100), { exact: true })).toBeVisible();
  await expect(window.getByText(sku(0), { exact: true })).toHaveCount(0);

  // Jump to page 400: items 39 901–40 000.
  await pager.getByTestId('nested-pager-page').fill('400');
  await pager.getByTestId('nested-pager-page').press('Enter');
  await expect(range).toHaveText('39,901–40,000 of 50,000 items');
  await expect(window.getByText(sku(39_900), { exact: true })).toBeVisible();

  // Last page, then back to the first (loaded with the document: no read).
  await pager.getByTestId('nested-pager-last').click();
  await expect(range).toHaveText('49,901–50,000 of 50,000 items');
  await expect(window.getByText(sku(49_999), { exact: true })).toBeVisible();
  await screenshot(electronApp, window, join(SHOTS, 'doc-paging-last.png'));
  await pager.getByTestId('nested-pager-first').click();
  await expect(window.getByText(sku(0), { exact: true })).toBeVisible();

  log = await commandLog(mongo.uri);
  expect(sliceReads(log)).toEqual([
    [100, 100],
    [39_900, 100],
    [49_900, 100],
  ]);
});
