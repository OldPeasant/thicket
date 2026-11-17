import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';

import { startSshFixture, type SshFixture } from '../integration/fixtures/ssh.ts';
import { expect, test } from './harness';
import { containerRuntimeUnavailable } from './harness/mongo';

/**
 * SSH tunnel profile in the connection editor (task conn-ui-m2) against the integration harness's
 * SSH fixture: an OpenSSH server in front of a two-member replica set whose member names only the
 * SSH server can resolve, so the connection works only through the tunnel. The SSH password is
 * generated per run and stored through the editor (never committed).
 */

let ssh: SshFixture | undefined;
let unavailable: string | undefined;

test.beforeAll(async () => {
  unavailable = await containerRuntimeUnavailable();
  if (unavailable !== undefined) return;
  // Rootless Podman can't run Ryuk (as in harness/mongo.ts); afterAll stops the containers.
  if (process.env['DOCKER_HOST']?.includes('podman')) {
    process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';
  }
  ssh = await startSshFixture();
});

test.afterAll(async () => {
  await ssh?.stop();
});

/** Fills a field whose edit is applied on `change` (leaving the field). */
async function setField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

test.describe.configure({ timeout: 240_000 });

test('an SSH-tunnelled profile: created in the editor, host key trusted, connected', async ({
  window,
  userDataDir,
}) => {
  test.skip(ssh === undefined, unavailable ?? 'no SSH fixture');
  const fixture = ssh as SshFixture;
  await window.getByTestId('welcome-new').click();
  await expect(window.getByTestId('connection-editor')).toBeVisible();

  await window.getByTestId('field-name').fill('Behind bastion');
  await setField(window.getByTestId('field-host').first(), 'ssh-rs-a');
  await setField(window.getByTestId('field-port').first(), '27017');
  await window.getByTestId('add-host').click();
  await setField(window.getByTestId('field-host').nth(1), 'ssh-rs-b');
  await setField(window.getByTestId('field-replica-set'), 'rs3');

  await window.getByTestId('field-ssh').check();
  await setField(window.getByTestId('field-ssh-host'), fixture.sshHost);
  await setField(window.getByTestId('field-ssh-port'), String(fixture.sshPort));
  await setField(window.getByTestId('field-ssh-username'), 'thicket');
  await window.getByTestId('ssh-method-password').check();
  await window.getByTestId('field-secret-sshPassword').fill(fixture.password);
  await expect(window.getByTestId('route')).toContainText(`thicket@${fixture.sshHost}`);
  // SSH is no connection string option; the URI shows only the members.
  await expect(window.getByTestId('uri-preview')).toHaveText(
    'mongodb://ssh-rs-a:27017,ssh-rs-b:27017/?replicaSet=rs3',
  );

  await window.getByTestId('save').click();
  await expect(window.getByTestId('saved-notice')).toBeVisible();
  const stored = await readFile(join(userDataDir, 'connections.json'), 'utf8');
  expect(stored).not.toContain(fixture.password);
  const { profiles } = JSON.parse(stored) as {
    profiles: { name: string; ssh?: Record<string, unknown> }[];
  };
  expect(profiles.find((p) => p.name === 'Behind bastion')?.ssh).toEqual({
    host: fixture.sshHost,
    port: fixture.sshPort,
    username: 'thicket',
    method: 'password',
  });

  // Connect from the sidebar: the unknown host key is asked about first.
  const conn = window.locator('[data-testid="tree-conn"][data-name="Behind bastion"]');
  await conn.click();
  const dialog = window.getByTestId('host-key-dialog');
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const port = fixture.sshPort === 22 ? '' : `:${String(fixture.sshPort)}`;
  await expect(window.getByTestId('host-key-host')).toHaveText(`${fixture.sshHost}${port}`);
  await expect(window.getByTestId('host-key-type')).not.toBeEmpty();
  await expect(window.getByTestId('host-key-fingerprint')).toHaveText(/^SHA256:\S{20,}$/);
  await expect(window.getByTestId('host-key-reject')).toBeFocused();
  await window.getByTestId('host-key-trust').click();
  await expect(dialog).toBeHidden();
  await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });

  // The trusted key is remembered: the next connect asks nothing.
  const knownHosts = await readFile(join(userDataDir, 'known_hosts'), 'utf8');
  expect(knownHosts).toContain(fixture.sshHost);
  await conn.click({ button: 'right' });
  await window.getByTestId('menu-disconnect').click();
  await expect(conn).toHaveAttribute('data-state', 'disconnected');
  await conn.click({ button: 'right' });
  await window.getByTestId('menu-connect').click();
  await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });
  await expect(dialog).toHaveCount(0);

  // Test connection of the saved profile goes through the tunnel too.
  await window.getByTestId('test-connection').click();
  await expect(window.getByTestId('test-ok')).toContainText('(replicaSet)', { timeout: 60_000 });
});
