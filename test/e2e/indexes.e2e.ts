import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'idx_e2e';
const COLL = 'events';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
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

test('indexes tab: create a TTL index and a partial index, see them listed with options', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await withClient(mongo.uri, async (client) => {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client
      .db(DB)
      .collection(COLL)
      .insertMany(
        Array.from({ length: 50 }, (_, i) => ({
          n: i,
          status: i % 2 === 0 ? 'open' : 'closed',
          createdAt: new Date(),
        })),
      );
  });

  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Idx', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Idx');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  await window.getByTestId('open-indexes').click();
  const view = window.locator('app-indexes-view');
  await expect(view).toBeVisible();
  const rows = view.getByTestId('idx-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-name', '_id_');

  // TTL index on createdAt.
  await view.getByTestId('idx-create').click();
  const form = view.getByTestId('idx-create-form');
  await form.getByTestId('idx-key-field').fill('createdAt');
  await form.getByTestId('idx-ttl').fill('3600');
  await expect(form.getByTestId('idx-preview')).toHaveText(
    `db.${COLL}.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })`,
  );
  await form.getByTestId('idx-create-submit').click();
  await expect(view.getByTestId('idx-message')).toHaveText('Created index createdAt_1.');
  await expect(form).toHaveCount(0);
  const ttl = view.locator('[data-testid="idx-row"][data-name="createdAt_1"]');
  await expect(ttl.getByTestId('idx-key')).toContainText('createdAt↑');
  await expect(ttl.getByTestId('idx-tag')).toHaveText(['TTL 3600 s']);

  // A validation error first: sparse and partial together are refused before sending.
  await view.getByTestId('idx-create').click();
  await form.getByTestId('idx-key-field').fill('n');
  await form.getByTestId('idx-key-type').selectOption('-1');
  await form.getByTestId('idx-partial').fill('{ status: "open" }');
  await form.getByTestId('idx-sparse').check();
  await form.getByTestId('idx-create-submit').click();
  await expect(form.getByTestId('idx-error')).toHaveText(
    'Use either sparse or a partial filter, not both.',
  );
  await form.getByTestId('idx-sparse').uncheck();
  await form.getByTestId('idx-name').fill('open_status');
  await form.getByTestId('idx-unique').check();
  await form.getByTestId('idx-create-submit').click();
  await expect(view.getByTestId('idx-message')).toHaveText('Created index open_status.');
  const partial = view.locator('[data-testid="idx-row"][data-name="open_status"]');
  await expect(partial.getByTestId('idx-key')).toContainText('n↓');
  await expect(partial.getByTestId('idx-tag')).toHaveText(['unique', 'partial']);
  await expect(partial.getByTestId('idx-partial-filter')).toHaveText('{ status: "open" }');
  await expect(rows).toHaveCount(3);
  // Sizes come from $collStats.
  await expect(partial.getByTestId('idx-size')).toContainText('KB');

  // The server has them with these options.
  const specs = await withClient(mongo.uri, (client) =>
    client.db(DB).collection(COLL).listIndexes().toArray(),
  );
  expect(specs.find((s) => s['name'] === 'createdAt_1')).toMatchObject({
    key: { createdAt: 1 },
    expireAfterSeconds: 3600,
  });
  expect(specs.find((s) => s['name'] === 'open_status')).toMatchObject({
    key: { n: -1 },
    unique: true,
    partialFilterExpression: { status: 'open' },
  });

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'indexes-tab.png') });

  // Hide and unhide.
  await partial.getByTestId('idx-hide').click();
  await expect(partial.getByTestId('idx-tag').first()).toHaveText('hidden');
  await partial.getByTestId('idx-hide').click();
  await expect(partial.getByTestId('idx-tag')).toHaveText(['unique', 'partial']);

  // Drop asks first.
  await ttl.getByTestId('idx-drop').click();
  await expect(window.getByTestId('confirm-dialog')).toBeVisible();
  await expect(window.getByTestId('confirm-operation')).toContainText('dropIndex("createdAt_1")');
  await window.getByTestId('confirm-ok').click();
  await expect(view.getByTestId('idx-message')).toHaveText('Dropped index createdAt_1.');
  await expect(rows).toHaveCount(2);
});
