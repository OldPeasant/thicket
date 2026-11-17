import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Decimal128, MongoClient, ObjectId, type Collection } from 'mongodb';

import {
  containerRuntimeUnavailable,
  expect,
  startMongoSpec,
  test,
  type E2EMongo,
} from '../harness';

/*
 * M1 end-to-end demo: SPEC.md section 2, steps 2–7, in one walk through the built app.
 *
 * Instead of Atlas (`mongodb+srv://`) the server is the int-harness TLS replica set: a single-member
 * replica set `rs0` with `requireTLS` and a test CA generated at run time. The pasted connection
 * string is therefore `mongodb://user:password@host:port/?tls=true&tlsCAFile=…&replicaSet=rs0
 * &directConnection=true` (directConnection: the member's own name, localhost:27017, is not
 * reachable from the host).
 *
 * Checklist (SPEC demo step -> what this test does and checks):
 *
 * [x] 2. Paste a connection string; the form fills in host, user and options; the password goes to
 *        the OS keychain; mark the connection production; connect.
 *        -> welcome "New connection", paste the URI into the Connection string tab; the form tab
 *           shows host, port, user, TLS + CA file, replica set; the password is not in
 *           connections.json but secrets.bin was written; "Production" checked; Test connection
 *           succeeds; Save; connect from the sidebar; the shell shows the production accent.
 * [x] 3. Sidebar shows databases and collections (with document counts and sizes); open `orders`.
 *        -> `shop` and `orders` in the tree, "Stats" shows "40,000 docs, …"; click opens the tab.
 * [x] 4. Table, one row per document, 50 per page; page 3 of ~40 000 one click away; filter
 *        `{status: "open", total: {$gt: 100}}` and a sort; results update.
 *        -> 50 table rows, "~40,000", "of ~800"; page field 3 -> rows 101–150; filter + sort
 *           `{total: -1}` -> the first document is the largest open order.
 * [x] 5. Open a document: nested `items` (2 000 subdocuments) pages inside the document; `_id`
 *        ObjectId, `createdAt` Date, `total` Decimal128.
 *        -> list view, first document: "1–100 of 2,000 items", Next -> "101–200 …"; type badges
 *           objectId / date / decimal.
 * [x] 6. Edit `total` and set a new field; diff bar "2 changes"; Save; production confirm lists the
 *        `$set`; save succeeds.
 *        -> edit mode, total = 1234.56, new field `reviewed` = "yes"; "2 changes"; Save -> confirm
 *           dialog (production) shows updateOne with $set total NumberDecimal and reviewed; OK ->
 *           "Saved ObjectId(…)."; the driver reads the new values.
 * [x] 7. Change the same document elsewhere, edit it again in Thicket, Save: conflict, both
 *        versions side by side.
 *        -> the driver (the "second window") sets total 1500.00 and status "shipped"; edit total
 *           again (777.00); Save (+ production confirm) -> conflict view with local and server
 *           columns, total and status rows differ; the failed save wrote nothing.
 *
 * Screenshots of each step (Business style, light mode) go to $THICKET_M1_SHOTS (default
 * test-results/m1); the committed set is in reviews/m1-e2e/.
 */

const SHOTS = process.env['THICKET_M1_SHOTS'] ?? join('test-results', 'm1');
const DB = 'shop';
const COLL = 'orders';
const TOTAL = 40_000;
const ITEMS = 2_000;
const PROFILE = 'Shop (production)';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

interface Order {
  _id: ObjectId;
  status: string;
  total: Decimal128;
  createdAt: Date;
  customer: string;
  items: { sku: string; qty: number }[];
  reviewed?: string;
}

/** The demo document: open, the largest total, 2 000 items. */
const DEMO_ID = new ObjectId();

let server: E2EMongo | undefined;
let unavailable: string | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  unavailable = await containerRuntimeUnavailable();
  if (unavailable) return;
  server = await startMongoSpec({ version: '8', replicaSet: true, tls: true });
  await seed(server);
});

test.afterAll(async () => {
  await server?.stop();
});

async function withOrders<T>(mongo: E2EMongo, body: (c: Collection<Order>) => Promise<T>) {
  const client = new MongoClient(mongo.uri, {
    serverSelectionTimeoutMS: 10_000,
    tls: true,
    tlsCAFile: mongo.tlsCaFile,
  });
  try {
    return await body(client.db(DB).collection<Order>(COLL));
  } finally {
    await client.close();
  }
}

