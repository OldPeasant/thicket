import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { parseEJsonDocument } from '@thicket/core';
import { ALL_TYPES_EJSON, ALL_TYPES_FIELDS } from '@thicket/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { toExplorerValue } from './bson-value.util';
import { JsonExplorerComponent } from './json-explorer.component';
import type { Layout } from './layout.util';
import { BsonDisplayService } from './services/bson-display.service';
import { FilterService } from './services/filter.service';

// The badge each field of the bson-model all-types fixture must show.
const EXPECTED_BADGES: Record<string, string> = {
  _id: 'ObjectId',
  double: 'Double',
  doubleIntegral: 'Double',
  negativeZero: 'Double',
  nan: 'Double',
  infinity: 'Double',
  negativeInfinity: 'Double',
  hugeDouble: 'Double',
  tinyDouble: 'Double',
  string: 'String',
  object: 'Object',
  array: 'Array',
  binaryGeneric: 'Binary 0x00',
  binaryFunction: 'Binary 0x01',
  binaryOld: 'Binary 0x02',
  uuidLegacy: 'Binary 0x03',
  uuid: 'UUID',
  md5: 'Binary 0x05',
  encrypted: 'Binary 0x06',
  column: 'Binary 0x07',
  sensitive: 'Binary 0x08',
  vector: 'Binary 0x09',
  userDefined: 'Binary 0x80',
  undefined: 'Undefined',
  true: 'Boolean',
  false: 'Boolean',
  date: 'Date',
  dateBeforeEpoch: 'Date',
  dateBeyondJs: 'Date',
  null: 'Null',
  regex: 'Regex',
  dbPointer: 'DBPointer',
  code: 'Code',
  symbol: 'Symbol',
  codeWithScope: 'Code w/ scope',
  int32: 'Int32',
  int32Min: 'Int32',
  int32Max: 'Int32',
  timestamp: 'Timestamp',
  int64: 'Int64',
  int64Min: 'Int64',
  int64Max: 'Int64',
  decimal: 'Decimal128',
  decimalExp: 'Decimal128',
  decimalMax: 'Decimal128',
  decimalNaN: 'Decimal128',
  decimalNegZero: 'Decimal128',
  minKey: 'MinKey',
  maxKey: 'MaxKey',
};

