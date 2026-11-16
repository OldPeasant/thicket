import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Decimal128, Int32, MongoClient } from 'mongodb';

import { expect, test } from './harness';

// Edit session and explicit save (doc-edit-save): edits stay local until Save, which sends the
// minimal `$set` through the write guard; production profiles ask first and show the operation.

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'doc_edit_e2e';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

interface Flags {
  readOnly?: boolean;
  production?: boolean;
}

async function saveProfile(window: Page, name: string, uri: string, flags: Flags = {}) {
  const response = await window.evaluate(
    (p) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `save-${p.name}`,
        method: 'profiles.save',
        params: {
          profile: {
            name: p.name,
            connectionString: p.uri,
            readOnly: p.flags.readOnly ?? false,
            production: p.flags.production ?? false,
          },
        },
      }),
    { name, uri, flags },
  );
  expect(response).toMatchObject({ ok: true });
}

/** Three orders `{_id: i, status, total: Decimal128, qty: Int32}` in collection `coll`. */
async function seed(uri: string, coll: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const c = client.db(DB).collection<{ _id: number }>(coll);
    await c.drop().catch(() => undefined);
    await c.insertMany(
      [1, 2, 3].map((i) => ({
        _id: i,
        status: 'open',
        total: Decimal128.fromString(`${i}0.50`),
        qty: new Int32(i),
      })),
    );
  } finally {
    await client.close();
  }
}

/** A seeded order as stored, with BSON types kept. */
interface StoredOrder {
  _id: number;
  status?: string;
  total?: Decimal128;
  qty?: Int32;
}

/** The stored document `_id` of `coll`, with BSON types kept (no promotion to JS numbers). */
async function stored(uri: string, coll: string, id: number) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await client
      .db(DB)
      .collection<StoredOrder>(coll)
      .findOne({ _id: id }, { promoteValues: false });
  } finally {
    await client.close();
  }
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

/** Connects the profile and opens the collection in the document list view. */
async function openCollection(window: Page, profile: string, coll: string): Promise<void> {
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', profile);
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', coll).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–3');
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(3);
}

/** The value input of field `key` in the `n`th document of the list. */
function fieldInput(window: Page, n: number, key: string): Locator {
  return window
    .getByTestId('result-doc')
    .nth(n)
    .locator(`.field[data-node$=".${key}"] app-bson-input input`)
    .first();
}

/** Types a value and leaves the field (the explorer applies typed values on blur). */
async function typeValue(window: Page, n: number, key: string, value: string): Promise<void> {
  const input = fieldInput(window, n, key);
  await input.fill(value);
  await input.press('Tab');
}

test('edit two fields and save: the server document matches', async ({ window, mongo }) => {
  test.setTimeout(90_000);
  const coll = 'orders_plain';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Local', mongo.uri);
  await openCollection(window, 'Local', coll);

  await window.getByTestId('edit-mode').click();
  await expect(window.getByTestId('edit-mode')).toHaveAttribute('aria-pressed', 'true');
  await typeValue(window, 0, 'total', '99.95');
  await expect(window.getByTestId('edit-count')).toHaveText('1 change');
  await typeValue(window, 0, 'qty', '7');
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  await expect(window.getByTestId('result-doc').first().getByTestId('doc-changes')).toHaveText(
    '2 changes',
  );

  // Nothing reached the server before Save.
  const before = await stored(mongo.uri, coll, 1);
  expect(before?.['total']?.toString()).toBe('10.50');

  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'doc-edit-modified.png') });

  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
  await expect(window.getByTestId('edit-count')).toHaveCount(0);

  // Checked with the driver: both fields changed, their types kept (Decimal128, Int32), the
  // other fields and documents untouched.
  const after = await stored(mongo.uri, coll, 1);
  expect(after?.['total']).toBeInstanceOf(Decimal128);
  expect(after?.['total']?.toString()).toBe('99.95');
  expect(after?.['qty']).toBeInstanceOf(Int32);
  expect(Number(after?.['qty'])).toBe(7);
  expect(after?.['status']).toBe('open');
  expect(Object.keys(after ?? {})).toEqual(['_id', 'status', 'total', 'qty']);
  const other = await stored(mongo.uri, coll, 2);
  expect(other?.['total']?.toString()).toBe('20.50');
  expect(Number(other?.['qty'])).toBe(2);

  // The page shows the saved version.
  await expect(fieldInput(window, 0, 'qty')).toHaveValue('7');
  await window.screenshot({ path: join(SHOTS, 'doc-edit-saved.png') });
});

test('production profile: Save shows the confirm dialog with the $set operation first', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_prod';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Prod', mongo.uri, { production: true });
  await openCollection(window, 'Prod', coll);

  await window.getByTestId('edit-mode').click();
  await typeValue(window, 1, 'total', '42.00');
  await typeValue(window, 1, 'qty', '5');
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');

  await window.getByTestId('edit-save').click();
  const dialog = window.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/production/);
  const operation = window.getByTestId('confirm-operation');
  await expect(operation).toContainText(
    'db.getSiblingDB("doc_edit_e2e").getCollection("orders_prod").updateOne(',
  );
  await expect(operation).toContainText('$set: {');
  await expect(operation).toContainText('total: NumberDecimal("42.00")');
  await expect(operation).toContainText('qty: 5');
  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'doc-edit-production-confirm.png') });

  // Nothing is written while the dialog is open; cancelling keeps the edits.
  expect((await stored(mongo.uri, coll, 2))?.['total']?.toString()).toBe('20.50');
  await window.getByTestId('confirm-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  expect((await stored(mongo.uri, coll, 2))?.['total']?.toString()).toBe('20.50');

  // Confirming saves.
  await window.getByTestId('edit-save').click();
  await expect(dialog).toBeVisible();
  await window.getByTestId('confirm-ok').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 2.');
  const after = await stored(mongo.uri, coll, 2);
  expect(after?.['total']?.toString()).toBe('42.00');
  expect(Number(after?.['qty'])).toBe(5);
});

test('read-only profile: edit controls are disabled', async ({ window, mongo }) => {
  test.setTimeout(90_000);
  const coll = 'orders_ro';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, 'Reports', mongo.uri, { readOnly: true });
  await openCollection(window, 'Reports', coll);

  for (const id of ['edit-mode', 'doc-insert', 'edit-save']) {
    await expect(window.getByTestId(id)).toBeDisabled();
  }
  const first = window.getByTestId('result-doc').first();
  await expect(first.getByTestId('doc-clone')).toBeDisabled();
  await expect(first.getByTestId('doc-delete')).toBeDisabled();
  await expect(first.locator('app-bson-input input')).toHaveCount(0);
  await window.getByTestId('view-table').click();
  await expect(window.locator('app-json-explorer .mode-toggle')).toBeDisabled();
  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'doc-edit-read-only.png') });
});
