import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { Int32, MongoClient, ObjectId } from 'mongodb';

import { expect, test } from './harness';

/** Where the screenshots go (git-ignored; copied into reviews/ for a review). */
const SHOTS = process.env['THICKET_SCREENSHOTS'] ?? join('test-results', 'screenshots');

const DB = 'schema_e2e';
const COLL = 'people';

interface Bridge {
  thicket: {
    request(r: unknown): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  };
}

/** 200 people: `city` is a string (Bern/Basel), `age` an int in 150 and a string in 30 (20 missing). */
function fixtureDocs() {
  return Array.from({ length: 200 }, (_, i) => {
    const doc: Record<string, unknown> = {
      _id: new ObjectId(),
      city: i % 2 === 0 ? 'Bern' : 'Basel',
      address: { zip: new Int32(3000 + (i % 10)) },
    };
    if (i < 150) doc['age'] = new Int32(20 + (i % 50));
    else if (i < 180) doc['age'] = `${i}`;
    return doc;
  });
}

async function request(window: Page, method: string, params: unknown) {
  return window.evaluate(
    (r) =>
      (globalThis as unknown as Bridge).thicket.request({
        id: `e2e-${r.method}-${Date.now()}`,
        method: r.method,
        params: r.params,
      }),
    { method, params },
  );
}

function treeNode(window: Page, kind: 'conn' | 'db' | 'coll', name: string): Locator {
  return window.locator(`[data-testid="tree-${kind}"][data-name="${name}"]`);
}

test('schema analysis: shares per type, click a value or a type to set the filter', async ({
  window,
  mongo,
}) => {
  test.setTimeout(120_000);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client
      .db(DB)
      .dropDatabase()
      .catch(() => undefined);
    await client.db(DB).collection(COLL).insertMany(fixtureDocs());
  } finally {
    await client.close();
  }

  await window.setViewportSize({ width: 1500, height: 1000 });
  const saved = await request(window, 'profiles.save', {
    profile: { name: 'Schema', connectionString: mongo.uri, readOnly: false, production: false },
  });
  expect(saved).toMatchObject({ ok: true });
  await window.getByTestId('sidebar-refresh').click();
  const conn = treeNode(window, 'conn', 'Schema');
  await conn.click();
  await expect(conn).toHaveAttribute('data-state', 'connected');
  await treeNode(window, 'db', DB).click();
  await treeNode(window, 'coll', COLL).click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–50');

  // Open the analysis: the whole collection is smaller than the default sample of 1 000.
  await window.getByTestId('query-schema').click();
  const panel = window.getByTestId('schema-panel');
  await expect(panel.getByTestId('schema-sampled')).toHaveText('200 documents sampled');
  const age = panel.locator('[data-testid="schema-row"][data-path="age"]');
  await expect(age.getByTestId('schema-present')).toContainText('90 %');
  await expect(age.getByTestId('schema-missing')).toHaveText('10 % missing');
  await expect(age.locator('[data-testid="schema-type"][data-type="int"]')).toContainText('75 %');
  await expect(age.locator('[data-testid="schema-type"][data-type="string"]')).toContainText(
    '15 %',
  );
  const zip = panel.locator('[data-testid="schema-row"][data-path="address.zip"]');
  await expect(zip.locator('[data-testid="schema-type"][data-type="int"]')).toContainText('100 %');
  await mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, 'schema-analysis.png') });

  // Click a value: it becomes the filter, the query bar shows it.
  const city = panel.locator('[data-testid="schema-row"][data-path="city"]');
  await city.locator('[data-testid="schema-example"]', { hasText: 'Bern' }).click();
  const filter = window.getByTestId('query-filter');
  await expect(filter).toHaveValue('{ city: "Bern" }');
  await expect(filter).toBeFocused();

  // A nested value adds its dotted path next to the existing condition.
  await zip.locator('[data-testid="schema-example"]').first().click();
  await expect(filter).toHaveValue(/^\{ city: "Bern", "address\.zip": 300\d \}$/);

  // A type adds a $type condition; running the filter reads only the matching documents.
  await window.getByTestId('query-filter').fill('');
  await age.locator('[data-testid="schema-type"][data-type="string"]').click();
  await expect(filter).toHaveValue('{ age: { $type: "string" } }');
  await window.getByTestId('query-run').click();
  await expect(window.getByTestId('pager-rows')).toContainText('1–30');
  await window.getByTestId('pager-count').click();
  await expect(window.getByTestId('pager-count-value')).toHaveText('30');

  // Analyzing again uses the filter now in the query bar.
  await window.getByTestId('query-schema').click();
  await expect(panel.getByTestId('schema-sampled')).toHaveText('30 documents sampled');
  await expect(age.getByTestId('schema-present')).toHaveText('100 %');

  await panel.getByTestId('schema-close').click();
  await expect(panel).toHaveCount(0);
});
