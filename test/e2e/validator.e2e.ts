import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'val_e2e';
const COLL = 'people';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

async function withClient<T>(uri: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
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

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('validator tab: edit the $jsonSchema validator; failing documents show a marker', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  await withClient(mongo.uri, async (client) => {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client
      .db(DB)
      .collection(COLL)
      .insertMany([
        { _id: 1 as never, name: 'Ada', age: 36 },
        { _id: 2 as never, name: 'Bob' },
        { _id: 3 as never, name: 'Cy', age: 'unknown' },
        { _id: 4 as never, name: 'Dee', age: 41 },
      ]);
  });

  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Val', mongo.uri);
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Val');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–4');
  const collection = window.locator('app-collection-view');
  await collection.getByTestId('view-list').click();
  const docs = collection.getByTestId('result-doc');
  await expect(docs).toHaveCount(4);
  // No validator yet: nothing is marked.
  await expect(collection.getByTestId('doc-invalid')).toHaveCount(0);

  await collection.getByTestId('open-validator').click();
  const view = window.locator('app-validator-view');
  await expect(view).toBeVisible();
  await expect(view.getByTestId('val-state')).toHaveText('No validator');
  await expect(view.getByTestId('val-save')).toBeDisabled();

  // A syntax error is shown and nothing is sent.
  const editor = view.getByTestId('val-text');
  await editor.fill('{ $jsonSchema: { required: ["age" }');
  await view.getByTestId('val-save').click();
  await expect(view.getByTestId('val-error')).toBeVisible();

  await editor.fill(
    '{ $jsonSchema: { bsonType: "object", required: ["name", "age"], properties: { age: { bsonType: "int" } } } }',
  );
  await expect(view.getByTestId('val-error')).toHaveCount(0);
  await view.getByTestId('val-action').selectOption('warn');
  await view.getByTestId('val-save').click();
  await expect(view.getByTestId('val-message')).toHaveText('Saved the validator.');
  await expect(view.getByTestId('val-state')).toHaveText('Validator set');
  // Read back from the server, printed as shell syntax.
  await expect(editor).toHaveValue(/required: \[\s*"name",\s*"age"\s*\]/);

  const options = await withClient(mongo.uri, async (client) => {
    const [info] = (await client.db(DB).listCollections({ name: COLL }).toArray()) as {
      options?: Record<string, unknown>;
    }[];
    return info?.options;
  });
  expect(options).toMatchObject({
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['name', 'age'],
        properties: { age: { bsonType: 'int' } },
      },
    },
    validationLevel: 'strict',
    validationAction: 'warn',
  });

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'validator-tab.png') });

  // Back in the collection tab, the documents that fail are marked (checked by the server).
  await window
    .locator('[data-testid="tab"]:has([data-kind="collection"]) [role="tab"]')
    .first()
    .click();
  await expect(collection).toBeVisible();
  await expect(collection.getByTestId('doc-invalid')).toHaveCount(2);
  await expect(collection.locator('[data-testid="result-doc"][data-invalid]')).toHaveCount(2);
  await expect(docs.nth(0)).not.toHaveAttribute('data-invalid');
  await expect(docs.nth(1)).toHaveAttribute('data-invalid', 'true');
  await expect(docs.nth(2)).toHaveAttribute('data-invalid', 'true');
  await expect(docs.nth(3)).not.toHaveAttribute('data-invalid');
  await expect(collection.getByTestId('validator-summary')).toContainText(
    '2 documents on this page fail the validator',
  );
  await window.screenshot({ path: join(SHOTS, 'validator-marks.png') });

  // Fixing a document on the server and running the query again clears its marker.
  await withClient(mongo.uri, (client) =>
    client
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: 2 as never }, { $set: { age: 50 } }),
  );
  await collection.getByTestId('query-run').click();
  await expect(collection.getByTestId('doc-invalid')).toHaveCount(1);
  await expect(docs.nth(2)).toHaveAttribute('data-invalid', 'true');
});
