import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'collection_e2e';
const COLL = 'orders';
const TOTAL = 10_000;

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

/** 10 000 documents `{_id: i, n: i, group: i % 3, name: "order i"}`. */
async function seed(uri: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const coll = client.db(DB).collection<{ _id: number }>(COLL);
    await coll.drop().catch(() => undefined);
    await coll.insertMany(
      Array.from({ length: TOTAL }, (_, i) => ({ _id: i, n: i, group: i % 3, name: `order ${i}` })),
    );
  } finally {
    await client.close();
  }
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** The `n` of the first document shown in the raw (shell syntax) view. */
async function firstN(window: Page): Promise<number> {
  const text = (await window.getByTestId('raw-text').textContent()) ?? '';
  const match = /n: (\d+)/.exec(text);
  if (!match?.[1]) throw new Error(`no n in raw view: ${text.slice(0, 200)}`);
  return Number(match[1]);
}

test('filter and sort 10 000 documents, page, jump to the last page, count exactly', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await seed(mongo.uri);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Paging', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();

  const conn = treeNode(window, 'conn', 'Paging');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();

  // Opening the tab shows page 1 of the whole collection with the estimated count.
  const rows = window.getByTestId('pager-rows');
  await expect(rows).toContainText('1–50');
  await expect(rows).toContainText('~10,000');
  await expect(window.getByTestId('pager-pages')).toHaveText('of ~200');
  // The table view has one row per document.
  await expect(
    window.locator('app-json-explorer .json-output > app-json-table > .tw tbody > tr'),
  ).toHaveCount(50);

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'collection-table.png') });

  // An invalid filter shows the parse error and does not run.
  await window.getByTestId('query-filter').fill('{ group: 1');
  await window.getByTestId('query-run').click();
  await expect(window.getByTestId('query-error-filter')).toContainText('line 1');
  await expect(rows).toContainText('~10,000');
  await window.screenshot({ path: join(SHOTS, 'collection-parse-error.png') });

  // Filter + sort: 3 333 documents with group 1, highest n first (range paging on n, _id).
  await window.getByTestId('query-filter').fill('{ group: 1 }');
  await window.getByTestId('query-sort').fill('{ n: -1, _id: 1 }');
  await window.getByTestId('query-filter').press('Enter');
  await expect(window.getByTestId('query-error-filter')).toHaveCount(0);
  await expect(rows).toHaveText('1–50');
  await window.getByTestId('view-raw').click();
  expect(await firstN(window)).toBe(9997);

  // Page 3: two pages on, then the jump field agrees.
  await window.getByTestId('pager-next').click();
  await expect(rows).toHaveText('51–100');
  await window.getByTestId('pager-next').click();
  await expect(rows).toHaveText('101–150');
  await expect(window.getByTestId('pager-page')).toHaveValue('3');
  expect(await firstN(window)).toBe(9997 - 3 * 100);

  // Jump to page 5 by number, then to the last page.
  await window.getByTestId('pager-page').fill('5');
  await window.getByTestId('pager-page').press('Enter');
  await expect(rows).toHaveText('201–250');
  expect(await firstN(window)).toBe(9997 - 3 * 200);

  await window.getByTestId('pager-last').click();
  await expect(rows).toHaveText('Last 50');
  await expect(window.getByTestId('pager-next')).toBeDisabled();
  // The lowest n of group 1 come last: 148 … 1.
  expect(await firstN(window)).toBe(148);

  // Exact count: 3 333 documents, so the last page is page 67 with rows 3 301–3 333 (read again
  // with its real size).
  await window.getByTestId('pager-count').click();
  await expect(rows).toContainText('of 3,333 documents');
  await expect(rows).toContainText('3,301–3,333');
  expect(await firstN(window)).toBe(97);
  await expect(window.getByTestId('pager-pages')).toHaveText('of 67');
  await expect(window.getByTestId('pager-page')).toHaveValue('67');
  await window.screenshot({ path: join(SHOTS, 'collection-last-page.png') });

  // The document list view shows the same page.
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(33);
  await window.screenshot({ path: join(SHOTS, 'collection-list.png') });
});