describe('Explorer with BSON values', () => {
  let fixture: ComponentFixture<JsonExplorerComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JsonExplorerComponent],
      providers: [provideZonelessChangeDetection()],
    });
    TestBed.inject(BsonDisplayService).timeZone.set('Europe/Zurich');
  });

  const render = async (ejson: string, layout: Layout) => {
    fixture = TestBed.createComponent(JsonExplorerComponent);
    fixture.componentRef.setInput('value', toExplorerValue(parseEJsonDocument(ejson)));
    fixture.componentRef.setInput('layout', layout);
    await fixture.whenStable();
    showAll();
    await fixture.whenStable();
  };

  // Long documents are revealed in batches; show every field.
  const showAll = () => {
    for (const b of el().querySelectorAll<HTMLButtonElement>('.reveal-btn')) {
      if (b.textContent?.includes('Show all')) b.click();
    }
  };

  const field = (key: string) => el().querySelector<HTMLElement>(`.field[data-node=".${key}"]`);
  const badgeOf = (key: string) => field(key)?.querySelector('.badge')?.textContent?.trim();
  const valueOf = (key: string) => field(key)?.querySelector('.val')?.textContent?.trim();
  const shownKeys = () =>
    [...el().querySelectorAll('.fields > .field')].map((f) =>
      f.querySelector('.name')?.textContent?.trim(),
    );

  it('shows the correct badge for every value of the all-types fixture', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    expect(Object.keys(EXPECTED_BADGES)).toEqual(ALL_TYPES_FIELDS.map(([k]) => k));
    for (const [key, badge] of Object.entries(EXPECTED_BADGES)) {
      expect(badgeOf(key), key).toBe(badge);
    }
  });

  it('colors badges with the BSON type tokens and marks deprecated types', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    const badge = (key: string) => field(key)?.querySelector<HTMLElement>('.badge');
    expect(badge('_id')?.style.getPropertyValue('--badge-color')).toBe('var(--bson-object-id)');
    expect(badge('uuid')?.style.getPropertyValue('--badge-color')).toBe('var(--bson-bin-data)');
    expect(badge('int64')?.dataset['bsonType']).toBe('long');
    for (const key of ['undefined', 'symbol', 'dbPointer', 'codeWithScope']) {
      expect(badge(key)?.classList.contains('deprecated'), key).toBe(true);
    }
    expect(badge('int32')?.classList.contains('deprecated')).toBe(false);
  });

  it('shows badges in the tables layout too, values in nested arrays included', async () => {
    await render('{"a":[{"$numberLong":"5"},"x",{"$date":{"$numberLong":"0"}}]}', 'tables');
    const badges = [...el().querySelectorAll('.badge')].map((b) => b.textContent?.trim());
    expect(badges).toEqual(['Array', 'Int64', 'String', 'Date']);
  });

  it('shows the values of every type in full', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    expect(valueOf('_id')).toBe('5f1d7a3e9c1b2a0012345678');
    expect(valueOf('negativeZero')).toBe('-0');
    expect(valueOf('nan')).toBe('NaN');
    expect(valueOf('uuid')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(valueOf('uuidLegacy')).toBe('D4+tW9nLRp+hZXCGdyiVDg==');
    expect(valueOf('regex')).toBe('/^a.*\\d+$/imsux');
    expect(valueOf('timestamp')).toBe('Timestamp(4294967295, 1)');
    expect(valueOf('minKey')).toBe('MinKey');
    expect(valueOf('undefined')).toBe('undefined');
  });

  it('never loses precision on Int64 and Decimal128', async () => {
    await render(
      '{"big":{"$numberLong":"9007199254740993"},' +
        '"d34":{"$numberDecimal":"1234567890123456789012345678901234"},' +
        '"d34frac":{"$numberDecimal":"0.1234567890123456789012345678901234"}}',
      'form',
    );
    expect(valueOf('big')).toBe('9007199254740993');
    expect(valueOf('d34')).toBe('1234567890123456789012345678901234');
    expect(valueOf('d34frac')).toBe('0.1234567890123456789012345678901234');
  });

  it('never loses precision on the fixture extremes', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    expect(valueOf('int64')).toBe('9007199254740993');
    expect(valueOf('int64Min')).toBe('-9223372036854775808');
    expect(valueOf('int64Max')).toBe('9223372036854775807');
    expect(valueOf('decimal')).toBe('-1.10');
    expect(valueOf('decimalMax')).toBe('9.999999999999999999999999999999999E+6144');
  });

  it('shows dates in local time with the zone and toggles to UTC', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    expect(valueOf('date')).toBe('2023-11-14T23:13:20.000+01:00 Europe/Zurich');
    el().querySelector<HTMLButtonElement>('.date-zone')?.click();
    await fixture.whenStable();
    expect(valueOf('date')).toBe('2023-11-14T22:13:20.000Z');
    expect(valueOf('dateBeyondJs')).toContain('9223372036854775807');
  });

  it('finds BSON values by their exact text', async () => {
    await render(ALL_TYPES_EJSON, 'form');
    const filter = TestBed.inject(FilterService);

    filter.set('9007199254740993');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['int64']);
    expect(field('int64')?.querySelector('mark')?.textContent).toBe('9007199254740993');

    filter.set('9.999999999999999999999999999999999E+6144');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['decimalMax']);

    filter.set('5f1d7a3e9c1b2a0012345678');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['_id']);

    filter.set('0f8fad5b-d9cb');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['uuid']);

    // Dates match as shown: local time, then UTC after the toggle.
    filter.set('23:13:20');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['date']);
    TestBed.inject(BsonDisplayService).toggleUtc();
    await fixture.whenStable();
    expect(shownKeys()).toEqual([]);
    filter.set('22:13:20');
    await fixture.whenStable();
    expect(shownKeys()).toEqual(['date']);
  });

  it('finds values nested in documents and arrays', async () => {
    await render(
      '{"a":{"n":{"$numberLong":"9007199254740993"}},"b":[{"$numberInt":"1"}],"c":"x"}',
      'tables',
    );
    TestBed.inject(FilterService).set('740993');
    await fixture.whenStable();
    const marks = [...el().querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['740993']);
    expect(el().textContent).not.toContain('Int32');
  });
});
