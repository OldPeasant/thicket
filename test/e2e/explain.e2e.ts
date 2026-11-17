import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'explain_e2e';
const COLL = 'orders';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

/** 3 000 orders: status open/closed, a Decimal128 total. */
function fixtureDocs() {
  return Array.from({ length: 3000 }, (_, i) => ({
    _id: new ObjectId(),
    n: i,
    status: i % 3 === 0 ? 'closed' : 'open',
    total: Decimal128.fromString(`${i % 250}.25`),
  }));
}

async function request(window: Page, method: string, params: unknown) {
  return window.evaluate(
    (r) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `e2e-${r.method}-${Date.now()}`,
        method: r.method,
        params: r.params,
      }),
    { method, params },
  );
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('demo step 9: Explain shows COLLSCAN before the index and IXSCAN after it', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.db(DB).collection(COLL).insertMany(fixtureDocs());
  } finally {
    await client.close();
  }

  await window.setViewportSize({ width: 1500, height: 1000 });
  const saved = await request(window, 'profiles.save', {
    profile: { name: 'Explain', connectionString: mongo.uri, readOnly: false, production: false },
  });
  expect(saved).toMatchObject({ ok: true });
  const profileId = (saved.result as { profile: { id: string } }).profile.id;
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Explain');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  // The query of demo step 4, then Explain: no index yet, so the server scans the collection.
  await window.getByTestId('query-filter').fill('{status: "open", total: {$gt: 100}}');
  await window.getByTestId('query-sort').fill('{total: -1}');
  await window.getByTestId('query-run').click();
  await window.getByTestId('query-explain').click();
  const panel = window.getByTestId('explain-panel');
  const verdict = panel.getByTestId('explain-verdict');
  await expect(verdict).toContainText('No index used');
  await expect(verdict).toContainText('COLLSCAN');
  await expect(panel.locator('[data-testid="explain-stage"][data-stage="COLLSCAN"]')).toHaveCount(
    1,
  );
  await expect(panel.locator('[data-stage="IXSCAN"]')).toHaveCount(0);
  await expect(panel.getByTestId('explain-docs')).toHaveText(/^3\D?000$/);
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'explain-collscan.png'));

  // The raw explain output opens in the document viewer.
  await panel.getByTestId('explain-view-raw').click();
  await expect(panel.locator('app-explain-raw app-json-explorer')).toBeVisible();
  await expect(panel.locator('app-explain-raw')).toContainText('winningPlan');
  await panel.getByTestId('explain-view-plan').click();

  // Create the index over the bridge (`idx.create`, the backend method the Indexes tab calls).
  const created = await request(window, 'idx.create', {
    profileId,
    db: DB,
    coll: COLL,
    key: JSON.stringify({ status: 1, total: 1 }),
  });
  expect(created).toMatchObject({ ok: true, result: { name: 'status_1_total_1' } });

  // Explain the same query again: the plan reads the new index.
  await window.getByTestId('query-explain').click();
  await expect(verdict).toContainText('Index used: status_1_total_1');
  const ixscan = panel.locator('[data-testid="explain-stage"][data-stage="IXSCAN"]');
  await expect(ixscan).toHaveCount(1);
  await expect(ixscan.getByTestId('explain-stage-index')).toHaveText('status_1_total_1');
  await expect(panel.locator('[data-stage="COLLSCAN"]')).toHaveCount(0);
  await screenshot(electronApp, window, join(SHOTS, 'explain-ixscan.png'));

  // The pipeline builder explains too: $match on the indexed fields uses the index.
  await panel.getByTestId('explain-close').click();
  await expect(panel).toHaveCount(0);
  await window.getByTestId('open-aggregation').click();
  const builder = window.locator('app-aggregation-view');
  await builder
    .getByTestId('agg-stage-body')
    .first()
    .fill('{ status: "open", total: { $gt: 100 } }');
  await builder.getByTestId('agg-explain').click();
  const aggPanel = builder.getByTestId('explain-panel');
  await expect(aggPanel.getByTestId('explain-verdict')).toContainText('status_1_total_1');
  await expect(aggPanel.locator('[data-stage="IXSCAN"]')).toHaveCount(1);
  await screenshot(electronApp, window, join(SHOTS, 'explain-aggregation.png'));
});
