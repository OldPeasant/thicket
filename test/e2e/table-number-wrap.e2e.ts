import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Decimal128, Double, Int32, Long, MongoClient, ObjectId } from 'mongodb';

import { expect, screenshot, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'table_wrap_e2e';
const COLL = 'orders';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

async function request(window: Page, method: string, params: unknown): Promise<void> {
  const response = await window.evaluate(
    (r) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `${r.method}-${Date.now()}`,
        method: r.method,
        params: r.params,
      }),
    { method, params },
  );
  expect(response).toMatchObject({ ok: true });
}

/** 12 orders: wide nested `customer` and `items` next to one column per scalar type. */
async function seed(uri: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const coll = client.db(DB).collection(COLL);
    await coll.drop().catch(() => undefined);
    await coll.insertMany(
      Array.from({ length: 12 }, (_, i) => ({
        _id: new ObjectId(),
        customer: {
          name: `Customer number ${i + 1}`,
          email: `customer.${i + 1}@example.com`,
          address: { street: `Bahnhofstrasse ${i + 10}`, city: 'Zürich', zip: '8001' },
        },
        items: [
          { sku: `SKU-${1000 + i}`, qty: new Int32(i + 1), price: Decimal128.fromString('19.90') },
          { sku: `SKU-${2000 + i}`, qty: new Int32(2), price: Decimal128.fromString('5.50') },
        ],
        qty: new Int32(10421 + i),
        total: Long.fromString('9007199254740993'),
        ratio: new Double(0.125 + i),
        price: Decimal128.fromString('149.90'),
        placed: new Date(Date.UTC(2026, 10, 1 + i, 9, 30)),
        paid: i % 2 === 0,
        note: 'Please leave the parcel at the back door, thank you',
      })),
    );
  } finally {
    await client.close();
  }
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

// The root tsconfig has no DOM lib: just what the measurement below uses.
interface Rect {
  top: number;
}
interface El {
  textContent: string | null;
  dataset: Record<string, string | undefined>;
  parentElement: El | null;
  querySelector(s: string): El | null;
  getBoundingClientRect(): Rect;
}
interface Doc {
  querySelectorAll(s: string): Iterable<El>;
  createRange(): { selectNodeContents(n: El): void; getClientRects(): Iterable<Rect> };
}

/**
 * Every scalar value shown in the table, and those (`<type>: <text> (<lines>)`) whose text takes
 * more than one line or whose badge is not on the same line.
 */
async function wrappedScalars(window: Page): Promise<{ count: number; wrapped: string[] }> {
  return window.evaluate(() => {
    const doc = (globalThis as unknown as { document: Doc }).document;
    const vals = [
      ...doc.querySelectorAll(
        'app-json-explorer .json-output .val.bson.scalar, app-json-explorer .json-output .val.bool',
      ),
    ];
    const wrapped: string[] = [];
    for (const val of vals) {
      const range = doc.createRange();
      range.selectNodeContents(val);
      // One distinct top per line box the text occupies.
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      const badge = val.parentElement?.querySelector('.badge');
      const sameLine =
        !badge || Math.abs(badge.getBoundingClientRect().top - val.getBoundingClientRect().top) < 8;
      if (tops.size > 1 || !sameLine) {
        wrapped.push(`${val.dataset['bsonType'] ?? 'bool'}: ${val.textContent} (${tops.size})`);
      }
    }
    return { count: vals.length, wrapped };
  });
}

for (const [style, mode] of [
  ['business', 'light'],
  ['tron', 'dark'],
] as const) {
  test(`table view keeps scalar values on one line (${style} ${mode})`, async ({
    electronApp,
    window,
    mongo,
  }) => {
    test.setTimeout(90_000);
    await seed(mongo.uri);
    await window.setViewportSize({ width: 1280, height: 800 });
    await request(window, 'app.settings.set', { settings: { style, mode } });
    await expect(window.locator('html')).toHaveAttribute('data-theme', mode);
    await request(window, 'profiles.save', {
      profile: { name: 'Orders', connectionString: mongo.uri, readOnly: false, production: false },
    });
    await window.getByTestId('sidebar-refresh').click();

    const conn = treeNode(window, 'conn', 'Orders');
    await conn.click();
    await expect(conn).toHaveAttribute('data-state', 'connected');
    await treeNode(window, 'db', DB).click();
    await treeNode(window, 'coll', COLL).click();
    await expect(window.getByTestId('pager-rows')).toContainText('12');
    await expect(
      window.locator('app-json-explorer .json-output > app-json-table > .tw > table > tbody > tr'),
    ).toHaveCount(12);

    // 12 rows x (ObjectId, Int32, Int64, Double, Decimal128, Date, Boolean) + items' Int32/Decimal.
    const { count, wrapped } = await wrappedScalars(window);
    expect(count).toBeGreaterThanOrEqual(12 * 7);
    expect(wrapped).toEqual([]);

    await window.evaluate(async () => {
      await (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document
        .fonts.ready;
    });
    await window.waitForTimeout(400);
    await mkdir(SHOTS, { recursive: true });
    await screenshot(electronApp, window, join(SHOTS, `table-number-wrap-${style}-${mode}.png`));

    // The table scrolls horizontally to the scalar columns.
    const note = window.locator('app-json-explorer .json-output th', { hasText: /^note$/ }).first();
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
    await window.waitForTimeout(200);
    await screenshot(
      electronApp,
      window,
      join(SHOTS, `table-number-wrap-${style}-${mode}-scrolled.png`),
    );
  });
}
