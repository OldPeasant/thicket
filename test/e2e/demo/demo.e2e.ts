import { randomBytes } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
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
import { appDir } from '../harness/app';
import {
  startSshX509Fixture,
  X509_COLL,
  X509_DB,
  X509_DOCS,
  type SshX509Fixture,
} from './ssh-x509';

/*
 * Release demo: SPEC.md section 2, steps 2–11, in one walk through the packaged Linux app (the
 * AppImage built by `npm run dist`, started with APPIMAGE_EXTRACT_AND_RUN=1).
 *
 *   npm run dist && xvfb-run -a npm run test:e2e -- demo
 *
 * The AppImage is $THICKET_APPIMAGE, else the newest apps/desktop/release/*.AppImage; without one
 * the test is skipped (it never falls back to the development build).
 *
 * Fixtures instead of Atlas:
 * - steps 2–9 and 11: a single-member TLS replica set (`requireTLS`, per-run CA) with a user created
 *   by the test; the pasted string is `mongodb://…?tls=true&tlsCAFile=…&replicaSet=rs0
 *   &directConnection=true` instead of `mongodb+srv://` (no SRV records for a container).
 * - step 10: `ssh-x509.ts`, an X.509-only server that is reachable only through an SSH bastion.
 *
 * Checklist (SPEC demo step -> what this test does and checks):
 *  1. (start) the packaged app opens on the welcome screen with "New connection" and "Import from
 *     Compass"; `app.isPackaged` is true.
 *  2. paste the URI -> form shows host, port, user, TLS + CA, replica set; password in the masked
 *     field, not in connections.json nor in plain text in secrets.bin; Production checked; Test
 *     connection OK; Save; connect from the sidebar.
 *  3. sidebar: `shop` / `orders` with "40,000 docs, …"; open orders; production accent.
 *  4. 50 rows per page of ~40,000; page 3 = rows 101–150; filter + sort -> only open orders above
 *     100, descending, exact count equals the driver's.
 *  5. demo document: ObjectId / Date / Decimal128 badges; items pages 1–100, 101–200 of 2,000.
 *  6. edit total + new field -> "2 changes"; Save -> production confirm lists `$set`; saved.
 *  7. concurrent driver update -> next Save is a conflict with both versions side by side.
 *  8. aggregation builder $match → $group → $sort, preview per stage, Run equals the driver's
 *     aggregate, export as shell and as Node (no password in the code).
 *  9. Explain of the step-4 query: COLLSCAN; Indexes tab creates {status: 1, total: 1}
 *     (production confirm); Explain again: IXSCAN on status_1_total_1.
 * 10. second profile: X.509 connection string pasted, SSH with a key file in the form; host key
 *     trusted; connected through the tunnel; its database is listed.
 * 11. mongosh console on the production connection: `db.orders.countDocuments()` -> the driver's
 *     count.
 *
 * Every step is screenshotted in Business light and Tron dark: $THICKET_DEMO_SHOTS (default
 * test-results/demo)/<business-light|tron-dark>/step-*.png; the committed set is in
 * reviews/final-demo/.
 */

const SHOTS = process.env['THICKET_DEMO_SHOTS'] ?? join('test-results', 'demo');
const THEMES = [
  { dir: 'business-light', style: 'business', mode: 'light' },
  { dir: 'tron-dark', style: 'tron', mode: 'dark' },
] as const;
const DB = 'shop';
const COLL = 'orders';
const TOTAL = 40_000;
const ITEMS = 2_000;
const PROFILE = 'Shop (production)';
const SSH_PROFILE = 'Fleet via bastion';