/** 40 000 orders (a quarter of them open, totals 0.00–399.99) plus the demo document. */
async function seed(mongo: E2EMongo): Promise<void> {
  const statuses = ['open', 'paid', 'shipped', 'cancelled'];
  const base = Date.UTC(2026, 0, 1);
  await withOrders(mongo, async (c) => {
    await c.drop().catch(() => undefined);
    const batch: Order[] = [];
    for (let i = 0; i < TOTAL - 1; i++) {
      batch.push({
        _id: new ObjectId(),
        status: statuses[i % 4] as string,
        total: Decimal128.fromString((((i * 37) % 40_000) / 100).toFixed(2)),
        createdAt: new Date(base + i * 60_000),
        customer: `customer ${i % 997}`,
        items: [
          { sku: `SKU-${i % 50}`, qty: 1 },
          { sku: `SKU-${(i + 7) % 50}`, qty: 2 },
        ],
      });
      if (batch.length === 5_000) await c.insertMany(batch.splice(0));
    }
    batch.push({
      _id: DEMO_ID,
      status: 'open',
      total: Decimal128.fromString('9999.95'),
      createdAt: new Date(base),
      customer: 'demo customer',
      items: Array.from({ length: ITEMS }, (_, i) => ({
        sku: `ITEM-${String(i).padStart(4, '0')}`,
        qty: (i % 9) + 1,
      })),
    });
    await c.insertMany(batch);
  });
}

