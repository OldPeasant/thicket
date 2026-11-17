import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { BSON, Decimal128, Int32, MongoClient } from 'mongodb';

import { expect, screenshot, test } from './harness';

// "Undo last save" (undo-last-save): Thicket keeps the pre-save version of a document's last save
// and writes it back with the same conflict check as Save. The server state is checked with the
// driver.

const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');
const DB = 'undo_save_e2e';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

interface Order {
  _id: number;
  status?: string;
  total?: Decimal128;
  qty?: Int32;
}

async function withColl<T>(
  uri: string,
  coll: string,
  body: (c: import('mongodb').Collection<Order>) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await body(client.db(DB).collection<Order>(coll));
  } finally {
    await client.close();
  }
}

/** Three orders `{_id: i, status, total: Decimal128, qty: Int32}`. */
async function seed(uri: string, coll: string): Promise<void> {
  await withColl(uri, coll, async (c) => {
    await c.drop().catch(() => undefined);
    await c.insertMany(
      [1, 2, 3].map((i) => ({
        _id: i,
        status: 'open',
        total: Decimal128.fromString(`${i}0.50`),
        qty: new Int32(i),
      })),
    );
  });
}

/** The stored document as canonical EJSON (types and field order kept). */
async function storedText(uri: string, coll: string, id: number): Promise<string> {
  const doc = await withColl(uri, coll, (c) => c.findOne({ _id: id }, { promoteValues: false }));
  return BSON.EJSON.stringify(doc, { relaxed: false });
}

async function saveProfile(window: Page, uri: string): Promise<void> {
  const response = await window.evaluate(
    (connectionString) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: 'save-local',
        method: 'profiles.save',
        params: {
          profile: { name: 'Local', connectionString, readOnly: false, production: false },
        },
      }),
    uri,
  );
  expect(response).toMatchObject({ ok: true });
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

async function openCollection(window: Page, coll: string): Promise<void> {
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Local');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', coll).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–3');
  await window.getByTestId('view-list').click();
  await expect(window.getByTestId('result-doc')).toHaveCount(3);
  await window.getByTestId('edit-mode').click();
  await expect(window.getByTestId('edit-mode')).toHaveAttribute('aria-pressed', 'true');
}

async function typeValue(window: Page, n: number, key: string, value: string): Promise<void> {
  const input = window
    .getByTestId('result-doc')
    .nth(n)
    .locator(`.field[data-node$=".${key}"] app-bson-input input`)
    .first();
  await input.fill(value);
  await input.press('Tab');
}

/** Edits two fields of the first document and saves them. */
async function editAndSave(window: Page): Promise<void> {
  await typeValue(window, 0, 'total', '99.95');
  await typeValue(window, 0, 'qty', '7');
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
}

test('save, then Undo last save: the server document equals the original', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo';
  await seed(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  const first = window.getByTestId('result-doc').first();
  await expect(first.getByTestId('doc-undo-save')).toHaveCount(0);
  await editAndSave(window);
  expect(await storedText(mongo.uri, coll, 1)).not.toBe(original);

  const undo = first.getByTestId('doc-undo-save');
  await expect(undo).toBeEnabled();
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'undo-last-save-offered.png'));
  await undo.click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');

  // Checked with the driver: the same fields, types and order as before the save.
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
  await expect(undo).toHaveCount(0);
  await expect(window.getByTestId('edit-count')).toHaveCount(0);
});

test('Undo last save reports a conflict instead of overwriting a newer server change', async ({
  electronApp,
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_conflict';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await editAndSave(window);
  // Another client changes a saved field.
  await withColl(mongo.uri, coll, (c) => c.updateOne({ _id: 1 }, { $set: { qty: new Int32(8) } }));
  const changed = await storedText(mongo.uri, coll, 1);

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  const message = window.getByTestId('edit-message');
  await expect(message).toContainText(
    'Not undone: the document was changed on the server since the save.',
  );
  await mkdir(SHOTS, { recursive: true });
  await screenshot(electronApp, window, join(SHOTS, 'undo-last-save-conflict.png'));

  // Nothing was overwritten.
  expect(await storedText(mongo.uri, coll, 1)).toBe(changed);
  await expect(window.getByTestId('result-doc').first().getByTestId('doc-undo-save')).toHaveCount(
    0,
  );
});

/** Deletes the top-level field `key` of the first document with its "Delete key" button and saves. */
async function removeFieldAndSave(window: Page, key: string): Promise<void> {
  await window
    .getByTestId('result-doc')
    .first()
    .locator(`.field[data-node$=".${key}"] .del-btn`)
    .first()
    .click();
  await expect(window.getByTestId('edit-count')).toHaveText('1 change');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
}

// Added by the test-writer: a save that removes a field. MongoDB appends a field that $set adds
// back, so only the replace path restores the original field order.
test('Undo last save of a removed field restores it in its original place', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_removed';
  await seed(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await removeFieldAndSave(window, 'status');
  const saved = await withColl(mongo.uri, coll, (c) => c.findOne({ _id: 1 }));
  expect(saved).not.toHaveProperty('status');

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');
  // Same fields, types and order (status before total again).
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
});

// Added by the test-writer, TW-1: the undo of a field removal replaces the whole document, but
// its conflict check covers only the removed field, so a newer server change to another field
// would be overwritten. Expected (acceptance criterion 2): a conflict, nothing overwritten.
test('Undo last save of a removed field does not overwrite a newer change to another field', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_removed_conflict';
  await seed(mongo.uri, coll);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  await removeFieldAndSave(window, 'status');
  // Another client changes qty, a field the save did not touch.
  await withColl(mongo.uri, coll, (c) => c.updateOne({ _id: 1 }, { $set: { qty: new Int32(8) } }));
  const changed = await storedText(mongo.uri, coll, 1);

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toContainText('Not undone');

  expect(await storedText(mongo.uri, coll, 1)).toBe(changed);
});