/** $THICKET_APPIMAGE, else the newest AppImage in apps/desktop/release (`npm run dist`). */
function findAppImage(): string | undefined {
  const fromEnv = process.env['THICKET_APPIMAGE'];
  if (fromEnv) return fromEnv;
  const release = join(appDir, 'release');
  let names: string[];
  try {
    names = readdirSync(release).filter((n) => n.endsWith('.AppImage'));
  } catch {
    return undefined;
  }
  const newest = names
    .map((name) => ({ path: join(release, name), mtime: statSync(join(release, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  return newest?.path;
}

const APPIMAGE = findAppImage();
test.use({ appExecutable: APPIMAGE });

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

/** The demo document: open, the largest total and `_id`, 2 000 items (as in m1/demo.e2e.ts). */
let DEMO_ID: ObjectId;

let server: E2EMongo | undefined;
let bastion: SshX509Fixture | undefined;
let unavailable: string | undefined;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (APPIMAGE === undefined) return;
  unavailable = await containerRuntimeUnavailable();
  if (unavailable) return;
  // Rootless Podman can't run Ryuk; afterAll stops the containers.
  if (process.env['DOCKER_HOST']?.includes('podman'))
    process.env['TESTCONTAINERS_RYUK_DISABLED'] ??= 'true';
  const [started, startedSsh] = await Promise.allSettled([
    startMongoSpec({ version: '8', replicaSet: true, tls: true }),
    startSshX509Fixture(),
  ]);
  if (started.status === 'rejected' || startedSsh.status === 'rejected') {
    // Stop whichever fixture did start, then report the first failure.
    await Promise.allSettled([
      started.status === 'fulfilled' ? started.value.stop() : undefined,
      startedSsh.status === 'fulfilled' ? startedSsh.value.stop() : undefined,
    ]);
    throw started.status === 'rejected'
      ? started.reason
      : (startedSsh as PromiseRejectedResult).reason;
  }
  server = started.value;
  bastion = startedSsh.value;
  await seed(server);
});

test.afterAll(async () => {
  await Promise.all([server?.stop(), bastion?.stop()]);
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

/** 40 000 orders (a quarter of them open, totals 0.00–399.99), the demo document last. */
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
        customer: `customer ${String(i % 997)}`,
        items: [
          { sku: `SKU-${String(i % 50)}`, qty: 1 },
          { sku: `SKU-${String((i + 7) % 50)}`, qty: 2 },
        ],
      });
      if (batch.length === 5_000) await c.insertMany(batch.splice(0));
    }
    if (batch.length > 0) await c.insertMany(batch.splice(0));
    DEMO_ID = new ObjectId();
    await c.insertOne({
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
  });
}

/** A root user with a generated password (never committed). */
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

async function setTheme(window: Page, style: string, mode: string): Promise<void> {
  const response = await window.evaluate(
    (s) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `demo-theme-${s.style}-${s.mode}`,
        method: 'app.settings.set',
        params: { settings: s },
      }),
    { style, mode },
  );
  expect(response).toMatchObject({ ok: true });
  await expect(window.locator('html')).toHaveAttribute('data-style', style);
  await expect(window.locator('html')).toHaveAttribute('data-theme', mode);
}

/**
 * Screenshots the window in every theme of `THEMES`, then returns to Business light. `scrollTo`
 * is scrolled into view after each theme switch: another theme's fonts can move it below the fold.
 */
async function shot(window: Page, name: string, scrollTo?: Locator): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(window, theme.style, theme.mode);
    if (scrollTo) await scrollTo.scrollIntoViewIfNeeded();
    const dir = join(SHOTS, theme.dir);
    await mkdir(dir, { recursive: true });
    // Let fonts and transitions settle so the screenshots are stable.
    await window.evaluate(async () => {
      await (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document
        .fonts.ready;
    });
    await window.waitForTimeout(400);
    await window.screenshot({ path: join(dir, name) });
  }
  await setTheme(window, 'business', 'light');
}

function fieldInput(doc: Locator, key: string): Locator {
  return doc.locator(`.field[data-node$=".${key}"]`).first().locator('input').last();
}

async function typeValue(doc: Locator, key: string, value: string): Promise<void> {
  const input = fieldInput(doc, key);
  await input.fill(value);
  await input.press('Tab');
}