/** Creates a user with a generated password (never committed; the fixture runs without --auth). */
async function createUser(mongo: E2EMongo): Promise<{ username: string; password: string }> {
  const username = `demo_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('base64url');
  const client = new MongoClient(mongo.uri, { tls: true, tlsCAFile: mongo.tlsCaFile });
  try {
    await client.db('admin').command({ createUser: username, pwd: password, roles: ['root'] });
  } finally {
    await client.close();
  }
  return { username, password };
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

async function shot(window: Page, name: string): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  // Let fonts and transitions settle so the screenshots are stable.
  await window.evaluate(async () => {
    await (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document
      .fonts.ready;
  });
  await window.waitForTimeout(300);
  await window.screenshot({ path: join(SHOTS, name) });
}

/** The value input of top-level field `key` in the first document of the list. */
function fieldInput(doc: Locator, key: string): Locator {
  return doc.locator(`.field[data-node$=".${key}"]`).first().locator('input').last();
}

async function typeValue(doc: Locator, key: string, value: string): Promise<void> {
  const input = fieldInput(doc, key);
  await input.fill(value);
  await input.press('Tab');
}

/** Clicks Save and, because the profile is production, confirms the operation dialog. */
async function saveConfirmed(window: Page, check?: (operation: Locator) => Promise<void>) {
  await window.getByTestId('edit-save').click();
  const dialog = window.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/production/);
  if (check) await check(window.getByTestId('confirm-operation'));
  await window.getByTestId('confirm-ok').click();
  await expect(dialog).toBeHidden();
}

test('M1 demo, steps 2–7, against a TLS replica set', async ({ window, userDataDir }) => {
  test.skip(unavailable !== undefined, unavailable);
  test.setTimeout(240_000);
  const mongo = server as E2EMongo;
  const user = await createUser(mongo);
  await window.setViewportSize({ width: 1400, height: 900 });
  const settings = await window.evaluate(
    (s) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: 'm1-settings',
        method: 'app.settings.set',
        params: { settings: s },
      }),
    { style: 'business', mode: 'light' },
  );
  expect(settings).toMatchObject({ ok: true });
  await expect(window.locator('html')).toHaveAttribute('data-style', 'business');
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');

  await test.step('2. paste the connection string, mark production, connect', async () => {
    await window.getByTestId('welcome-new').click();
    await expect(window.getByTestId('connection-editor')).toBeVisible();
    await window.getByTestId('field-name').fill(PROFILE);
    await window.getByTestId('tab-uri').click();
    const uri =
      `mongodb://${user.username}:${encodeURIComponent(user.password)}@${mongo.host}:${String(mongo.port)}` +
      `/?tls=true&tlsCAFile=${encodeURIComponent(mongo.tlsCaFile ?? '')}&replicaSet=rs0&directConnection=true`;
    await window.getByTestId('field-uri').fill(uri);
    await expect(window.getByTestId('uri-error')).toHaveCount(0);

    // The form filled in host, user and options; the password sits in its (masked) field.
    await window.getByTestId('tab-form').click();
    await expect(window.getByTestId('field-host').first()).toHaveValue(mongo.host);
    await expect(window.getByTestId('field-port').first()).toHaveValue(String(mongo.port));
    await expect(window.getByTestId('field-username')).toHaveValue(user.username);
    await expect(window.getByTestId('field-password')).toHaveValue(user.password);
    await expect(window.getByTestId('field-password')).toHaveAttribute('type', 'password');
    await expect(window.getByTestId('field-tls')).toBeChecked();
    await expect(window.getByTestId('field-ca-file')).toHaveValue(mongo.tlsCaFile ?? '');
    await expect(window.getByTestId('field-replica-set')).toHaveValue('rs0');
    await expect(window.getByTestId('uri-preview')).not.toContainText(user.password);

    await window.getByTestId('field-production').check();
    await window.getByTestId('secret-saved').check();
    await window.getByTestId('test-connection').click();
    await expect(window.getByTestId('test-ok')).toContainText('Connected in', { timeout: 30_000 });
    await shot(window, 'step-2-connection-form.png');

    await window.getByTestId('save').click();
    await expect(window.getByTestId('saved-notice')).toBeVisible();
    // The password went to the secret store (OS keychain), not to the profile file.
    const profiles = await readFile(join(userDataDir, 'connections.json'), 'utf8');
    expect(profiles).toContain(user.username);
    expect(profiles).not.toContain(user.password);
    expect((await stat(join(userDataDir, 'secrets.bin'))).size).toBeGreaterThan(0);

    const conn = treeNode(window, 'conn', PROFILE);
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  });

  await test.step('3. sidebar: databases, collections with counts and sizes; open orders', async () => {
    await treeNode(window, 'db', DB).click();
    const orders = treeNode(window, 'coll', COLL);
    await expect(orders).toBeVisible();
    await orders.click({ button: 'right' });
    await window.getByTestId('menu-stats').click();
    await expect(orders.getByTestId('node-stats')).toHaveText(/^40\D?000 docs, \d/);
    await orders.click();
    await expect(window.locator('[data-testid="tab"][data-tab-id$="shop.orders"]')).toBeVisible();
    // Production: red accent on the shell and the tab.
    await expect(window.locator('app-shell')).toHaveClass(/production/);
    await shot(window, 'step-3-sidebar.png');
  });

  await test.step('4. table, 50 per page, page 3 one click away, filter and sort', async () => {
    const rows = window.getByTestId('pager-rows');
    await expect(rows).toContainText('1–50');
    await expect(rows).toContainText('~40,000');
    await expect(window.getByTestId('pager-pages')).toHaveText('of ~800');
    await window.getByTestId('view-table').click();
    await expect(
      window.locator('app-json-explorer .json-output > app-json-table > .tw > table > tbody > tr'),
    ).toHaveCount(50);
    await shot(window, 'step-4-table.png');

    // Page 3 by its number in the page field (Next twice gets there too).
    await window.getByTestId('pager-page').fill('3');
    await window.getByTestId('pager-page').press('Enter');
    await expect(rows).toContainText(/^101–150 of ~40,000/);
    await expect(window.getByTestId('pager-page')).toHaveValue('3');

    await window.getByTestId('query-filter').fill('{status: "open", total: {$gt: 100}}');
    await window.getByTestId('query-sort').fill('{total: -1}');
    await window.getByTestId('query-run').click();
    await expect(window.getByTestId('query-errors')).toHaveCount(0);
    await expect(rows).toHaveText('1–50');
    await expect(window.getByTestId('pager-page')).toHaveValue('1');
    await window.getByTestId('view-raw').click();
    const raw = window.getByTestId('raw-text');
    await expect(raw).toContainText(`ObjectId("${DEMO_ID.toHexString()}")`);
    const text = (await raw.textContent()) ?? '';
    expect(text).not.toMatch(/status: "(paid|shipped|cancelled)"/);
    await shot(window, 'step-4-filter-sort.png');
  });

  const doc = window.getByTestId('result-doc').first();

  await test.step('5. open the document: items page inside it, BSON types shown', async () => {
    await window.getByTestId('view-list').click();
    await expect(doc).toBeVisible();
    await expect(
      doc.locator('.field[data-node$="._id"] [data-bson-type="objectId"]').first(),
    ).toBeVisible();
    await expect(
      doc.locator('.field[data-node$=".createdAt"] [data-bson-type="date"]').first(),
    ).toBeVisible();
    await expect(
      doc.locator('.field[data-node$=".total"] [data-bson-type="decimal"]').first(),
    ).toBeVisible();
    const range = doc.getByTestId('nested-pager-range');
    await expect(range).toHaveText('1–100 of 2,000 items');
    await expect(doc.getByText('ITEM-0000', { exact: true })).toBeVisible();
    await doc.getByTestId('nested-pager-next').click();
    await expect(range).toHaveText('101–200 of 2,000 items');
    await expect(doc.getByText('ITEM-0100', { exact: true })).toBeVisible();
    await expect(doc.getByText('ITEM-0000', { exact: true })).toHaveCount(0);
    await shot(window, 'step-5-document.png');
  });

  await test.step('6. edit total, set a new field, 2 changes, production confirm, save', async () => {
    await window.getByTestId('edit-mode').click();
    await typeValue(doc, 'total', '1234.56');
    await expect(window.getByTestId('edit-count')).toHaveText('1 change');
    const addKey = doc.locator('.add-input').last();
    await addKey.fill('reviewed');
    await addKey.press('Enter');
    await typeValue(doc, 'reviewed', 'yes');
    await expect(window.getByTestId('edit-count')).toHaveText('2 changes');
    await shot(window, 'step-6-two-changes.png');

    await saveConfirmed(window, async (operation) => {
      await expect(operation).toContainText(
        'db.getSiblingDB("shop").getCollection("orders").updateOne(',
      );
      await expect(operation).toContainText('$set: {');
      await expect(operation).toContainText('total: NumberDecimal("1234.56")');
      await expect(operation).toContainText('reviewed: "yes"');
      await shot(window, 'step-6-production-confirm.png');
    });
    await expect(window.getByTestId('edit-message')).toHaveText(
      `Saved ObjectId("${DEMO_ID.toHexString()}").`,
    );
    const saved = await withOrders(mongo, (c) => c.findOne({ _id: DEMO_ID }));
    expect(saved?.total.toString()).toBe('1234.56');
    expect(saved?.reviewed).toBe('yes');
    expect(saved?.items).toHaveLength(ITEMS);
  });

  await test.step('7. a concurrent change makes the next save a conflict, side by side', async () => {
    // The "second window": another client changes the same document, including `total`. The
    // conflict check covers the fields the save changes (SPEC: `_id` plus their original values).
    await withOrders(mongo, (c) =>
      c.updateOne(
        { _id: DEMO_ID },
        { $set: { total: Decimal128.fromString('1500.00'), status: 'shipped' } },
      ),
    );
    await typeValue(doc, 'total', '777.00');
    await expect(window.getByTestId('edit-count')).toHaveText('1 change');
    await saveConfirmed(window);
    const view = window.getByTestId('conflict-view');
    await expect(view).toBeVisible();
    await expect(window.getByTestId('edit-message')).toContainText('changed on the server');
    // Side by side: the user's version left, the server's right, the differing lines marked.
    const changed = view.locator('[data-testid="conflict-row"][data-kind="changed"]');
    const totalRow = changed.filter({ hasText: 'total' });
    await expect(totalRow.getByTestId('conflict-local')).toContainText('777.00');
    await expect(totalRow.getByTestId('conflict-server')).toContainText('1500.00');
    const statusRow = changed.filter({ hasText: 'status' });
    await expect(statusRow.getByTestId('conflict-local')).toContainText('status: "open"');
    await expect(statusRow.getByTestId('conflict-server')).toContainText('status: "shipped"');
    await shot(window, 'step-7-conflict.png');
    // The failed save wrote nothing.
    const stored = await withOrders(mongo, (c) => c.findOne({ _id: DEMO_ID }));
    expect(stored?.status).toBe('shipped');
    expect(stored?.total.toString()).toBe('1500.00');
  });
});
