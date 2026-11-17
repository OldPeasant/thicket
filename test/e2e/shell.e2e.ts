import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'shell_e2e';
const COLL = 'orders';
const COUNT = 137;

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

async function saveProfile(
  window: Page,
  name: string,
  uri: string,
  flags: { readOnly: boolean; production: boolean },
): Promise<void> {
  const response = await window.evaluate(
    (p) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `save-${p.name}`,
        method: 'profiles.save',
        params: { profile: { name: p.name, connectionString: p.uri, ...p.flags } },
      }),
    { name, uri, flags },
  );
  expect(response).toMatchObject({ ok: true });
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/**
 * Connects the profile `name` and opens its shell from the context menu of the connection (the
 * session starts in the connection's default database) or of the database `DB`.
 */
async function openShell(window: Page, name: string, from: 'conn' | 'db'): Promise<Locator> {
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', name);
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await (from === 'conn' ? conn : treeNode(window, 'db', DB)).click({ button: 'right' });
  await window.getByTestId('menu-open-shell').click();
  const console = window.locator('app-shell-console');
  await expect(console).toBeVisible();
  await expect(console.getByTestId('shell-prompt')).toHaveText(
    from === 'db' ? `${DB}>` : /^[\w-]+>$/,
    { timeout: 30_000 },
  );
  return console;
}

test('demo step 11: run db.orders.countDocuments() in the mongosh console', async ({
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
    await client
      .db(DB)
      .collection(COLL)
      .insertMany(
        Array.from({ length: COUNT }, (_, i) => ({ n: i, status: i % 2 ? 'open' : 'closed' })),
      );
  } finally {
    await client.close();
  }

  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Shell', mongo.uri, { readOnly: false, production: true });
  // Demo step 11: the console of the connection, then `use` the database.
  const console = await openShell(window, 'Shell', 'conn');
  // Production: the red accent; writable: no read-only warning.
  await expect(console).toHaveClass(/production/);
  await expect(console.getByTestId('shell-production')).toBeVisible();
  await expect(console.getByTestId('shell-readonly-banner')).toHaveCount(0);

  const input = console.getByTestId('shell-input');
  await input.fill(`use ${DB}`);
  await input.press('Enter');
  await expect(console.getByTestId('shell-prompt')).toHaveText(`${DB}>`, { timeout: 30_000 });
  await input.fill('db.orders.countDocuments()');
  await input.press('Enter');
  const run = console.getByTestId('shell-run').last();
  await expect(run.getByTestId('shell-result')).toHaveText(String(COUNT), { timeout: 30_000 });

  // Autocompletion from the real runtime.
  await input.fill('db.orders.countDoc');
  await input.press('Tab');
  await expect(input).toHaveValue('db.orders.countDocuments');

  // Documents show in the viewer; the toggle shows mongosh's text.
  await input.fill('db.orders.find({ n: { $lt: 3 } }).sort({ n: 1 })');
  await input.press('Enter');
  const docs = console.getByTestId('shell-run').last();
  await expect(docs.getByTestId('shell-result-viewer')).toContainText('closed', {
    timeout: 30_000,
  });
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'shell-console.png'));
  await console.getByTestId('shell-view-text').click();
  await expect(docs.getByTestId('shell-result')).toContainText("status: 'closed'");

  // History: ArrowUp brings back the earlier input.
  await input.fill('');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('db.orders.find({ n: { $lt: 3 } }).sort({ n: 1 })');
});

test('a read-only profile opens the shell with a warning', async ({ window, mongo }) => {
  test.setTimeout(90_000);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db(DB).collection(COLL).insertOne({ n: -1 });
  } finally {
    await client.close();
  }
  await saveProfile(window, 'ReadOnly', mongo.uri, { readOnly: true, production: false });
  const console = await openShell(window, 'ReadOnly', 'db');
  await expect(console.getByTestId('shell-readonly-banner')).toContainText('Read-only connection');
  await expect(console).not.toHaveClass(/production/);
});

test('run a script file in the shell: its output shows and its documents are written', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const scriptDb = 'shell_scripts_e2e';
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client
      .db(scriptDb)
      .dropDatabase()
      .catch(() => undefined);
    await saveProfile(window, 'Scripts', mongo.uri, { readOnly: false, production: false });
    const console = await openShell(window, 'Scripts', 'conn');

    // "Run script…" opens the file chooser; the test picks the fixture file in it.
    const chooser = window.waitForEvent('filechooser');
    await console.getByTestId('shell-run-script').click();
    await (
      await chooser
    ).setFiles(fileURLToPath(new URL('fixtures/insert-three.mongodb', import.meta.url)));

    const run = console.getByTestId('shell-run').last();
    await expect(run.getByTestId('shell-script-name')).toContainText('insert-three.mongodb');
    await expect(run).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(run.getByTestId('shell-print')).toHaveText([
      'inserted 1',
      'inserted 2',
      'inserted 3',
      'count: 3',
    ]);
    await expect(run.getByTestId('shell-error')).toHaveCount(0);
    await expect(console.getByTestId('shell-announce')).toHaveText(
      'Script insert-three.mongodb finished',
    );

    const docs = await client
      .db(scriptDb)
      .collection('scripted')
      .find({}, { projection: { _id: 0 } })
      .sort({ n: 1 })
      .toArray();
    expect(docs).toEqual([
      { n: 1, source: 'script' },
      { n: 2, source: 'script' },
      { n: 3, source: 'script' },
    ]);
  } finally {
    await client.close();
  }
});
