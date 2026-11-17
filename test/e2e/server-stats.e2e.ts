import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'stats_e2e';

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

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('server stats: live charts, standalone note and dbStats of the databases', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  let load: ReturnType<typeof setInterval> | undefined;
  try {
    const coll = client.db(DB).collection('items');
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await coll.insertMany(Array.from({ length: 500 }, (_, n) => ({ n })));
    // Some traffic so the operation chart has something to draw.
    let n = 0;
    load = setInterval(() => {
      n += 1;
      void coll.insertOne({ n: 10_000 + n }).catch(() => undefined);
      void coll
        .find({ n: { $gt: n } })
        .limit(3)
        .toArray()
        .catch(() => undefined);
    }, 50);

    await window.setViewportSize({ width: 1400, height: 1000 });
    await saveProfile(window, 'Stats', mongo.uri);
    await window.getByTestId('sidebar-refresh').click();
    const conn = treeNode(window, 'conn', 'Stats');
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected');
    await conn.click({ button: 'right' });
    await window.getByTestId('menu-server-stats').click();

    const tab = window.locator('app-server-stats-view');
    await expect(tab).toBeVisible();
    await expect(tab.getByTestId('stats-role')).toHaveText('standalone');
    await expect(tab.getByTestId('stats-repl-none')).toBeVisible();
    // At least the 500 documents inserted first (the load adds more meanwhile).
    const documents = tab.locator(`[data-testid="db-row"][data-db="${DB}"] td`).nth(3);
    await expect(documents).toHaveText(/^\s*[5-9]\d\d\s*$/);

    // Samples every 2 s: after a few the charts draw lines and the rates are non-zero.
    await expect(tab.getByTestId('waiting-ops')).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(async () => (await tab.getByTestId('line-ops-insert').getAttribute('d')) ?? '', {
        timeout: 20_000,
      })
      .toMatch(/L/);
    await expect(tab.getByTestId('legend-ops-insert')).not.toContainText(/insert\s*0$/);

    await tab
      .getByTestId('chart-ops')
      .locator('svg')
      .hover({ position: { x: 300, y: 60 } });
    await expect(tab.getByTestId('tip-ops')).toBeVisible();

    await mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: join(SHOTS, 'server-stats.png'), fullPage: true });
  } finally {
    if (load) clearInterval(load);
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.close();
  }
});
