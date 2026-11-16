import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'sidebar_e2e';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

/** Saves a profile through the real `profiles.save` in main; returns its id. */
async function saveProfile(
  window: Page,
  profile: { name: string; connectionString: string; readOnly: boolean },
): Promise<string> {
  const response = await window.evaluate(
    (p) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `save-${p.name}`,
        method: 'profiles.save',
        params: { profile: { ...p, production: false } },
      }),
    profile,
  );
  expect(response).toMatchObject({ ok: true });
  return (response.result as { profile: { id: string } }).profile.id;
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

async function menuAction(window: Page, target: Locator, action: string): Promise<void> {
  await target.click({ button: 'right' });
  await window.getByTestId(`menu-${action}`).click();
}

async function collectionNames(uri: string): Promise<string[]> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const list = await client.db(DB).listCollections({}, { nameOnly: true }).toArray();
    return list.map((c) => c.name).sort();
  } finally {
    await client.close();
  }
}

async function databaseNames(uri: string): Promise<string[]> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    return databases.map((d) => d.name);
  } finally {
    await client.close();
  }
}

test('create a database and collection, rename, and drop with the typed name', async ({
  window,
  mongo,
}) => {
  await window.setViewportSize({ width: 1280, height: 800 });
  await saveProfile(window, { name: 'Fixture', connectionString: mongo.uri, readOnly: false });
  await window.getByTestId('sidebar-refresh').click();

  const conn = treeNode(window, 'conn', 'Fixture');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await expect(treeNode(window, 'db', 'admin')).toBeVisible();

  // Create database with its first collection.
  await menuAction(window, conn, 'create-db');
  await window.getByTestId('prompt-db').fill(DB);
  await window.getByTestId('prompt-coll').fill('first');
  await window.getByTestId('prompt-ok').click();
  await expect(window.getByTestId('tree-prompt')).toBeHidden();
  const db = treeNode(window, 'db', DB);
  await expect(db).toBeVisible();
  await expect(treeNode(window, 'coll', 'first')).toBeVisible();
  expect(await collectionNames(mongo.uri)).toEqual(['first']);

  // Create a second collection in it.
  await menuAction(window, db, 'create-coll');
  await window.getByTestId('prompt-coll').fill('second');
  await window.keyboard.press('Enter');
  await expect(treeNode(window, 'coll', 'second')).toBeVisible();
  expect(await collectionNames(mongo.uri)).toEqual(['first', 'second']);

  // Rename it.
  await menuAction(window, treeNode(window, 'coll', 'second'), 'rename');
  await window.getByTestId('prompt-name').fill('renamed');
  await window.getByTestId('prompt-ok').click();
  await expect(treeNode(window, 'coll', 'renamed')).toBeVisible();
  await expect(treeNode(window, 'coll', 'second')).toHaveCount(0);
  expect(await collectionNames(mongo.uri)).toEqual(['first', 'renamed']);

  // Open it in a tab; counts and sizes on demand.
  await treeNode(window, 'coll', 'renamed').click();
  await expect(
    window.locator('[data-testid="tab"][data-tab-id$="sidebar_e2e.renamed"]'),
  ).toBeVisible();
  await menuAction(window, treeNode(window, 'coll', 'first'), 'stats');
  await expect(treeNode(window, 'coll', 'first').getByTestId('node-stats')).toHaveText(/^0 docs, /);

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'sidebar-tree.png') });

  // Drop the collection: the confirm button works only after the exact name is typed.
  await menuAction(window, treeNode(window, 'coll', 'renamed'), 'drop-coll');
  const ok = window.getByTestId('confirm-ok');
  await expect(window.getByTestId('confirm-dialog')).toBeVisible();
  await expect(ok).toBeDisabled();
  await window.getByTestId('confirm-type').fill('rename');
  await expect(ok).toBeDisabled();
  await window.screenshot({ path: join(SHOTS, 'sidebar-drop-confirm.png') });
  await window.getByTestId('confirm-type').fill('renamed');
  await ok.click();
  await expect(treeNode(window, 'coll', 'renamed')).toHaveCount(0);
  // Its tab was closed.
  await expect(
    window.locator('[data-testid="tab"][data-tab-id$="sidebar_e2e.renamed"]'),
  ).toHaveCount(0);
  expect(await collectionNames(mongo.uri)).toEqual(['first']);

  // Cancelling a database drop sends nothing.
  await menuAction(window, db, 'drop-db');
  await window.getByTestId('confirm-cancel').click();
  await expect(window.getByTestId('confirm-dialog')).toBeHidden();
  expect(await databaseNames(mongo.uri)).toContain(DB);

  // Drop the database with its typed name.
  await menuAction(window, db, 'drop-db');
  await window.getByTestId('confirm-type').fill(DB);
  await window.getByTestId('confirm-ok').click();
  await expect(treeNode(window, 'db', DB)).toHaveCount(0);
  expect(await databaseNames(mongo.uri)).not.toContain(DB);
});

test('a read-only profile disables the write actions', async ({ window, mongo }) => {
  await saveProfile(window, { name: 'Reader', connectionString: mongo.uri, readOnly: true });
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Reader');
  await expect(conn.getByTestId('badge-readonly')).toBeVisible();
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');

  await conn.click({ button: 'right' });
  await expect(window.getByTestId('menu-create-db')).toBeDisabled();
  await window.keyboard.press('Escape');

  const admin = treeNode(window, 'db', 'admin');
  await admin.click({ button: 'right' });
  await expect(window.getByTestId('menu-create-coll')).toBeDisabled();
  await expect(window.getByTestId('menu-drop-db')).toBeDisabled();
  await expect(window.getByTestId('menu-stats')).toBeEnabled();
  await window.keyboard.press('Escape');

  await admin.click();
  const system = window.locator('[data-testid="tree-coll"]').first();
  await expect(system).toBeVisible();
  await system.click({ button: 'right' });
  await expect(window.getByTestId('menu-rename')).toBeDisabled();
  await expect(window.getByTestId('menu-drop-coll')).toBeDisabled();
});
