import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startLdapFixture, type LdapFixture } from '../integration/fixtures/ldap.ts';
import { expect, test } from './harness';
import { containerRuntimeUnavailable } from './harness/mongo';

/**
 * LDAP (PLAIN) profile in the connection editor (task auth-ui-m5) against the integration
 * harness's LDAP fixture: MongoDB Enterprise bound to an OpenLDAP container. The LDAP password is
 * generated per run and stored through the editor (never committed).
 */

let ldap: LdapFixture | undefined;
let unavailable: string | undefined;

test.beforeAll(async () => {
  unavailable = await containerRuntimeUnavailable();
  if (unavailable !== undefined) return;
  // Rootless Podman can't run Ryuk (as in harness/mongo.ts); afterAll stops the containers.
  if (process.env['DOCKER_HOST']?.includes('podman')) {
    process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';
  }
  ldap = await startLdapFixture();
});

test.afterAll(async () => {
  await ldap?.stop();
});

test.describe.configure({ timeout: 240_000 });

test('an LDAP profile: created in the editor, tested, saved and connected', async ({
  window,
  userDataDir,
}) => {
  test.skip(ldap === undefined, unavailable ?? 'no LDAP fixture');
  const fixture = ldap as LdapFixture;
  await window.getByTestId('welcome-new').click();
  await expect(window.getByTestId('connection-editor')).toBeVisible();
  await window.getByTestId('field-name').fill('Directory');

  // Server address from the fixture's connection string, through the connection-string tab.
  await window.getByTestId('tab-uri').click();
  await window.getByTestId('field-uri').fill(fixture.uri);
  await window.getByTestId('tab-form').click();

  await window.getByTestId('field-mechanism').selectOption('PLAIN');
  await expect(window.getByTestId('ldap-hint')).toBeVisible();
  await expect(window.getByTestId('field-auth-source')).toHaveCount(0);
  await window.getByTestId('field-username').fill(fixture.username);
  await window.getByTestId('field-password').fill('wrong-password');
  await expect(window.getByTestId('uri-preview')).toContainText(
    `mongodb://${fixture.username}:****@`,
  );
  await expect(window.getByTestId('uri-preview')).toContainText('authMechanism=PLAIN');

  // A wrong LDAP password is an authentication error.
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-error')).toBeVisible({ timeout: 60_000 });
  await expect(window.getByTestId('test-error-code')).toHaveText('AUTH_FAILED');

  await window.getByTestId('field-password').fill(fixture.password);
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-ok')).toBeVisible({ timeout: 60_000 });

  await window.getByTestId('save').click();
  await expect(window.getByTestId('saved-notice')).toBeVisible();
  const stored = await readFile(join(userDataDir, 'connections.json'), 'utf8');
  expect(stored).not.toContain(fixture.password);
  const { profiles } = JSON.parse(stored) as {
    profiles: { name: string; connectionString: string; auth?: Record<string, unknown> }[];
  };
  const profile = profiles.find((p) => p.name === 'Directory');
  expect(profile?.auth).toEqual({
    mechanism: 'PLAIN',
    username: fixture.username,
    secretMode: 'saved',
  });
  expect(profile?.connectionString).toContain('authMechanism=PLAIN');

  // Connect from the sidebar with the saved LDAP password.
  const conn = window.locator('[data-testid="tree-conn"][data-name="Directory"]');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });
});
