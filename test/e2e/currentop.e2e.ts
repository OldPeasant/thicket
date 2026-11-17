import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient, MongoServerError } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'curop_e2e';
const COLL = 'slow';

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

test('current operations: a slow query is listed and killed from the UI after confirming', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const coll = client.db(DB).collection(COLL);
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await coll.insertMany(Array.from({ length: 1000 }, (_, n) => ({ n })));
    // Runs for minutes: every document sleeps 200 ms in server-side JavaScript.
    const slow = coll
      .find({ $where: 'sleep(200); return true;' }, { comment: 'e2e-slow-query', batchSize: 1000 })
      .toArray()
      .then(
        () => 'finished' as const,
        (error: unknown) => error,
      );

    await window.setViewportSize({ width: 1400, height: 900 });
    await saveProfile(window, 'Ops', mongo.uri);
    await window.getByTestId('sidebar-refresh').click();
    const conn = treeNode(window, 'conn', 'Ops');
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected');
    await conn.click({ button: 'right' });
    await window.getByTestId('menu-current-ops').click();

    const tab = window.locator('app-currentop-view');
    await expect(tab).toBeVisible();
    await tab.getByTestId('currentop-ns').fill(DB);
    await tab.getByTestId('currentop-ns').press('Enter');
    await tab.getByTestId('currentop-type').selectOption('query');
    await expect(tab.getByTestId('currentop-call')).toHaveText(
      `db.currentOp({ ns: /^${DB}(\\.|$)/, op: "query" })`,
    );
    // Auto-refresh (every 5 s by default) brings the operation in, if the first read missed it.
    const row = tab.locator(`[data-testid="currentop-row"][data-ns="${DB}.${COLL}"]`);
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText('e2e-slow-query');
    await expect(row).toContainText('$where');

    await mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: join(SHOTS, 'currentop-list.png') });

    // Cancel first: nothing is killed.
    await row.getByTestId('currentop-kill').click();
    const dialog = window.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(window.getByTestId('confirm-operation')).toContainText('db.killOp(');
    await window.screenshot({ path: join(SHOTS, 'currentop-confirm.png') });
    await window.getByTestId('confirm-cancel').click();
    await expect(dialog).toBeHidden();
    await tab.getByTestId('currentop-refresh').click();
    await expect(row).toHaveCount(1);

    // Confirm: the server interrupts the query and it leaves the list.
    await row.getByTestId('currentop-kill').click();
    await expect(dialog).toBeVisible();
    await window.getByTestId('confirm-ok').click();
    await expect(tab.getByTestId('currentop-notice')).toContainText('kill operation');
    const outcome = await slow;
    expect(outcome).toBeInstanceOf(MongoServerError);
    expect((outcome as MongoServerError).codeName).toBe('Interrupted');
    await tab.getByTestId('currentop-refresh').click();
    await expect(row).toHaveCount(0);
    await expect(tab.getByTestId('currentop-empty')).toBeVisible();
  } finally {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.close();
  }
});
