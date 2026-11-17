import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { Decimal128, Long, MongoClient, ObjectId } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'io_e2e';
const COLL = 'orders';
const TOTAL = 1_234;

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

/** The fixture: documents with types that relaxed JSON would lose (long, decimal, dates, ids). */
function fixtureDocs() {
  return Array.from({ length: TOTAL }, (_, i) => ({
    _id: new ObjectId(),
    n: i,
    big: Long.fromString(`9007199254740${String(i).padStart(3, '0')}`),
    price: Decimal128.fromString(`${i}.25`),
    at: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    group: i % 3,
    tags: [`t${i % 5}`, 'all'],
    nested: { name: `order ${i}`, ok: i % 2 === 0 },
  }));
}

async function seed(uri: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.db(DB).collection(COLL).insertMany(fixtureDocs());
  } finally {
    await client.close();
  }
}

/** All documents of a collection, sorted by `n`, as canonical EJSON-comparable objects. */
async function readAll(uri: string, coll: string): Promise<unknown[]> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await client.db(DB).collection(coll).find().sort({ n: 1 }).toArray();
  } finally {
    await client.close();
  }
}

async function countOf(uri: string, coll: string, filter: object = {}): Promise<number> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await client.db(DB).collection(coll).countDocuments(filter);
  } finally {
    await client.close();
  }
}

/** The native save/open dialogs of the main process answer `file` without showing anything. */
async function stubDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const d = dialog as unknown as Record<string, unknown>;
    d['showSaveDialog'] = () => Promise.resolve({ canceled: false, filePath: path });
    d['showOpenDialog'] = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('export the fixture, import it into a new collection: counts and documents match', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await seed(mongo.uri);
  const dir = await mkdtemp(join(tmpdir(), 'thicket-io-e2e-'));
  try {
    await window.setViewportSize({ width: 1400, height: 900 });
    await saveProfile(window, 'IO', mongo.uri);
    await window.getByTestId('sidebar-refresh').click();
    const conn = treeNode(window, 'conn', 'IO');
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected');
    await treeNode(window, 'db', DB).click();
    await treeNode(window, 'coll', COLL).click();
    await expect(window.getByTestId('pager-rows')).toContainText('1–50');

    // Export the whole collection as canonical EJSON (JSON array).
    const jsonFile = join(dir, 'orders.json');
    await stubDialogs(electronApp, jsonFile);
    await window.getByTestId('io-export').click();
    await window.getByTestId('export-format-json').check();
    await window.getByTestId('export-mode-canonical').check();
    await expect(window.getByTestId('export-command')).toHaveText('db.orders.find({})');
    await window.getByTestId('export-start').click();
    await expect(window.getByTestId('export-count')).toHaveText('1,234');
    await expect(window.getByTestId('export-path')).toHaveText(jsonFile);
    const exported = JSON.parse(await readFile(jsonFile, 'utf8')) as unknown[];
    expect(exported).toHaveLength(TOTAL);
    expect(JSON.stringify(exported[0])).toContain('$numberLong');
    await mkdir(SHOTS, { recursive: true });
    await screenshot(electronApp, window, join(SHOTS, 'io-export.png'));

    // Import the file into a new collection.
    await window.getByTestId('export-close').click();
    await window.getByTestId('io-import').click();
    await window.getByTestId('import-format-json').check();
    await window.getByTestId('import-choose').click();
    await expect(window.getByTestId('import-file')).toContainText('orders.json');
    await expect(window.getByTestId('import-sample')).toHaveCount(5);
    await expect(window.getByTestId('import-sample').first()).toContainText('NumberLong(');
    await window.getByTestId('import-coll').fill('orders_copy');
    await screenshot(electronApp, window, join(SHOTS, 'io-import-preview.png'));
    await window.getByTestId('import-start').click();
    await expect(window.getByTestId('import-count')).toHaveText('1,234');
    await screenshot(electronApp, window, join(SHOTS, 'io-import-done.png'));

    // Counts match, and the documents are the same (types included).
    expect(await countOf(mongo.uri, 'orders_copy')).toBe(TOTAL);
    expect(await readAll(mongo.uri, 'orders_copy')).toEqual(await readAll(mongo.uri, COLL));
    // The new collection shows up in the sidebar.
    await expect(treeNode(window, 'coll', 'orders_copy')).toBeVisible();

    // The current query's results as JSON Lines (relaxed): only group 1, imported elsewhere.
    const jsonlFile = join(dir, 'group1.jsonl');
    await stubDialogs(electronApp, jsonlFile);
    await window.getByTestId('query-filter').fill('{ group: 1 }');
    await window.getByTestId('query-run').click();
    await window.getByTestId('io-export').click();
    await window.getByTestId('export-format-jsonl').check();
    await window.getByTestId('export-mode-relaxed').check();
    await expect(window.getByTestId('export-command')).toHaveText('db.orders.find({ group: 1 })');
    await window.getByTestId('export-start').click();
    const group1 = await countOf(mongo.uri, COLL, { group: 1 });
    await expect(window.getByTestId('export-count')).toHaveText(group1.toLocaleString('en-US'));
    const lines = (await readFile(jsonlFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(group1);
    await window.getByTestId('io-import').click();
    await window.getByTestId('import-format-jsonl').check();
    await window.getByTestId('import-choose').click();
    await window.getByTestId('import-coll').fill('group1');
    await window.getByTestId('import-start').click();
    await expect(window.getByTestId('import-count')).toHaveText(group1.toLocaleString('en-US'));
    expect(await countOf(mongo.uri, 'group1')).toBe(group1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
