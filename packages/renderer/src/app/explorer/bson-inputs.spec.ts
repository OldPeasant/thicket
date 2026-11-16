import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fromExplorerValue, toExplorerValue } from './bson-value.util';
import { JsonExplorerComponent } from './json-explorer.component';
import { BsonDisplayService } from './services/bson-display.service';
import { EditModeService } from './services/edit-mode.service';
import { NumberDefaultService } from './services/number-default.service';

// The explorer in edit mode over a BSON document, its owner applying every
// change (as the app does): typed inputs, the type dropdown, new numbers and
// field moves, checked on the canonical EJSON of the result.
describe('Explorer edits BSON values without changing their types', () => {
  let fixture: ComponentFixture<JsonExplorerComponent>;
  let current: unknown;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JsonExplorerComponent],
      providers: [provideZonelessChangeDetection()],
    });
    TestBed.inject(BsonDisplayService).timeZone.set('Europe/Zurich');
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
    vi.useRealTimers();
  });

  const render = async (value: unknown) => {
    fixture = TestBed.createComponent(JsonExplorerComponent);
    current = value;
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('layout', 'form');
    fixture.componentInstance.valueChange.subscribe((next: unknown) => {
      current = next;
      fixture.componentRef.setInput('value', next);
    });
    await fixture.whenStable();
    if (!TestBed.inject(EditModeService).enabled()) {
      el().querySelector<HTMLButtonElement>('.mode-toggle')?.click();
    }
    await fixture.whenStable();
    expect(TestBed.inject(EditModeService).enabled()).toBe(true);
  };
  const renderEJson = (ejson: string) => render(toExplorerValue(parseEJsonDocument(ejson)));

  /** The document now, as canonical EJSON. */
  const ejson = () => stringifyEJson(fromExplorerValue(current));

  // The instant of the date field `t`, as ISO text.
  const dateT = () => {
    const doc = fromExplorerValue(current);
    const t = doc.type === 'object' ? doc.fields.find((f) => f.key === 't')?.value : undefined;
    return t?.type === 'date' ? new Date(Number(t.ms)).toISOString() : 'not a date: ' + ejson();
  };

  const field = (key: string) => el().querySelector<HTMLElement>(`.field[data-node=".${key}"]`);
  const input = (key: string, n = 0) =>
    field(key)?.querySelectorAll<HTMLInputElement>('app-bson-input input')[n] ?? null;
  const errorOf = (key: string) =>
    field(key)?.querySelector('app-bson-input [role="alert"]')?.textContent?.trim() ?? '';
  const typeSelect = (key: string) =>
    field(key)?.querySelector<HTMLSelectElement>('select.type-select') ?? null;

  const type = async (target: HTMLInputElement | null, text: string) => {
    expect(target).not.toBeNull();
    if (!target) return;
    target.value = text;
    target.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  };

  const choose = async (key: string, option: string) => {
    const select = typeSelect(key);
    expect(select).not.toBeNull();
    if (!select) return;
    select.value = option;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };

  const optionState = (key: string) =>
    Object.fromEntries(
      [...(typeSelect(key)?.options ?? [])].map((o) => [o.value, o.disabled ? 'off' : 'on']),
    );

  describe('typed inputs', () => {
    it('keeps an Int64 an Int64 when a number is typed, exactly', async () => {
      await renderEJson('{"n":{"$numberLong":"5"}}');
      expect(input('n')?.value).toBe('5');
      await type(input('n'), '9007199254740993');
      expect(ejson()).toBe('{"n":{"$numberLong":"9007199254740993"}}');
      // A small number stays Int64 too, not Int32.
      await type(input('n'), '7');
      expect(ejson()).toBe('{"n":{"$numberLong":"7"}}');
      expect(errorOf('n')).toBe('');
    });

    it('shows an error for Int64 overflow and keeps the value', async () => {
      await renderEJson('{"n":{"$numberLong":"5"}}');
      await type(input('n'), '9223372036854775808');
      expect(errorOf('n')).toContain('overflows Int64');
      expect(input('n')?.classList.contains('invalid')).toBe(true);
      expect(ejson()).toBe('{"n":{"$numberLong":"5"}}');
      // The largest Int64 is fine and clears the error.
      await type(input('n'), '9223372036854775807');
      expect(errorOf('n')).toBe('');
      expect(ejson()).toBe('{"n":{"$numberLong":"9223372036854775807"}}');
    });

    it('shows an error for Int32 overflow and fractions; keeps Int32', async () => {
      await renderEJson('{"i":{"$numberInt":"1"}}');
      await type(input('i'), '2147483648');
      expect(errorOf('i')).toContain('overflows Int32');
      await type(input('i'), '1.5');
      expect(errorOf('i')).toContain('not an integer');
      expect(ejson()).toBe('{"i":{"$numberInt":"1"}}');
      await type(input('i'), '-2147483648');
      expect(ejson()).toBe('{"i":{"$numberInt":"-2147483648"}}');
    });

    it('rejects an invalid ObjectId and accepts a valid one', async () => {
      await renderEJson('{"_id":{"$oid":"5f1d7a3e9c1b2a0012345678"}}');
      await type(input('_id'), '5f1d7a3e9c1b2a00123456zz');
      expect(errorOf('_id')).toContain('is not an ObjectId');
      await type(input('_id'), '5f1d7a3e');
      expect(errorOf('_id')).toContain('is not an ObjectId');
      expect(ejson()).toBe('{"_id":{"$oid":"5f1d7a3e9c1b2a0012345678"}}');
      await type(input('_id'), '65A1B2C3D4E5F60718293A4B');
      expect(errorOf('_id')).toBe('');
      expect(ejson()).toBe('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4b"}}');
    });

    it('generates a new ObjectId', async () => {
      await renderEJson('{"_id":{"$oid":"000000000000000000000000"}}');
      field('_id')?.querySelector<HTMLButtonElement>('app-bson-input button')?.click();
      await fixture.whenStable();
      const hex = (JSON.parse(ejson()) as { _id: { $oid: string } })._id.$oid;
      expect(hex).toMatch(/^[0-9a-f]{24}$/);
      expect(hex).not.toBe('000000000000000000000000');
      // Its first four bytes are the creation time in seconds.
      expect(Math.abs(parseInt(hex.slice(0, 8), 16) - Date.now() / 1000)).toBeLessThan(5);
    });

    it('edits Double and Decimal128 values without changing their type', async () => {
      await renderEJson('{"d":{"$numberDouble":"1.5"},"m":{"$numberDecimal":"1.10"}}');
      await type(input('d'), '3');
      await type(input('m'), '1234567890123456789012345678901234');
      expect(ejson()).toBe(
        '{"d":{"$numberDouble":"3.0"},"m":{"$numberDecimal":"1234567890123456789012345678901234"}}',
      );
      await type(input('d'), 'abc');
      expect(errorOf('d')).toContain('not a number');
      await type(input('m'), '1e7000');
      expect(errorOf('m')).toContain('Decimal128');
    });

    it('edits dates as ISO text (shown zone) and with the date-time picker', async () => {
      await renderEJson('{"t":{"$date":"2023-11-14T22:13:20Z"}}');
      expect(input('t')?.value).toBe('2023-11-14T23:13:20.000+01:00 Europe/Zurich');
      // The picker shows the same wall time.
      expect(input('t', 1)?.type).toBe('datetime-local');
      // (Browsers normalize the value: whole seconds drop the ".000".)
      expect(input('t', 1)?.value).toMatch(/^2023-11-14T23:13:20(?:\.000)?$/);
      await type(input('t'), '2024-01-02T03:04:05Z');
      expect(dateT()).toBe('2024-01-02T03:04:05.000Z');
      // Without an offset: wall time in the zone shown (Zurich, summer time +02:00).
      await type(input('t'), '2024-07-01T12:00');
      expect(dateT()).toBe('2024-07-01T10:00:00.000Z');
      const picker = input('t', 1);
      if (picker) {
        picker.value = '2024-12-24T18:30:00.000';
        picker.dispatchEvent(new Event('change'));
        await fixture.whenStable();
      }
      expect(dateT()).toBe('2024-12-24T17:30:00.000Z');
      await type(input('t'), 'yesterday');
      expect(errorOf('t')).toContain('ISO-8601');
    });

    it('edits UUIDs, binaries, regexes and timestamps by their parts', async () => {
      await renderEJson(
        '{"u":{"$binary":{"base64":"D4+tW9nLRp+hZXCGdyiVDg==","subType":"04"}},' +
          '"b":{"$binary":{"base64":"AQI=","subType":"80"}},' +
          '"r":{"$regularExpression":{"pattern":"^a","options":"i"}},' +
          '"ts":{"$timestamp":{"t":1,"i":2}}}',
      );
      await type(input('u'), '00112233-4455-6677-8899-aabbccddeeff');
      await type(input('u'), 'not-a-uuid');
      expect(errorOf('u')).toContain('UUID');
      await type(input('b', 0), '5');
      await type(input('b', 1), 'AQIDBA==');
      await type(input('b', 1), 'A!');
      expect(errorOf('b')).toContain('base64');
      await type(input('r', 1), 'xmi');
      await type(input('r', 0), 'b+');
      await type(input('ts', 0), '4294967295');
      await type(input('ts', 1), '4294967296');
      expect(errorOf('ts')).toContain('overflows 32 bits');
      expect(JSON.parse(ejson())).toEqual({
        u: { $binary: { base64: 'ABEiM0RVZneImaq7zN3u/w==', subType: '04' } },
        b: { $binary: { base64: 'AQIDBA==', subType: '05' } },
        r: { $regularExpression: { pattern: 'b+', options: 'imx' } },
        ts: { $timestamp: { t: 4294967295, i: 2 } },
      });
      await type(input('r', 1), 'q');
      expect(errorOf('r')).toContain('unknown regex option');
    });

    it('Escape restores the current value and clears the error', async () => {
      await renderEJson('{"n":{"$numberLong":"5"}}');
      await type(input('n'), 'x');
      expect(errorOf('n')).not.toBe('');
      const box = input('n');
      box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(box?.value).toBe('5');
      expect(errorOf('n')).toBe('');
    });
  });

  describe('type dropdown', () => {
    it('offers every creatable type, never the deprecated ones', async () => {
      await renderEJson('{"i":{"$numberInt":"42"}}');
      expect(Object.keys(optionState('i'))).toEqual([
        'string',
        'int',
        'long',
        'double',
        'decimal',
        'bool',
        'date',
        'objectId',
        'uuid',
        'binary',
        'regex',
        'javascript',
        'timestamp',
        'object',
        'array',
        'null',
        'minKey',
        'maxKey',
      ]);
      expect(typeSelect('i')?.value).toBe('int');
    });

    it('enables exactly the conversions of the bson-model table for an Int32', async () => {
      await renderEJson('{"i":{"$numberInt":"42"}}');
      expect(optionState('i')).toEqual({
        string: 'on',
        int: 'on',
        long: 'on',
        double: 'on',
        decimal: 'on',
        bool: 'on',
        date: 'on',
        objectId: 'off',
        uuid: 'off',
        binary: 'off',
        regex: 'off',
        javascript: 'off',
        timestamp: 'off',
        object: 'off',
        array: 'off',
        null: 'on',
        minKey: 'on',
        maxKey: 'on',
      });
      // A disabled option says why.
      const objectId = [...(typeSelect('i')?.options ?? [])].find((o) => o.value === 'objectId');
      expect(objectId?.title).toContain('only strings convert to ObjectId');
    });

    it('converts Int32 → Int64 → Decimal128 → String exactly', async () => {
      await renderEJson('{"i":{"$numberInt":"42"}}');
      await choose('i', 'long');
      expect(ejson()).toBe('{"i":{"$numberLong":"42"}}');
      await choose('i', 'decimal');
      expect(ejson()).toBe('{"i":{"$numberDecimal":"42"}}');
      await choose('i', 'string');
      expect(ejson()).toBe('{"i":"42"}');
    });

    it('converts a string to an ObjectId only when it is valid', async () => {
      await renderEJson('{"a":"5f1d7a3e9c1b2a0012345678","b":"hello"}');
      expect(optionState('a')['objectId']).toBe('on');
      expect(optionState('b')['objectId']).toBe('off');
      expect(optionState('b')['int']).toBe('off');
      expect(optionState('b')['regex']).toBe('on');
      await choose('a', 'objectId');
      expect(ejson()).toBe('{"a":{"$oid":"5f1d7a3e9c1b2a0012345678"},"b":"hello"}');
      // A disabled choice changes nothing even if it is forced.
      await choose('b', 'objectId');
      expect(ejson()).toBe('{"a":{"$oid":"5f1d7a3e9c1b2a0012345678"},"b":"hello"}');
    });

    it('disables lossy number conversions', async () => {
      await renderEJson(
        '{"big":{"$numberLong":"9007199254740993"},"frac":{"$numberDouble":"1.5"},' +
          '"wide":{"$numberLong":"2147483648"}}',
      );
      expect(optionState('big')['double']).toBe('off');
      expect(optionState('frac')['int']).toBe('off');
      expect(optionState('frac')['long']).toBe('off');
      expect(optionState('wide')['int']).toBe('off');
      expect(optionState('wide')['long']).toBe('on');
    });

    it('lets an empty value (a new field) become any creatable type', async () => {
      await renderEJson('{"x":"","n":null}');
      const states = optionState('x');
      expect(Object.values(states).every((s) => s === 'on')).toBe(true);
      await choose('x', 'long');
      expect(ejson()).toBe('{"x":{"$numberLong":"0"},"n":null}');
      await choose('n', 'objectId');
      expect(ejson()).toMatch(/^\{"x":\{"\$numberLong":"0"\},"n":\{"\$oid":"[0-9a-f]{24}"\}\}$/);
    });

    it('shows no editor and no dropdown for deprecated types', async () => {
      await renderEJson('{"s":{"$symbol":"sym"}}');
      expect(typeSelect('s')).toBeNull();
      expect(field('s')?.querySelector('input')).toBeNull();
    });
  });

  describe('new numbers', () => {
    it('makes a typed integer that fits an Int32 by default, a fraction a Double', async () => {
      await render({ n: 1 });
      const box = field('n')?.querySelector<HTMLInputElement>('input.num') ?? null;
      await type(box, '12');
      expect(ejson()).toBe('{"n":{"$numberInt":"12"}}');
      await render({ n: 1 });
      await type(field('n')?.querySelector<HTMLInputElement>('input.num') ?? null, '2.5');
      expect(ejson()).toBe('{"n":{"$numberDouble":"2.5"}}');
    });

    it('follows the defaultIntegerType setting (Double)', async () => {
      TestBed.inject(NumberDefaultService).integers.set('double');
      await render({ n: 1 });
      await type(field('n')?.querySelector<HTMLInputElement>('input.num') ?? null, '12');
      expect(ejson()).toBe('{"n":{"$numberDouble":"12.0"}}');
    });

    it('follows the defaultIntegerType setting (Int64)', async () => {
      TestBed.inject(NumberDefaultService).integers.set('int64');
      await render({ n: 1 });
      await type(field('n')?.querySelector<HTMLInputElement>('input.num') ?? null, '12');
      expect(ejson()).toBe('{"n":{"$numberLong":"12"}}');
    });
  });

  describe('field order', () => {
    const keys = () => orderOf(ejson());
    const move = async (key: string, dir: 'up' | 'down') => {
      field(key)?.querySelector<HTMLButtonElement>(`button[data-move="${dir}"]`)?.click();
      await fixture.whenStable();
    };
    const shown = () =>
      [...el().querySelectorAll('.fields > .field .name')].map((n) => n.textContent?.trim());

    it('moves fields up and down', async () => {
      await renderEJson('{"a":1,"b":2,"c":3}');
      await move('c', 'up');
      expect(keys()).toEqual(['a', 'c', 'b']);
      expect(shown()).toEqual(['a', 'c', 'b']);
      await move('a', 'down');
      expect(keys()).toEqual(['c', 'a', 'b']);
      // Values and their types travel with their field.
      expect(ejson()).toBe(
        '{"c":{"$numberInt":"3"},"a":{"$numberInt":"1"},"b":{"$numberInt":"2"}}',
      );
    });

    it('disables moving the first field up and the last one down', async () => {
      await renderEJson('{"a":1,"b":2}');
      const btn = (key: string, dir: string) =>
        field(key)?.querySelector<HTMLButtonElement>(`button[data-move="${dir}"]`);
      expect(btn('a', 'up')?.disabled).toBe(true);
      expect(btn('a', 'down')?.disabled).toBe(false);
      expect(btn('b', 'down')?.disabled).toBe(true);
    });

    it('keeps the order of integer-like keys through edits and moves', async () => {
      await renderEJson('{"b":1,"10":2,"a":3,"2":4}');
      expect(shown()).toEqual(['b', '10', 'a', '2']);
      expect(keys()).toEqual(['b', '10', 'a', '2']);
      await type(field('a')?.querySelector<HTMLInputElement>('app-bson-input input') ?? null, '9');
      expect(keys()).toEqual(['b', '10', 'a', '2']);
      await move('2', 'up');
      expect(keys()).toEqual(['b', '10', '2', 'a']);
      expect(shown()).toEqual(['b', '10', '2', 'a']);
    });
  });
});

/** Top-level keys of a JSON object text, in text order. */
function orderOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  const re = /"((?:[^"\\]|\\.)*)"\s*:|[{}[\]]/g;
  for (const m of text.matchAll(re)) {
    if (m[0] === '{' || m[0] === '[') depth++;
    else if (m[0] === '}' || m[0] === ']') depth--;
    else if (depth === 1 && m[1] !== undefined) out.push(m[1]);
  }
  return out;
}
