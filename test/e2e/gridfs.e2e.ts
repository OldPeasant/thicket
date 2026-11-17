import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

// Task gridfs: upload a file into a bucket from the GridFS tab, download it again, delete it
// (with the confirm dialog). The native open/save dialogs of main are stubbed to a temp path.

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'gridfs_e2e';
const SIZE = 3 * 1024 * 1024 + 123;

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

/** The native save/open dialogs of the main process answer `file` without showing anything. */
async function stubDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>;
    d['showSaveDialog'] = () => Promise.resolve({ canceled: false, filePath: path });
    d['showOpenDialog'] = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
}

function treeNode(window: Page, kind: 'conn' | 'db', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

async function withClient<T>(uri: string, work: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('upload a file into GridFS from the UI, download it, and delete it', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  // The database must exist to show in the tree: one ordinary collection, no bucket yet.
  await withClient(mongo.uri, async (client) => {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.db(DB).collection('notes').insertOne({ note: 'gridfs e2e' });
  });
  const dir = await mkdtemp(join(tmpdir(), 'thicket-gridfs-e2e-'));
  try {
    const source = join(dir, 'report.bin');
    const content = randomBytes(SIZE);
    await writeFile(source, content);

    await window.setViewportSize({ width: 1400, height: 900 });
    await saveProfile(window, 'GridFS', mongo.uri);
    await window.getByTestId('sidebar-refresh').click();
    const conn = treeNode(window, 'conn', 'GridFS');
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected');
    await treeNode(window, 'db', DB).click({ button: 'right' });
    await window.getByTestId('menu-gridfs').click();

    await expect(window.getByTestId('gridfs-call')).toHaveText(
      'db.getGridFSBucket({ bucketName: "fs" }).find()',
    );
    await expect(window.getByTestId('gridfs-empty')).toContainText('fs has no files yet');

    // Upload.
    await stubDialogs(electronApp, source);
    await window.getByTestId('gridfs-upload').click();
    await expect(window.getByTestId('gridfs-message')).toHaveText('Uploaded report.bin to fs.');
    const row = window.locator('[data-testid="gridfs-row"][data-name="report.bin"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('3 MB');
    await expect(window.getByTestId('gridfs-count')).toHaveText('1 file');
    const stored = await withClient(mongo.uri, (client) =>
      client.db(DB).collection('fs.files').findOne({ filename: 'report.bin' }),
    );
    expect(stored?.['length']).toBe(SIZE);
    await mkdir(SHOTS, { recursive: true });
    await screenshot(electronApp, window, join(SHOTS, 'gridfs-uploaded.png'));

    // Download: the same bytes.
    const target = join(dir, 'copy.bin');
    await stubDialogs(electronApp, target);
    await row.getByTestId('gridfs-download').click();
    await expect(window.getByTestId('gridfs-message')).toHaveText(
      `Downloaded report.bin to ${target}.`,
    );
    expect(sha256(await readFile(target))).toBe(sha256(content));

    // Delete, through the confirm dialog.
    await row.getByTestId('gridfs-delete').click();
    await expect(window.getByTestId('confirm-dialog')).toBeVisible();
    await expect(window.getByTestId('confirm-operation')).toContainText(
      'getGridFSBucket({ bucketName: "fs" }).delete(ObjectId(',
    );
    await screenshot(electronApp, window, join(SHOTS, 'gridfs-delete-confirm.png'));
    await window.getByTestId('confirm-ok').click();
    await expect(window.getByTestId('gridfs-message')).toHaveText('Deleted report.bin.');
    await expect(row).toHaveCount(0);
    await expect(window.getByTestId('gridfs-empty')).toBeVisible();
    const left = await withClient(mongo.uri, async (client) => ({
      files: await client.db(DB).collection('fs.files').countDocuments(),
      chunks: await client.db(DB).collection('fs.chunks').countDocuments(),
    }));
    expect(left).toEqual({ files: 0, chunks: 0 });
    await screenshot(electronApp, window, join(SHOTS, 'gridfs-deleted.png'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await withClient(mongo.uri, (client) => client.db(DB).dropDatabase()).catch(() => undefined);
  }
});
