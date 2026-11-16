import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/**
 * Connection editor against the int-harness `mongo8` fixture. The fixture runs without
 * `--auth`, but mongod still checks the credentials a client sends, so a user created here makes
 * the right password succeed and a wrong one fail with AuthenticationFailed.
 */

/** Creates a user with a generated password on the fixture (never committed). */
async function createUser(uri: string): Promise<{ username: string; password: string }> {
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('base64url');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db('admin').command({ createUser: username, pwd: password, roles: ['root'] });
  } finally {
    await client.close();
  }
  return { username, password };
}

/** Bytes of `secrets.bin`, or `null` while it does not exist. */
async function secretsFile(userDataDir: string): Promise<Buffer | null> {
  try {
    return await readFile(join(userDataDir, 'secrets.bin'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Fills a field whose edit is applied on `change` (leaving the field). */
async function setField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

async function fillServer(
  window: Page,
  profile: { name: string; host: string; port: number; username: string; password: string },
): Promise<void> {
  await window.getByTestId('field-name').fill(profile.name);
  await setField(window.getByTestId('field-host').first(), profile.host);
  await setField(window.getByTestId('field-port').first(), String(profile.port));
  await window.getByTestId('field-mechanism').selectOption('SCRAM-SHA-256');
  await window.getByTestId('field-username').fill(profile.username);
  await window.getByTestId('field-password').fill(profile.password);
}

test('create a profile for the fixture: Test connection succeeds, a wrong password is AUTH_FAILED', async ({
  window,
  mongo,
  userDataDir,
}) => {
  const user = await createUser(mongo.uri);
  await window.getByTestId('welcome-new').click();
  await expect(window.getByTestId('connection-editor')).toBeVisible();
  await fillServer(window, { name: 'Auth fixture', host: mongo.host, port: mongo.port, ...user });

  // The form and the connection string agree; the password is masked.
  await expect(window.getByTestId('uri-preview')).toHaveText(
    `mongodb://${user.username}:****@${mongo.host}:${String(mongo.port)}/?authMechanism=SCRAM-SHA-256`,
  );
  await expect(window.getByTestId('field-password')).toHaveAttribute('type', 'password');

  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-ok')).toContainText('Connected in', { timeout: 30_000 });
  await expect(window.getByTestId('test-ok')).toContainText('MongoDB 8.');

  await window.getByTestId('field-password').fill(`${user.password}-wrong`);
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-error-code')).toHaveText('AUTH_FAILED', {
    timeout: 30_000,
  });
  await expect(window.getByTestId('test-error')).toContainText(
    'Authentication failed. Check the user name, password and authentication mechanism.',
  );

  // Save it (with the right password) and find it in the sidebar and the manager.
  await window.getByTestId('field-password').fill(user.password);
  await window.getByTestId('save').click();
  await expect(window.getByTestId('saved-notice')).toBeVisible();
  await expect(window.locator('[data-testid="tree-conn"][data-name="Auth fixture"]')).toBeVisible();
  const stored = await readFile(join(userDataDir, 'connections.json'), 'utf8');
  expect(stored).toContain(user.username);
  expect(stored).not.toContain(user.password);

  await window.getByTestId('sidebar-manage').click();
  await expect(
    window.locator('[data-testid="manager-profile"][data-name="Auth fixture"]'),
  ).toContainText(`${mongo.host}:${String(mongo.port)}`);
});

test('ask each time: connecting prompts for the password and stores nothing', async ({
  window,
  mongo,
  userDataDir,
}) => {
  const user = await createUser(mongo.uri);
  const before = await secretsFile(userDataDir);

  await window.getByTestId('welcome-new').click();
  await fillServer(window, { name: 'Ask fixture', host: mongo.host, port: mongo.port, ...user });
  await window.getByTestId('secret-ask').check();
  await expect(window.getByTestId('ask-hint')).toBeVisible();
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-ok')).toBeVisible({ timeout: 30_000 });
  await window.getByTestId('save').click();
  await expect(window.getByTestId('saved-notice')).toBeVisible();
  expect(await secretsFile(userDataDir)).toEqual(before);

  const conn = window.locator('[data-testid="tree-conn"][data-name="Ask fixture"]');
  await conn.click();
  const prompt = window.getByTestId('tree-prompt');
  await expect(prompt).toBeVisible();
  await window.getByTestId('prompt-password').fill(user.password);
  await window.getByTestId('prompt-ok').click();
  await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  await expect(prompt).toBeHidden();

  // Nothing was written to the secret store, and the profile asks again next time.
  expect(await secretsFile(userDataDir)).toEqual(before);
  const stored = await readFile(join(userDataDir, 'connections.json'), 'utf8');
  expect(stored).not.toContain(user.password);
  const { profiles } = JSON.parse(stored) as {
    profiles: { name: string; auth?: { secretMode: string } }[];
  };
  expect(profiles.find((p) => p.name === 'Ask fixture')?.auth?.secretMode).toBe('ask');

  await conn.click({ button: 'right' });
  await window.getByTestId('menu-disconnect').click();
  await expect(conn).toHaveAttribute('data-state', 'disconnected');
  await conn.click({ button: 'right' });
  await window.getByTestId('menu-connect').click();
  await expect(prompt).toBeVisible();
  await window.getByTestId('prompt-cancel').click();
  expect(await secretsFile(userDataDir)).toEqual(before);
});
