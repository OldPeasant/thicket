import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { parseEJsonDocument } from '@thicket/core/bson';
import { beforeEach, describe, expect, it } from 'vitest';

import { toExplorerValue } from '../bson-value.util';
import { JsonExplorerComponent } from '../json-explorer.component';
import { BsonDisplayService } from '../services/bson-display.service';

// An `orders`-like collection: a wide nested `customer` column and an `items`
// array take the width, next to one column per scalar type.
const ORDER = (n: number) => `{
  "_id": {"$oid": "65a1f0c2e4b0a1b2c3d4e5f${n}"},
  "customer": {"name": "Customer ${n}", "email": "customer${n}@example.com",
    "address": {"street": "Long Street ${n}", "city": "Zürich", "zip": "800${n}"}},
  "items": [{"sku": "A-${n}", "qty": {"$numberInt": "${n}"}, "price": {"$numberDecimal": "9.95"}}],
  "qty": {"$numberInt": "10421"},
  "total": {"$numberLong": "9007199254740993"},
  "ratio": {"$numberDouble": "0.125"},
  "price": {"$numberDecimal": "149.90"},
  "placed": {"$date": {"$numberLong": "1700000000000"}},
  "paid": true,
  "note": "Please deliver to the back door after five in the evening, thank you"
}`;

const SCALAR_TYPES = ['objectId', 'int', 'long', 'double', 'decimal', 'date', 'bool'];

describe('Table view: values never break mid-value', () => {
  let fixture: ComponentFixture<JsonExplorerComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [JsonExplorerComponent],
      providers: [provideZonelessChangeDetection()],
    });
    TestBed.inject(BsonDisplayService).timeZone.set('Europe/Zurich');
    fixture = TestBed.createComponent(JsonExplorerComponent);
    const docs = `{"docs": [${[1, 2, 3].map(ORDER).join(',')}]}`;
    const value = toExplorerValue(parseEJsonDocument(docs)) as Record<string, unknown>;
    fixture.componentRef.setInput('value', value['docs']);
    fixture.componentRef.setInput('layout', 'tables');
    await fixture.whenStable();
  });

  // The value span of each cell showing a value of this badge type.
  const values = (type: string) =>
    [...el().querySelectorAll<HTMLElement>(`.badge[data-bson-type="${type}"]`)].map((badge) => {
      const val = badge.parentElement?.querySelector<HTMLElement>('.val');
      if (!val) throw new Error(`no value next to the ${type} badge`);
      return { badge, val, host: badge.parentElement as HTMLElement };
    });

  it('renders the orders table with the nested column next to the scalar columns', () => {
    const headers = [...el().querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual(
      expect.arrayContaining(['_id', 'customer', 'items', 'qty', 'total', 'ratio', 'price']),
    );
    // The nested customer documents render as tables inside the cells.
    expect(el().querySelectorAll('tbody td table').length).toBeGreaterThanOrEqual(3);
  });

  it.each(SCALAR_TYPES)('keeps every %s value and its badge on one line', (type) => {
    const cells = values(type);
    expect(cells.length, type).toBeGreaterThanOrEqual(3);
    for (const { badge, val, host } of cells) {
      expect(getComputedStyle(val).whiteSpace, `${type} value`).toBe('nowrap');
      expect(getComputedStyle(val).overflowWrap, `${type} value`).not.toBe('anywhere');
      expect(getComputedStyle(badge).whiteSpace, `${type} badge`).toBe('nowrap');
      // Badge and value sit in one non-wrapping flex line.
      expect(getComputedStyle(host).display, `${type} host`).toBe('inline-flex');
      expect(getComputedStyle(host).flexWrap, `${type} host`).not.toBe('wrap');
    }
  });

  it('shows the scalar values unchanged', () => {
    const text = (type: string) => values(type).map(({ val }) => val.textContent?.trim());
    expect(text('int')).toContain('10421');
    expect(text('decimal')).toContain('149.90');
    expect(text('long')).toContain('9007199254740993');
    expect(text('objectId')).toContain('65a1f0c2e4b0a1b2c3d4e5f1');
  });

  it('lets long strings wrap at word boundaries, not character by character', () => {
    const notes = values('string').filter(({ val }) => val.textContent?.includes('back door'));
    expect(notes).toHaveLength(3);
    for (const { val } of notes) {
      const style = getComputedStyle(val);
      expect(style.whiteSpace).toBe('pre-wrap');
      expect(style.overflowWrap).toBe('break-word');
      expect(style.wordBreak).not.toBe('break-all');
    }
  });

  it('still lets long binary data wrap anywhere', async () => {
    fixture.componentRef.setInput(
      'value',
      toExplorerValue(
        parseEJsonDocument(
          `{"bin": {"$binary": {"base64": "${'QUJD'.repeat(40)}", "subType": "00"}}}`,
        ),
      ),
    );
    await fixture.whenStable();
    const bins = values('binary');
    expect(bins).toHaveLength(1);
    for (const { val } of bins) {
      expect(getComputedStyle(val).whiteSpace).toBe('pre-wrap');
      expect(val.classList.contains('scalar')).toBe(false);
    }
  });
});
