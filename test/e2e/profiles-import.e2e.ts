import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { expect, test } from './harness';

/**
 * Import from a Compass export and from connection strings, then export without secrets
 * (profiles-import-export). The native dialogs answer files in a temp folder.
 */

/** The native open/save dialogs of the main process answer `file` without showing anything. */
async function stubDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>;
    d['showSaveDialog'] = () => Promise.resolve({ canceled: false, filePath: path });
    d['showOpenDialog'] = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
}

function treeConn(window: Page, name: string): Locator {
  return window.locator(`[data-testid="tree-conn"][data-name="${name}"]`);
}

/** A Compass "Export connections" file (plain, plus one passphrase-encrypted entry). */
function compassExport(host: string, port: number, password: string): string {
  return JSON.stringify({
    type: 'Compass Connections',
    version: { $numberInt: '1' },
    connections: [
      {
        id: 'e2e-1',
        connectionOptions: { connectionString: `mongodb://${host}:${String(port)}/` },
        favorite: { name: 'Compass fixture', color: 'color2' },
        savedConnectionType: 'favorite',
      },
      {
        id: 'e2e-2',
        connectionOptions: {
          connectionString: `mongodb://e2e_user:${password}@${host}:${String(port)}/?authSource=admin`,
        },
        favorite: { name: 'Compass with password' },
        savedConnectionType: 'favorite',
      },
      {
        id: 'e2e-3',
        connectionOptions: { connectionString: `mongodb://carol@${host}:${String(port)}/` },
        favorite: { name: 'Compass encrypted' },
        connectionSecrets: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      { id: 'e2e-4', connectionOptions: {}, favorite: { name: 'Compass broken' } },
    ],
  });
}

test('import a Compass export and connection strings: the profiles appear in the sidebar; export has no secrets', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const dir = await mkdtemp(join(tmpdir(), 'thicket-import-e2e-'));
  // Generated per run, never committed.
  const password = `pw-${Math.random().toString(36).slice(2)}`;
  try {
    await window.setViewportSize({ width: 1400, height: 900 });
    const input = join(dir, 'compass-connections.json');
    await writeFile(input, compassExport(mongo.host, mongo.port, password));
    await stubDialogs(electronApp, input);

    // Start page → "Import from Compass" → choose the file.
    await window.getByTestId('welcome-import').click();
    await window.getByTestId('import-file').click();
    await expect(window.getByTestId('import-summary')).toHaveText(
      'Imported 3 connections, skipped 1.',
    );
    await expect(
      window.getByTestId('import-notice').filter({ hasText: 'Compass encrypted' }),
    ).toContainText('encrypted with a passphrase');
    await expect(window.getByTestId('import-skipped')).toContainText('Compass broken');

    for (const name of ['Compass fixture', 'Compass with password', 'Compass encrypted'])
      await expect(treeConn(window, name)).toBeVisible();

    // The imported profile works: it connects to the fixture.
    await treeConn(window, 'Compass fixture').click();
    await expect(treeConn(window, 'Compass fixture')).toHaveAttribute('data-state', 'connected', {
      timeout: 30_000,
    });

    // Connection strings, one per line.
    await window
      .getByTestId('import-uris')
      .fill(`mongodb://${mongo.host}:${String(mongo.port)}/?appName=from-list\n\n`);
    await window.getByTestId('import-uris-submit').click();
    await expect(window.getByTestId('import-summary')).toHaveText('Imported 1 connection.');
    const listName = `${mongo.host}:${String(mongo.port)}`;
    await expect(treeConn(window, listName)).toBeVisible();

    // Export every profile: no password in the file.
    const output = join(dir, 'export.json');
    await stubDialogs(electronApp, output);
    await window.getByTestId('export-all').check();
    await window.getByTestId('export-submit').click();
    await expect(window.getByTestId('export-done')).toContainText('Exported 4 connections');
    const exported = await readFile(output, 'utf8');
    expect(exported).not.toContain(password);
    expect(exported).not.toMatch(/"[^"]*(password|passphrase|token)[^"]*"\s*:/i);
    expect(exported).toContain('Compass with password');
    expect(exported).toContain('"secretMode": "ask"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
