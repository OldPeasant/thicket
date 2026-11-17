import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

// Conflict resolution (conflict-ui), demo step 7: the document changes on the server between
// load and save; Save then shows both versions side by side, and Overwrite / Keep server
// version / Merge manually resolve it. The server state is checked with the driver.

const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');
const DB = 'conflict_e2e';
const COLL = 'orders';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

interface Order {
  _id: number;
  status: string;
  qty: number;
  note?: string;
}

async function withColl<T>(
  uri: string,
  body: (c: import('mongodb').Collection<Order>) => Promise<T>,
) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await body(client.db(DB).collection<Order>(COLL));
  } finally {
    await client.close();
  }
}

async function setup(window: Page, uri: string): Promise<void> {
  await withColl(uri, async (c) => {
    await c.drop().catch(() => undefined);
    await c.insertMany([1, 2, 3].map((i) => ({ _id: i, status: 'open', qty: i })));
  });
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
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Local');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(3);
  await window.getByTestId('edit-mode').click();
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** Types into field `key` of the `n`th document and leaves the field (applied on blur). */
async function typeValue(window: Page, n: number, key: string, value: string): Promise<void> {
  const input = window
    .getByTestId('result-doc')
    .nth(n)
    .locator(`.field[data-node$=".${key}"] app-bson-input input`)
    .first();
  await input.fill(value);
  await input.press('Tab');
}

/** Edits `qty` of document `n`, changes the same document with the driver, then saves. */
async function editIntoConflict(window: Page, uri: string, n: number, qty: number) {
  await typeValue(window, n - 1, 'qty', String(qty));
  await expect(window.getByTestId('edit-count')).toHaveText('1 change');
  // The "second window": another client changes the same document after it was loaded.
  await withColl(uri, (c) => c.updateOne({ _id: n }, { $set: { qty: 70, note: 'mongosh' } }));
  await window.getByTestId('edit-save').click();
  const view = window.getByTestId('conflict-view');
  await expect(view).toBeVisible();
  return view;
}

const stored = (uri: string, id: number) => withColl(uri, (c) => c.findOne({ _id: id }));

test('external change between load and save shows the conflict view; Overwrite writes the local version', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  await window.setViewportSize({ width: 1400, height: 900 });
  await setup(window, mongo.uri);

  const view = await editIntoConflict(window, mongo.uri, 1, 50);
  await expect(window.getByTestId('edit-message')).toContainText('changed on the server');
  await expect(view.getByTestId('conflict-title')).toHaveText(
    'Changed on the server since you loaded it',
  );
  // Side by side, differences highlighted: the qty line differs, the note only the server has.
  const changed = view.locator('[data-testid="conflict-row"][data-kind="changed"]');
  await expect(changed).toHaveCount(1);
  await expect(changed.getByTestId('conflict-local')).toContainText('qty: 50');
  await expect(changed.getByTestId('conflict-server')).toContainText('qty: 70');
  const serverOnly = view.locator('[data-testid="conflict-row"][data-kind="right"]');
  await expect(serverOnly.getByTestId('conflict-server')).toContainText('note: "mongosh"');
  await expect(changed.getByTestId('conflict-local')).toHaveClass(/diff/);

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'conflict-view.png') });

  await view.getByTestId('conflict-overwrite').click();
  await expect(window.getByTestId('conflict-view')).toHaveCount(0);
  await expect(window.getByTestId('edit-count')).toHaveCount(0);
  expect(await stored(mongo.uri, 1)).toEqual({ _id: 1, status: 'open', qty: 50 });
});

test('Keep server version discards the edits; Merge manually saves the merged document', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  await window.setViewportSize({ width: 1400, height: 900 });
  await setup(window, mongo.uri);

  // Keep server version.
  let view = await editIntoConflict(window, mongo.uri, 2, 50);
  await view.getByTestId('conflict-keep-server').click();
  await expect(window.getByTestId('conflict-view')).toHaveCount(0);
  await expect(window.getByTestId('edit-count')).toHaveCount(0);
  expect(await stored(mongo.uri, 2)).toEqual({
    _id: 2,
    status: 'open',
    qty: 70,
    note: 'mongosh',
  });
  await expect(
    window.getByTestId('result-doc').nth(1).locator('.field[data-node$=".note"]'),
  ).toHaveCount(1);

  // Merge manually: the user's qty with the server's note.
  view = await editIntoConflict(window, mongo.uri, 3, 50);
  await view.getByTestId('conflict-merge').click();
  await view
    .getByTestId('conflict-merge-text')
    .fill("{ _id: 3, status: 'open', qty: 50, note: 'mongosh' }");
  await view.getByTestId('conflict-merge-save').click();
  await expect(window.getByTestId('conflict-view')).toHaveCount(0);
  expect(await stored(mongo.uri, 3)).toEqual({ _id: 3, status: 'open', qty: 50, note: 'mongosh' });
});