// Added by the test-writer (round 2): the whole-document conflict check of the replace path
// (CR-1/TW-1 fix) on a real MongoDB, with BSON-typed values in its `$eq` checks.

/** A document with a numeric `_id` and any other fields. */
type AnyDoc = { _id: number } & Record<string, unknown>;

/** `{_id: i, status, addr: {city}, placed: Date, ref: ObjectId, tags, total: Decimal128, qty}`. */
async function seedTyped(uri: string, coll: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const c = client.db(DB).collection<AnyDoc>(coll);
    await c.drop().catch(() => undefined);
    await c.insertMany(
      [1, 2, 3].map((i) => ({
        _id: i,
        status: 'open',
        addr: { city: 'Springfield' },
        placed: new Date(`2026-01-1${i}T10:00:00.000Z`),
        ref: new BSON.ObjectId(`65000000000000000000000${i}`),
        tags: ['gift', 'rush'],
        total: Decimal128.fromString(`${i}0.50`),
        qty: new Int32(i),
      })),
    );
  } finally {
    await client.close();
  }
}

/** Another client's update of the first document. */
async function changeOnServer(
  uri: string,
  coll: string,
  update: Record<string, unknown>,
): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db(DB).collection<AnyDoc>(coll).updateOne({ _id: 1 }, update);
  } finally {
    await client.close();
  }
}

test('Undo last save of a removed field restores Date, ObjectId, Decimal128, nested and array values', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_typed';
  await seedTyped(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  // status is not the last field: the undo is a replace, checked against every saved value.
  await removeFieldAndSave(window, 'status');
  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
});

const SERVER_CHANGES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['a field added on the server', { $set: { note: 'call first' } }],
  ['a nested sub-field changed on the server', { $set: { 'addr.city': 'Shelbyville' } }],
  ['an untouched field removed on the server', { $unset: { tags: '' } }],
  ['a Date changed on the server', { $set: { placed: new Date('2026-02-01T00:00:00.000Z') } }],
  // Added by the fixer (CR-1): query `$eq` would match an array that contains the saved value.
  [
    'a field turned into an array containing its saved value',
    { $set: { qty: [new Int32(1), new Int32(7)] } },
  ],
];

for (const [what, update] of SERVER_CHANGES) {
  test(`Undo last save of a removed field reports a conflict for ${what}`, async ({
    window,
    mongo,
  }) => {
    test.setTimeout(90_000);
    const coll = 'orders_undo_whole_check';
    await seedTyped(mongo.uri, coll);
    await window.setViewportSize({ width: 1400, height: 900 });
    await saveProfile(window, mongo.uri);
    await openCollection(window, coll);

    await removeFieldAndSave(window, 'status');
    await changeOnServer(mongo.uri, coll, update);
    const changed = await storedText(mongo.uri, coll, 1);

    const undo = window.getByTestId('result-doc').first().getByTestId('doc-undo-save');
    await undo.click();
    await expect(window.getByTestId('edit-message')).toContainText(
      'Not undone: the document was changed on the server since the save.',
    );
    // Nothing was overwritten, and the undo is no longer offered.
    expect(await storedText(mongo.uri, coll, 1)).toBe(changed);
    await expect(undo).toHaveCount(0);
  });
}

// A save that adds two sub-fields to an embedded document. `$eq` on an embedded document compares
// its field order too, so the undo's check must expect the order MongoDB stored them in.
test('Undo last save of two sub-fields added to an embedded document restores the original', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_nested_added';
  await seedTyped(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  const addKey = window
    .getByTestId('result-doc')
    .first()
    .locator('.field[data-node$=".addr"] .add-input')
    .first();
  await addKey.fill('zip');
  await addKey.press('Enter');
  await addKey.fill('apt');
  await addKey.press('Enter');
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');
  const saved = await withColl(mongo.uri, coll, (c) => c.findOne({ _id: 1 }));
  expect(Object.keys((saved as unknown as { addr: object }).addr).sort()).toEqual([
    'apt',
    'city',
    'zip',
  ]);

  await window.getByTestId('result-doc').first().getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
});

// The last two fields, total then qty (not in name order), removed in one save: the undo's $set
// adds both back at the end, and they must come back in their original order.
test('Undo last save of the last two fields restores them in their original order', async ({
  window,
  mongo,
}) => {
  test.setTimeout(90_000);
  const coll = 'orders_undo_last_two';
  await seedTyped(mongo.uri, coll);
  const original = await storedText(mongo.uri, coll, 1);
  await window.setViewportSize({ width: 1400, height: 900 });
  await saveProfile(window, mongo.uri);
  await openCollection(window, coll);

  const first = window.getByTestId('result-doc').first();
  await first.locator('.field[data-node$=".total"] .del-btn').first().click();
  await first.locator('.field[data-node$=".qty"] .del-btn').first().click();
  await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
  await window.getByTestId('edit-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Saved 1.');

  await first.getByTestId('doc-undo-save').click();
  await expect(window.getByTestId('edit-message')).toHaveText('Undid the last save of 1.');
  // Same fields, types and order (total before qty again).
  expect(await storedText(mongo.uri, coll, 1)).toBe(original);
});
