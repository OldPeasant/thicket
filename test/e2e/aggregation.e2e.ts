import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'agg_e2e';
const COLL = 'orders';
const CUSTOMERS = ['ada', 'bob', 'cy', 'dee', 'eve'];

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

/** 400 orders: status open/closed, a customer, a Decimal128 total. */
function fixtureDocs() {
  return Array.from({ length: 400 }, (_, i) => ({
    _id: new ObjectId(),
    n: i,
    status: i % 4 === 0 ? 'closed' : 'open',
    customer: CUSTOMERS[i % CUSTOMERS.length],
    total: Decimal128.fromString(`${(i % 50) * 10}.5`),
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000),
  }));
}

async function withClient<T>(uri: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
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

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** Fills a textarea like typing would (Angular listens to `input`). */
async function fill(locator: Locator, text: string): Promise<void> {
  await locator.fill(text);
}

test('demo step 8: $match → $group → $sort with a preview per stage, export as shell and Node', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await withClient(mongo.uri, async (client) => {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.db(DB).collection(COLL).insertMany(fixtureDocs());
  });
  // What the server says the pipeline gives (the builder must show the same).
  const pipeline = [
    { $match: { status: 'open' } },
    { $group: { _id: '$customer', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
    { $sort: { revenue: -1, _id: 1 } },
  ];
  const expected = await withClient(mongo.uri, (client) =>
    client.db(DB).collection(COLL).aggregate(pipeline).toArray(),
  );
  expect(expected).toHaveLength(CUSTOMERS.length);

  await window.setViewportSize({ width: 1500, height: 1000 });
  await saveProfile(window, 'Agg', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Agg');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  // Open the builder from the collection tab.
  await window.getByTestId('open-aggregation').click();
  const builder = window.locator('app-aggregation-view');
  await expect(builder).toBeVisible();
  const stages = builder.getByTestId('agg-stage');
  await expect(stages).toHaveCount(1);

  // Stage 1: $match.
  await fill(stages.nth(0).getByTestId('agg-stage-body'), '{ status: "open" }');
  await expect(stages.nth(0).getByTestId('agg-preview-count')).toContainText('20 documents');
  await expect(stages.nth(0).getByTestId('agg-preview-doc').first()).toContainText('"open"');

  // Stage 2: $group.
  await builder.getByTestId('agg-add-stage').click();
  await stages.nth(1).getByTestId('agg-stage-operator').selectOption('$group');
  await fill(
    stages.nth(1).getByTestId('agg-stage-body'),
    '{ _id: "$customer", orders: { $sum: 1 }, revenue: { $sum: "$total" } }',
  );
  // The preview runs on a sample (100 input documents): every customer appears.
  await expect(stages.nth(1).getByTestId('agg-preview-count')).toContainText('5 documents');
  await expect(stages.nth(1).getByTestId('agg-preview-doc').first()).toContainText('revenue');

  // Stage 3: $sort.
  await builder.getByTestId('agg-add-stage').click();
  await stages.nth(2).getByTestId('agg-stage-operator').selectOption('$sort');
  await fill(stages.nth(2).getByTestId('agg-stage-body'), '{ revenue: -1, _id: 1 }');
  await expect(stages.nth(2).getByTestId('agg-preview-count')).toContainText('5 documents');
  // Each stage keeps its own preview.
  await expect(stages.nth(0).getByTestId('agg-preview-count')).toContainText('20 documents');
  await expect(stages.nth(1).getByTestId('agg-preview-count')).toContainText('5 documents');

  // A syntax error blocks only that stage's preview.
  await fill(stages.nth(2).getByTestId('agg-stage-body'), '{ revenue: -1, _id: 1');
  await expect(stages.nth(2).getByTestId('agg-stage-error')).toContainText('line 1');
  await expect(stages.nth(2).getByTestId('agg-preview-blocked')).toBeVisible();
  await expect(stages.nth(1).getByTestId('agg-preview-doc')).toHaveCount(5);
  await fill(stages.nth(2).getByTestId('agg-stage-body'), '{ revenue: -1, _id: 1 }');
  await expect(stages.nth(2).getByTestId('agg-preview-doc')).toHaveCount(5);

  // Run on the whole collection: same documents, same order as the driver's aggregate.
  await builder.getByTestId('agg-run').click();
  const results = builder.getByTestId('agg-result-doc');
  await expect(results).toHaveCount(CUSTOMERS.length);
  for (const [i, doc] of expected.entries()) {
    await expect(results.nth(i)).toContainText(`_id: "${String(doc['_id'])}"`);
    await expect(results.nth(i)).toContainText(`orders: ${String(doc['orders'])}`);
    await expect(results.nth(i)).toContainText(`NumberDecimal("${String(doc['revenue'])}")`);
  }
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'aggregation-builder.png'));

  // Export as shell code.
  await builder.getByTestId('agg-export').click();
  const code = builder.getByTestId('agg-code');
  await expect(code).toContainText(`db.getSiblingDB("${DB}").getCollection("${COLL}").aggregate(`);
  const shell = (await code.textContent()) ?? '';
  expect(shell).toMatch(/\$match[\s\S]*status: "open"[\s\S]*\$group[\s\S]*\$sort/);

  // Export as Node code: a program with the profile's connection string.
  await builder.getByTestId('agg-lang-node').click();
  await expect(code).toContainText("require('mongodb')");
  const node = (await code.textContent()) ?? '';
  expect(node).toContain(mongo.uri);
  expect(node).toMatch(/\.aggregate\(\[[\s\S]*\$match[\s\S]*\$group[\s\S]*\$sort/);
  await screenshot(electronApp, window, join(SHOTS, 'aggregation-export-node.png'));
});
