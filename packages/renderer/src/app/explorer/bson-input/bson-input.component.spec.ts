import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { type BsonLeafValue } from '../bson-value.util';
import { BsonDisplayService } from '../services/bson-display.service';
import { BsonInputComponent } from './bson-input.component';

// One typed input on its own: what it emits for what is typed, and that an
// untouched input left again (blur) changes nothing and shows no error.
describe('BsonInputComponent', () => {
  let fixture: ComponentFixture<BsonInputComponent>;
  let emitted: BsonLeafValue[];
  const el = () => fixture.nativeElement as HTMLElement;
  const inputs = () => [...el().querySelectorAll<HTMLInputElement>('input')];
  const errorText = () => el().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BsonInputComponent],
      providers: [provideZonelessChangeDetection()],
    });
    TestBed.inject(BsonDisplayService).timeZone.set('Europe/Zurich');
  });

  const render = async (value: BsonLeafValue) => {
    fixture = TestBed.createComponent(BsonInputComponent);
    emitted = [];
    fixture.componentRef.setInput('value', value);
    fixture.componentInstance.valueChange.subscribe((v: BsonLeafValue) => {
      emitted.push(v);
      fixture.componentRef.setInput('value', v);
    });
    await fixture.whenStable();
  };

  const blur = async (input: HTMLInputElement | undefined, text?: string) => {
    expect(input).toBeDefined();
    if (!input) return;
    if (text !== undefined) input.value = text;
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  };

  const ms = (iso: string) => BigInt(Date.parse(iso));

  describe('leaving an untouched input', () => {
    const values: [string, BsonLeafValue][] = [
      ['Int32', { type: 'int', value: -7 }],
      ['Int64', { type: 'long', value: 9007199254740993n }],
      ['Double -0', { type: 'double', value: -0 }],
      ['Double NaN', { type: 'double', value: NaN }],
      ['Decimal128', { type: 'decimal', value: '1.10' }],
      ['ObjectId', { type: 'objectId', hex: '65a1b2c3d4e5f60718293a4b' }],
      ['Date', { type: 'date', ms: ms('2023-11-14T22:13:20.042Z') }],
      ['Date (year 10000)', { type: 'date', ms: 253402300800000n }],
      ['UUID', { type: 'binary', subtype: 4, base64: 'ABEiM0RVZneImaq7zN3u/w==' }],
      ['Binary', { type: 'binary', subtype: 128, base64: 'AQI=' }],
      ['Regex', { type: 'regex', pattern: '^a', options: 'im' }],
      ['Timestamp', { type: 'timestamp', t: 1, i: 2 }],
      ['Code', { type: 'javascript', code: 'x => 1' }],
    ];
    for (const [name, v] of values) {
      it(`${name}: emits nothing and shows no error`, async () => {
        await render(v);
        for (const input of inputs().filter((i) => i.type !== 'datetime-local')) {
          await blur(input);
        }
        expect(emitted).toEqual([]);
        expect(errorText()).toBe('');
      });
    }

    // TW-1: the explorer shows Zurich dates before 1894 with a seconds offset
    // (+00:34:08), which the date parser does not read back.
    it('Date before 1894 in Zurich (offset with seconds): emits nothing and shows no error', async () => {
      await render({ type: 'date', ms: ms('1850-01-01T00:00:00Z') });
      await blur(inputs()[0]);
      expect(errorText()).toBe('');
      expect(emitted).toEqual([]);
    });

    // TW-2: dates beyond the JS date range are shown as their milliseconds,
    // which the date parser does not read back.
    it('Date outside the JS date range: emits nothing and shows no error', async () => {
      await render({ type: 'date', ms: 10n ** 17n });
      expect(inputs()[0]?.value).toBe('100000000000000000');
      await blur(inputs()[0]);
      expect(errorText()).toBe('');
      expect(emitted).toEqual([]);
    });
  });

  it('an unchanged value typed differently shows the canonical text again', async () => {
    await render({ type: 'int', value: 7 });
    const box = inputs()[0];
    await blur(box, ' 007 ');
    expect(emitted).toEqual([]);
    expect(box?.value).toBe('7');
  });

  // CR-4: a value set from outside (type dropdown, undo) replaces stale text and error.
  it('a new value from outside clears the error and shows the new value', async () => {
    await render({ type: 'long', value: 7n });
    await blur(inputs()[0], 'abc');
    expect(errorText()).toContain('not an integer');
    fixture.componentRef.setInput('value', { type: 'int', value: 7 });
    await fixture.whenStable();
    expect(errorText()).toBe('');
    expect(inputs()[0]?.value).toBe('7');
    expect(inputs()[0]?.classList.contains('invalid')).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('the shown text typed back after an error clears it without emitting', async () => {
    await render({ type: 'int', value: 7 });
    await blur(inputs()[0], 'x');
    expect(errorText()).not.toBe('');
    await blur(inputs()[0], '7');
    expect(errorText()).toBe('');
    expect(emitted).toEqual([]);
  });

  // Round 2: the error belongs to the input holding the invalid text.
  it('leaving another, untouched part keeps the error of the invalid one', async () => {
    await render({ type: 'timestamp', t: 10, i: 1 });
    await blur(inputs()[0], 'x');
    const shown = errorText();
    expect(shown).not.toBe('');
    await blur(inputs()[1]);
    expect(errorText()).toBe(shown);
    expect(inputs()[0]?.value).toBe('x');
    expect(emitted).toEqual([]);
  });

  it('a new value from outside rewrites the invalid part, not the others', async () => {
    await render({ type: 'regex', pattern: 'a', options: 'i' });
    await blur(inputs()[1], 'q');
    expect(errorText()).not.toBe('');
    fixture.componentRef.setInput('value', { type: 'regex', pattern: 'b', options: 'i' });
    await fixture.whenStable();
    expect(errorText()).toBe('');
    expect(inputs()[0]?.value).toBe('b');
    expect(inputs()[1]?.value).toBe('i');
    expect(inputs()[1]?.classList.contains('invalid')).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('a new value of another type from outside clears the error', async () => {
    await render({ type: 'long', value: 7n });
    await blur(inputs()[0], 'abc');
    expect(errorText()).not.toBe('');
    fixture.componentRef.setInput('value', { type: 'double', value: 2.5 });
    await fixture.whenStable();
    expect(errorText()).toBe('');
    expect(inputs()[0]?.value).toBe('2.5');
    expect(emitted).toEqual([]);
  });

  it('after an outside change, the old shown text is an edit again', async () => {
    await render({ type: 'int', value: 7 });
    fixture.componentRef.setInput('value', { type: 'int', value: 8 });
    await fixture.whenStable();
    await blur(inputs()[0], '7');
    expect(emitted).toEqual([{ type: 'int', value: 7 }]);
    expect(errorText()).toBe('');
  });

  // Round 2: the input holding the invalid text may be gone after a type change.
  it('a type change that replaces the invalid input clears the error safely', async () => {
    await render({ type: 'long', value: 7n });
    await blur(inputs()[0], 'abc');
    expect(errorText()).not.toBe('');
    fixture.componentRef.setInput('value', { type: 'timestamp', t: 3, i: 4 });
    await fixture.whenStable();
    expect(errorText()).toBe('');
    expect(inputs().map((i) => i.value)).toEqual(['3', '4']);
    expect(inputs().some((i) => i.classList.contains('invalid'))).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('a date outside the JS range is edited as milliseconds; Int64 overflow is rejected', async () => {
    const out = { type: 'date' as const, ms: 10n ** 17n };
    await render(out);
    expect(inputs()[0]?.value).toBe('100000000000000000');
    await blur(inputs()[0], '100000000000000001');
    expect(emitted).toEqual([{ type: 'date', ms: 10n ** 17n + 1n }]);
    await blur(inputs()[0], '9223372036854775808');
    expect(errorText()).toContain('overflows');
    expect(emitted).toHaveLength(1);
  });

  // Round-2 CR-1: a year typed into a date input is not saved as a 1970 date.
  it('a bare year typed into a date input is rejected, not read as milliseconds', async () => {
    await render({ type: 'date', ms: 1_700_000_000_000n });
    await blur(inputs()[0], '2024');
    expect(errorText()).toContain('ISO-8601');
    expect(emitted).toEqual([]);
  });

  it('-0 and 0 are different Doubles', async () => {
    await render({ type: 'double', value: 0 });
    await blur(inputs()[0], '-0');
    expect(emitted).toHaveLength(1);
    expect(Object.is((emitted[0] as { value: number }).value, -0)).toBe(true);
  });

  it('an error stays until a valid value is typed', async () => {
    await render({ type: 'long', value: 1n });
    await blur(inputs()[0], '1.5');
    expect(errorText()).toContain('not an integer');
    expect(inputs()[0]?.classList.contains('invalid')).toBe(true);
    await blur(inputs()[0], '2');
    expect(errorText()).toBe('');
    expect(emitted).toEqual([{ type: 'long', value: 2n }]);
  });

  it('Enter commits through blur', async () => {
    await render({ type: 'int', value: 1 });
    const box = inputs()[0];
    if (!box) throw new Error('no input');
    box.focus();
    box.value = '3';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(emitted).toEqual([{ type: 'int', value: 3 }]);
  });

  it('a binary subtype edit keeps the data; a data edit keeps the subtype', async () => {
    await render({ type: 'binary', subtype: 0, base64: 'AQI=' });
    await blur(inputs()[0], '0x80');
    expect(emitted.at(-1)).toEqual({ type: 'binary', subtype: 128, base64: 'AQI=' });
    await blur(inputs()[1], 'AQIDBA==');
    expect(emitted.at(-1)).toEqual({ type: 'binary', subtype: 128, base64: 'AQIDBA==' });
    await blur(inputs()[0], '300');
    expect(errorText()).toContain('is not a subtype');
    expect(emitted).toHaveLength(2);
  });

  it('a subtype-4 binary that is not 16 bytes is edited as subtype + data', async () => {
    await render({ type: 'binary', subtype: 4, base64: 'AQI=' });
    expect(inputs()).toHaveLength(2);
    expect(inputs()[0]?.value).toBe('4');
    expect(inputs()[1]?.value).toBe('AQI=');
  });

  it('a regex options edit keeps the pattern; a pattern edit keeps the options', async () => {
    await render({ type: 'regex', pattern: 'a', options: '' });
    await blur(inputs()[1], 'si');
    expect(emitted.at(-1)).toEqual({ type: 'regex', pattern: 'a', options: 'is' });
    await blur(inputs()[0], 'b');
    expect(emitted.at(-1)).toEqual({ type: 'regex', pattern: 'b', options: 'is' });
  });

  it('a timestamp increment edit keeps the seconds and vice versa', async () => {
    await render({ type: 'timestamp', t: 10, i: 1 });
    await blur(inputs()[1], '2');
    expect(emitted.at(-1)).toEqual({ type: 'timestamp', t: 10, i: 2 });
    await blur(inputs()[0], '11');
    expect(emitted.at(-1)).toEqual({ type: 'timestamp', t: 11, i: 2 });
    await blur(inputs()[0], '-1');
    expect(errorText()).toContain('seconds');
  });

  it('Code is taken as typed', async () => {
    await render({ type: 'javascript', code: 'a' });
    await blur(inputs()[0], 'function () { return 1 }');
    expect(emitted).toEqual([{ type: 'javascript', code: 'function () { return 1 }' }]);
  });

  it('Escape restores the part that was being edited', async () => {
    await render({ type: 'regex', pattern: 'a', options: 'i' });
    const opt = inputs()[1];
    if (!opt) throw new Error('no input');
    opt.value = 'q';
    opt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(opt.value).toBe('i');
    expect(emitted).toEqual([]);
  });

  it('MinKey and MaxKey show no input', async () => {
    await render({ type: 'minKey' });
    expect(inputs()).toEqual([]);
    expect(el().textContent).toContain('MinKey');
    expect(fixture.componentInstance.parse('text', 'x').ok).toBe(false);
  });

  describe('date-time picker', () => {
    const picker = () => el().querySelector<HTMLInputElement>('input[type="datetime-local"]');
    const pick = async (wall: string) => {
      const p = picker();
      expect(p).not.toBeNull();
      if (!p) return;
      p.value = wall;
      p.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };

    it('reads the wall time in UTC when dates are shown in UTC', async () => {
      TestBed.inject(BsonDisplayService).utc.set(true);
      await render({ type: 'date', ms: ms('2024-01-01T00:00:00Z') });
      expect(picker()?.getAttribute('aria-label')).toBe('Date and time (UTC)');
      await pick('2024-12-24T18:30');
      expect(emitted).toEqual([{ type: 'date', ms: ms('2024-12-24T18:30:00Z') }]);
    });

    it('labels the local picker and reads it in the shown zone', async () => {
      await render({ type: 'date', ms: ms('2024-01-01T00:00:00Z') });
      expect(picker()?.getAttribute('aria-label')).toBe('Date and time (local)');
      await pick('2024-07-01T12:00');
      expect(emitted).toEqual([{ type: 'date', ms: ms('2024-07-01T10:00:00Z') }]);
    });

    it('a cleared picker or the same instant changes nothing', async () => {
      await render({ type: 'date', ms: ms('2024-07-01T10:00:00Z') });
      fixture.componentInstance.commitWallTime('');
      fixture.componentInstance.commitWallTime('2024-07-01T12:00:00.000');
      await fixture.whenStable();
      expect(emitted).toEqual([]);
      expect(errorText()).toBe('');
    });

    it('an impossible wall time shows an error', async () => {
      await render({ type: 'date', ms: ms('2024-07-01T10:00:00Z') });
      fixture.componentInstance.commitWallTime('2024-02-30T10:00');
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(fixture.componentInstance.error).toContain('is not a valid date');
      expect(emitted).toEqual([]);
    });

    it('is not shown for dates a picker cannot hold', async () => {
      await render({ type: 'date', ms: 253402300800000n });
      expect(picker()).toBeNull();
    });
  });

  it('Generate replaces the ObjectId and clears an error', async () => {
    await render({ type: 'objectId', hex: '000000000000000000000000' });
    await blur(inputs()[0], 'nope');
    expect(errorText()).not.toBe('');
    el().querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    expect(errorText()).toBe('');
    expect(emitted).toHaveLength(1);
    const first = emitted[0];
    expect(first?.type === 'objectId' && first.hex).toMatch(/^[0-9a-f]{24}$/);
  });
});