/** Fills a field whose edit is applied on `change` (leaving the field). */
async function setField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

/** Clicks Save and confirms the production dialog (`check` runs while it is open). */
async function saveConfirmed(window: Page, check?: (operation: Locator) => Promise<void>) {
  await window.getByTestId('edit-save').click();
  await confirmProduction(window, check);
}

async function confirmProduction(window: Page, check?: (operation: Locator) => Promise<void>) {
  const dialog = window.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/production/);
  if (check) await check(window.getByTestId('confirm-operation'));
  await window.getByTestId('confirm-ok').click();
  await expect(dialog).toBeHidden();
}

test('release demo, steps 2–11, against the AppImage', async ({
  electronApp,
  window,
  userDataDir,
}) => {
  test.skip(
    APPIMAGE === undefined,
    'no AppImage: run `npm run dist` first (or set THICKET_APPIMAGE)',
  );
  test.skip(unavailable !== undefined, unavailable);
  test.setTimeout(600_000);
  // Name the AppImage under test and its build time, so a stale build shows in the report.
  const appImage = APPIMAGE as string;
  const built = new Date(statSync(appImage).mtimeMs).toISOString();
  test.info().annotations.push({ type: 'appimage', description: `${appImage} (mtime ${built})` });
  console.log(`demo: AppImage ${appImage}, mtime ${built}`);
  const mongo = server as E2EMongo;
  const ssh = bastion as SshX509Fixture;
  const user = await createUser(mongo);
  await window.setViewportSize({ width: 1400, height: 900 });

  await test.step('1. the packaged app starts on the welcome screen', async () => {
    const packaged = await electronApp.evaluate(({ app }) => app.isPackaged);
    expect(packaged).toBe(true);
    expect(window.url()).toMatch(/^thicket:\/\/app\//);
    await setTheme(window, 'business', 'light');
    await expect(window.getByTestId('welcome-new').first()).toBeVisible();
    await expect(window.getByTestId('welcome-import').first()).toBeVisible();
    await shot(window, 'step-01-welcome.png');
  });

  await test.step('2. paste the connection string, mark production, connect', async () => {
    await window.getByTestId('welcome-new').first().click();
    await expect(window.getByTestId('connection-editor')).toBeVisible();
    await window.getByTestId('field-name').fill(PROFILE);
    await window.getByTestId('tab-uri').click();
    const uri =
      `mongodb://${user.username}:${encodeURIComponent(user.password)}@${mongo.host}:${String(mongo.port)}` +
      `/?tls=true&tlsCAFile=${encodeURIComponent(mongo.tlsCaFile ?? '')}&replicaSet=rs0&directConnection=true`;
    await window.getByTestId('field-uri').fill(uri);
    await expect(window.getByTestId('uri-error')).toHaveCount(0);

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
    await shot(window, 'step-02-form-filled.png');

    const production = window.getByTestId('field-production');
    await production.check();
    await expect(production).toBeChecked();
    await window.getByTestId('secret-saved').check();
    await window.getByTestId('test-connection').click();
    await expect(window.getByTestId('test-ok')).toContainText('Connected in', { timeout: 30_000 });
    await shot(window, 'step-02-production.png', production);

    await window.getByTestId('save').click();
    await expect(window.getByTestId('saved-notice')).toBeVisible();
    const profiles = await readFile(join(userDataDir, 'connections.json'), 'utf8');
    expect(profiles).toContain(user.username);
    expect(profiles).not.toContain(user.password);
    const secrets = await readFile(join(userDataDir, 'secrets.bin'));
    expect((await stat(join(userDataDir, 'secrets.bin'))).size).toBeGreaterThan(0);
    expect(secrets.includes(Buffer.from(user.password, 'utf8'))).toBe(false);

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
    await expect(
      window.locator('[data-testid="tab"][data-tab-id^="collection:"][data-tab-id$="shop.orders"]'),
    ).toBeVisible();
    await expect(window.locator('app-shell')).toHaveClass(/production/);
    await shot(window, 'step-03-sidebar.png');
  });

  const rows = window.getByTestId('pager-rows');
  const raw = window.getByTestId('raw-text');
  const tableRows = window.locator(
    'app-json-explorer .json-output > app-json-table > .tw > table > tbody > tr',
  );

  await test.step('4. table, 50 per page, page 3 one click away, filter and sort', async () => {
    await expect(rows).toContainText('1–50');
    await expect(rows).toContainText('~40,000');
    await expect(window.getByTestId('pager-pages')).toHaveText('of ~800');
    await window.getByTestId('view-table').click();
    await expect(tableRows).toHaveCount(50);

    await window.getByTestId('pager-page').fill('3');
    await window.getByTestId('pager-page').press('Enter');
    await expect(rows).toContainText(/^101–150 of ~40,000/);
    await expect(tableRows).toHaveCount(50);
    await shot(window, 'step-04-page-3.png');

    await window.getByTestId('query-filter').fill('{status: "open", total: {$gt: 100}}');
    await window.getByTestId('query-sort').fill('{total: -1}');
    await window.getByTestId('query-run').click();
    await expect(window.getByTestId('query-errors')).toHaveCount(0);
    await expect(rows).toHaveText('1–50');
    await window.getByTestId('view-raw').click();
    await expect(raw).toContainText(`ObjectId("${DEMO_ID.toHexString()}")`);
    const text = (await raw.textContent()) ?? '';
    expect(text).not.toMatch(/status: "(paid|shipped|cancelled)"/);
    expect(/ObjectId\("([0-9a-f]{24})"\)/.exec(text)?.[1]).toBe(DEMO_ID.toHexString());
    const totals = [...text.matchAll(/total: NumberDecimal\("([0-9.]+)"\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(totals.length).toBeGreaterThan(1);
    expect(totals.every((t) => t > 100)).toBe(true);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));

    const expected = await withOrders(mongo, (c) =>
      c.countDocuments({ status: 'open', total: { $gt: Decimal128.fromString('100') } }),
    );
    await window.getByTestId('pager-count').click();
    await expect(rows).toContainText(`of ${expected.toLocaleString('en-US')} documents`);
    await expect(rows).toContainText(/^1–50 /);
    await window.getByTestId('view-table').click();
    await expect(tableRows).toHaveCount(50);
    await shot(window, 'step-04-filter-sort.png');
  });

  const doc = window.getByTestId('result-doc').first();

  await test.step('5. open the document: items page inside it, BSON types shown', async () => {
    await window.getByTestId('view-list').click();
    await expect(doc).toBeVisible();
    for (const [field, type] of [
      ['_id', 'objectId'],
      ['createdAt', 'date'],
      ['total', 'decimal'],
    ] as const) {
      await expect(
        doc.locator(`.field[data-node$=".${field}"] [data-bson-type="${type}"]`).first(),
      ).toBeVisible();
    }
    const range = doc.getByTestId('nested-pager-range');
    await expect(range).toHaveText('1–100 of 2,000 items');
    await expect(doc.getByText('ITEM-0000', { exact: true })).toBeVisible();
    await doc.getByTestId('nested-pager-next').click();
    await expect(range).toHaveText('101–200 of 2,000 items');
    await expect(doc.getByText('ITEM-0100', { exact: true })).toBeVisible();
    await shot(window, 'step-05-document.png');
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
    await shot(window, 'step-06-two-changes.png');

    await saveConfirmed(window, async (operation) => {
      await expect(operation).toContainText(
        'db.getSiblingDB("shop").getCollection("orders").updateOne(',
      );
      await expect(operation).toContainText('$set: {');
      await expect(operation).toContainText('total: NumberDecimal("1234.56")');
      await expect(operation).toContainText('reviewed: "yes"');
      await shot(window, 'step-06-production-confirm.png');
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
    const changed = view.locator('[data-testid="conflict-row"][data-kind="changed"]');
    const totalRow = changed.filter({ hasText: 'total' });
    await expect(totalRow.getByTestId('conflict-local')).toContainText('777.00');
    await expect(totalRow.getByTestId('conflict-server')).toContainText('1500.00');
    const statusRow = changed.filter({ hasText: 'status' });
    await expect(statusRow.getByTestId('conflict-local')).toContainText('status: "open"');
    await expect(statusRow.getByTestId('conflict-server')).toContainText('status: "shipped"');
    await shot(window, 'step-07-conflict.png');
    const stored = await withOrders(mongo, (c) => c.findOne({ _id: DEMO_ID }));
    expect(stored?.total.toString()).toBe('1500.00');

    // Done with editing: keep the server's version and leave edit mode.
    await view.getByTestId('conflict-keep-server').first().click();
    await expect(view).toHaveCount(0);
    await expect(window.getByTestId('edit-count')).toHaveCount(0);
    await window.getByTestId('edit-mode').click();
    await expect(window.getByTestId('edit-mode')).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('8. aggregation builder: $match → $group → $sort, preview, export', async () => {
    const pipeline = [
      { $match: { status: 'open' } },
      {
        $group: {
          _id: { $dayOfMonth: '$createdAt' },
          orders: { $sum: 1 },
          revenue: { $sum: '$total' },
        },
      },
      { $sort: { revenue: -1, _id: 1 } },
    ];
    const expected = await withOrders(mongo, (c) => c.aggregate(pipeline).toArray());
    expect(expected.length).toBeGreaterThan(20);

    await window.getByTestId('open-aggregation').click();
    const builder = window.locator('app-aggregation-view');
    await expect(builder).toBeVisible();
    const stages = builder.getByTestId('agg-stage');
    await expect(stages).toHaveCount(1);
    await stages.nth(0).getByTestId('agg-stage-body').fill('{ status: "open" }');
    await expect(stages.nth(0).getByTestId('agg-preview-doc').first()).toContainText('"open"');

    await builder.getByTestId('agg-add-stage').click();
    await stages.nth(1).getByTestId('agg-stage-operator').selectOption('$group');
    await stages
      .nth(1)
      .getByTestId('agg-stage-body')
      .fill(
        '{ _id: { $dayOfMonth: "$createdAt" }, orders: { $sum: 1 }, revenue: { $sum: "$total" } }',
      );
    await expect(stages.nth(1).getByTestId('agg-preview-doc').first()).toContainText('revenue');

    await builder.getByTestId('agg-add-stage').click();
    await stages.nth(2).getByTestId('agg-stage-operator').selectOption('$sort');
    await stages.nth(2).getByTestId('agg-stage-body').fill('{ revenue: -1, _id: 1 }');
    await expect(stages.nth(2).getByTestId('agg-preview-doc').first()).toContainText('revenue');
    // Each stage keeps its own preview.
    for (let i = 0; i < 3; i++)
      await expect(stages.nth(i).getByTestId('agg-preview-count')).toContainText('document');
    await shot(window, 'step-08-stages.png');

    await builder.getByTestId('agg-run').click();
    const results = builder.getByTestId('agg-result-doc');
    // The result list pages (20 per page): the first rows are the driver's, in its order.
    await expect(results).toHaveCount(Math.min(expected.length, 20));
    for (const [i, row] of expected.slice(0, 3).entries()) {
      await expect(results.nth(i)).toContainText(`_id: ${String(row['_id'])}`);
      await expect(results.nth(i)).toContainText(`orders: ${String(row['orders'])}`);
      await expect(results.nth(i)).toContainText(`NumberDecimal("${String(row['revenue'])}")`);
    }
    await shot(window, 'step-08-run.png');

    await builder.getByTestId('agg-export').click();
    const code = builder.getByTestId('agg-code');
    await expect(code).toContainText(
      `db.getSiblingDB("${DB}").getCollection("${COLL}").aggregate(`,
    );
    expect((await code.textContent()) ?? '').toMatch(/\$match[\s\S]*\$group[\s\S]*\$sort/);
    await shot(window, 'step-08-export-shell.png');
    await builder.getByTestId('agg-lang-node').click();
    await expect(code).toContainText("require('mongodb')");
    const node = (await code.textContent()) ?? '';
    expect(node).toMatch(/\.aggregate\(\[[\s\S]*\$match[\s\S]*\$group[\s\S]*\$sort/);
    expect(node).not.toContain(user.password);
    await shot(window, 'step-08-export-node.png');
  });

  await test.step('9. Explain: COLLSCAN, create the index in the Indexes tab, IXSCAN', async () => {
    const collTab = window.locator(
      '[data-testid="tab"][data-tab-id^="collection:"][data-tab-id$="shop.orders"]',
    );
    await collTab.click();
    await expect(window.getByTestId('query-filter')).toHaveValue(
      '{status: "open", total: {$gt: 100}}',
    );
    await window.getByTestId('query-explain').click();
    const panel = window.getByTestId('explain-panel');
    const verdict = panel.getByTestId('explain-verdict');
    await expect(verdict).toContainText('No index used', { timeout: 30_000 });
    await expect(verdict).toContainText('COLLSCAN');
    await expect(panel.locator('[data-stage="IXSCAN"]')).toHaveCount(0);
    await shot(window, 'step-09-collscan.png');
    await panel.getByTestId('explain-close').click();

    await window.getByTestId('open-indexes').click();
    const view = window.locator('app-indexes-view');
    await expect(view).toBeVisible();
    await view.getByTestId('idx-create').click();
    const form = view.getByTestId('idx-create-form');
    await form.getByTestId('idx-key-field').first().fill('status');
    await form.getByTestId('idx-key-add').click();
    await form.getByTestId('idx-key-field').nth(1).fill('total');
    await expect(form.getByTestId('idx-preview')).toHaveText(
      `db.${COLL}.createIndex({ status: 1, total: 1 })`,
    );
    await shot(window, 'step-09-create-index.png');
    await form.getByTestId('idx-create-submit').click();
    await confirmProduction(window, async (operation) => {
      await expect(operation).toContainText('createIndex(');
    });
    await expect(view.getByTestId('idx-message')).toHaveText('Created index status_1_total_1.', {
      timeout: 60_000,
    });
    await expect(
      view.locator('[data-testid="idx-row"][data-name="status_1_total_1"]'),
    ).toBeVisible();
    await shot(window, 'step-09-indexes.png');

    await collTab.click();
    await window.getByTestId('query-explain').click();
    await expect(verdict).toContainText('Index used: status_1_total_1', { timeout: 30_000 });
    const ixscan = panel.locator('[data-testid="explain-stage"][data-stage="IXSCAN"]');
    await expect(ixscan).toHaveCount(1);
    await expect(ixscan.getByTestId('explain-stage-index')).toHaveText('status_1_total_1');
    await expect(panel.locator('[data-stage="COLLSCAN"]')).toHaveCount(0);
    await shot(window, 'step-09-ixscan.png');
    await panel.getByTestId('explain-close').click();
  });

  await test.step('10. a second profile through an SSH tunnel with a key file and X.509', async () => {
    await window.getByTestId('sidebar-add').click();
    await expect(window.getByTestId('connection-editor')).toBeVisible();
    await window.getByTestId('field-name').fill(SSH_PROFILE);
    await window.getByTestId('tab-uri').click();
    await window.getByTestId('field-uri').fill(ssh.uri);
    await expect(window.getByTestId('uri-error')).toHaveCount(0);
    await window.getByTestId('tab-form').click();
    await expect(window.getByTestId('field-host').first()).toHaveValue('demo-x509');
    await expect(window.getByTestId('field-mechanism')).toHaveValue('MONGODB-X509');
    await expect(window.getByTestId('field-cert-file')).toHaveValue(ssh.certKeyFile);
    await expect(window.getByTestId('field-ca-file')).toHaveValue(ssh.caFile);

    await window.getByTestId('field-ssh').check();
    await setField(window.getByTestId('field-ssh-host'), ssh.sshHost);
    await setField(window.getByTestId('field-ssh-port'), String(ssh.sshPort));
    await setField(window.getByTestId('field-ssh-username'), ssh.sshUser);
    await window.getByTestId('ssh-method-privateKey').check();
    await setField(window.getByTestId('field-ssh-key-file'), ssh.sshKeyFile);
    await expect(window.getByTestId('route')).toContainText(`${ssh.sshUser}@${ssh.sshHost}`);
    await shot(window, 'step-10-ssh-x509-form.png', window.getByTestId('field-ssh'));

    await window.getByTestId('save').click();
    await expect(window.getByTestId('saved-notice')).toBeVisible();
    const { profiles } = JSON.parse(
      await readFile(join(userDataDir, 'connections.json'), 'utf8'),
    ) as { profiles: { name: string; ssh?: Record<string, unknown> }[] };
    expect(profiles.find((p) => p.name === SSH_PROFILE)?.ssh).toMatchObject({
      host: ssh.sshHost,
      port: ssh.sshPort,
      username: ssh.sshUser,
      method: 'privateKey',
      privateKeyFile: ssh.sshKeyFile,
    });

    const conn = treeNode(window, 'conn', SSH_PROFILE);
    await conn.click();
    const dialog = window.getByTestId('host-key-dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('host-key-fingerprint')).toHaveText(/^SHA256:\S{20,}$/);
    await shot(window, 'step-10-host-key.png');
    await window.getByTestId('host-key-trust').click();
    await expect(dialog).toBeHidden();
    await expect(conn).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });
    // Authenticated with the certificate: the user can list and read the fleet database.
    const fleet = treeNode(window, 'db', X509_DB);
    await expect(fleet).toBeVisible();
    await fleet.click();
    await treeNode(window, 'coll', X509_COLL).click();
    await expect(
      window.getByRole('region', { name: `Collection ${X509_COLL}` }).getByTestId('pager-rows'),
    ).toContainText(`1–${String(X509_DOCS)} of ~${String(X509_DOCS)} documents`);
    await shot(window, 'step-10-connected.png');
  });

  await test.step('11. mongosh console: db.orders.countDocuments()', async () => {
    const expected = await withOrders(mongo, (c) => c.countDocuments());
    const conn = treeNode(window, 'conn', PROFILE);
    await conn.click({ button: 'right' });
    await window.getByTestId('menu-open-shell').click();
    const console = window.locator('app-shell-console');
    await expect(console).toBeVisible();
    await expect(console.getByTestId('shell-prompt')).toHaveText(/^[\w-]+>$/, { timeout: 60_000 });
    await expect(console).toHaveClass(/production/);
    const input = console.getByTestId('shell-input');
    await input.fill(`use ${DB}`);
    await input.press('Enter');
    await expect(console.getByTestId('shell-prompt')).toHaveText(`${DB}>`, { timeout: 30_000 });
    const runs = console.getByTestId('shell-run');
    await expect(runs).toHaveCount(1);
    await expect(runs.first()).toHaveAttribute('data-state', /^(?!running$)/);
    await expect(runs.first()).toContainText(`switched to db ${DB}`);
    // The console ignores Enter while the previous input still runs: wait until it is idle.
    await expect(console.getByTestId('shell-running')).toHaveCount(0);
    await input.fill('db.orders.countDocuments()');
    await input.press('Enter');
    await expect(runs).toHaveCount(2);
    const run = runs.last();
    await expect(run.getByTestId('shell-result')).toHaveText(String(expected), {
      timeout: 30_000,
    });
    await shot(window, 'step-11-shell.png');
  });
});
