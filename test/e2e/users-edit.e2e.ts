import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient, MongoServerError } from 'mongodb';

import { expect, test } from './harness';
import { containerRuntimeUnavailable, startMongoSpec, type E2EMongo } from './harness/mongo';

/*
 * Task users-roles-edit: against a MongoDB 8 standalone with access control on (--auth, root user
 * with a generated password), connect as root, create a user in the users and roles tab, grant it
 * a role, then connect as that user from a new profile and read the database it was granted.
 */

/** Where the screenshots go (git-ignored). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'users_e2e';
const COLL = 'stock';
const ROOT = { username: 'root', password: randomBytes(12).toString('base64url') };
const USER = { username: 'carl', password: randomBytes(12).toString('base64url') };

let server: E2EMongo | undefined;
let unavailable: string | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  unavailable = await containerRuntimeUnavailable();
  if (unavailable !== undefined) return;
  server = await startMongoSpec({ version: '8', auth: ROOT });
  const root = new MongoClient(server.uri, { auth: ROOT, serverSelectionTimeoutMS: 10_000 });
  try {
    await root
      .db(DB)
      .collection(COLL)
      .insertMany([{ sku: 'a-1' }, { sku: 'b-2' }]);
  } finally {
    await root.close();
  }
});

test.afterAll(async () => {
  await server?.stop();
});

/** Fills a field whose edit is applied on `change` (leaving the field). */
async function setField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

/** Creates and saves a SCRAM profile in the connection editor (password saved). */
async function saveProfile(
  window: Page,
  mongo: E2EMongo,
  profile: { name: string; username: string; password: string; authSource: string },
): Promise<void> {
  await window.getByTestId('field-name').fill(profile.name);
  await setField(window.getByTestId('field-host').first(), mongo.host);
  await setField(window.getByTestId('field-port').first(), String(mongo.port));
  await window.getByTestId('field-mechanism').selectOption('SCRAM-SHA-256');
  await window.getByTestId('field-username').fill(profile.username);
  await setField(window.getByTestId('field-auth-source'), profile.authSource);
  await window.getByTestId('field-password').fill(profile.password);
  await window.getByTestId('secret-saved').check();
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-ok')).toBeVisible({ timeout: 30_000 });
  await window.getByTestId('save').click();
  await expect(window.getByTestId('saved-notice')).toBeVisible();
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** Whether `USER` may read the collection (find), straight through the driver. */
async function userCanRead(mongo: E2EMongo): Promise<boolean | string> {
  const client = new MongoClient(mongo.uri, {
    auth: USER,
    authSource: DB,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.db(DB).collection(COLL).findOne();
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.codeName === 'Unauthorized') return false;
    return String(error);
  } finally {
    await client.close();
  }
}

test('users and roles: create a user, grant it a role, connect as that user', async ({
  window,
}) => {
  test.skip(server === undefined, unavailable ?? 'no auth fixture');
  test.setTimeout(180_000);
  const mongo = server as E2EMongo;
  await window.setViewportSize({ width: 1400, height: 900 });

  // Connect as root.
  await window.getByTestId('welcome-new').click();
  await saveProfile(window, mongo, { name: 'Root', ...ROOT, authSource: 'admin' });
  const root = treeNode(window, 'conn', 'Root');
  await root.click();
  await expect(root).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });

  // Users and roles of the database.
  const db = treeNode(window, 'db', DB);
  await expect(db).toBeVisible();
  await db.click({ button: 'right' });
  await window.getByTestId('menu-users').click();
  const tab = window.locator('app-users-roles-view');
  await expect(tab.getByTestId('empty')).toBeVisible();

  // Create the user (no role yet).
  await tab.getByTestId('create').click();
  await tab.getByTestId('editor-name').fill(USER.username);
  await tab.getByTestId('editor-password').fill(USER.password);
  await tab.getByTestId('editor-repeat').fill(USER.password);
  await tab.getByTestId('editor-save').click();
  await expect(tab.getByTestId('notice')).toHaveText(`User ${USER.username} created.`);
  await expect(tab.getByTestId('user-item')).toHaveText([new RegExp(USER.username)]);
  expect(await userCanRead(mongo)).toBe(false);

  // Grant it read on the database.
  const detail = tab.getByTestId('user-detail');
  await detail.getByTestId('role-input').fill('read');
  await detail.getByTestId('role-add').click();
  await expect(tab.getByTestId('notice')).toHaveText(`Granted read to ${USER.username}.`);
  await expect(detail.getByTestId('direct-roles')).toContainText(`read@${DB}`);
  expect(await userCanRead(mongo)).toBe(true);
  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'users-edit-granted.png') });

  // Connect as the new user, from a new profile, and browse what the role allows.
  await window.getByTestId('sidebar-add').click();
  await expect(window.getByTestId('connection-editor')).toBeVisible();
  await saveProfile(window, mongo, { name: 'Carl', ...USER, authSource: DB });
  const carl = treeNode(window, 'conn', 'Carl');
  await carl.click();
  await expect(carl).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  // Root's and Carl's connection each list the database; Carl's is the second.
  await expect(treeNode(window, 'db', DB)).toHaveCount(2);
  const carlDb = treeNode(window, 'db', DB).nth(1);
  await carlDb.click();
  const stock = treeNode(window, 'coll', COLL);
  await expect(stock).toBeVisible();
  await stock.click();
  // The user's read role lets it find the documents.
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(2, { timeout: 30_000 });
  await expect(window.getByTestId('result-doc').first()).toContainText('a-1');
  await window.screenshot({ path: join(SHOTS, 'users-edit-connected-as-user.png') });
});
