import { ConversionError, INT64_MAX, INT64_MIN, uuidOf } from '@thicket/core/bson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BsonLeaf, type BsonLeafValue, type DateDisplay } from './bson-value.util';
import {
  CREATABLE_TARGETS,
  blankBson,
  convertValue,
  currentTarget,
  dateToWallTime,
  editText,
  emptyOf,
  generateObjectId,
  isEmptyValue,
  newNumber,
  parseBinary,
  parseDate,
  parseDecimal,
  parseDouble,
  parseInt32,
  parseInt64,
  parseObjectId,
  parseRegex,
  parseTimestamp,
  parseUuid,
  typeOptions,
  wallTimeToMs,
} from './bson-input.util';

const UTC: DateDisplay = { utc: true };
const ZURICH: DateDisplay = { utc: false, timeZone: 'Europe/Zurich' };

const leaf = (v: BsonLeafValue) => new BsonLeaf(v);
const ms = (iso: string) => BigInt(Date.parse(iso));
const iso = (n: bigint | null) => (n === null ? null : new Date(Number(n)).toISOString());

/** The value of a successful parse, or the test fails with the parser's error. */
function value<T>(parsed: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!parsed.ok) throw new Error(`expected a value, got error: ${parsed.error}`);
  return parsed.value;
}
function error(parsed: { ok: true } | { ok: false; error: string }): string {
  if (parsed.ok) throw new Error('expected an error, got a value');
  return parsed.error;
}

// A fictitious 16-byte UUID binary and a short binary.
const UUID_B64 = 'ABEiM0RVZneImaq7zN3u/w=='; // 00112233-4455-6677-8899-aabbccddeeff
const UUID_LEAF = leaf({ type: 'binary', subtype: 4, base64: UUID_B64 });

afterEach(() => {
  vi.useRealTimers();
});

describe('parseInt32', () => {
  it('accepts both ends of the range, signs, spaces and leading zeros', () => {
    expect(value(parseInt32('2147483647'))).toEqual({ type: 'int', value: 2147483647 });
    expect(value(parseInt32('-2147483648'))).toEqual({ type: 'int', value: -2147483648 });
    expect(value(parseInt32('  +42 '))).toEqual({ type: 'int', value: 42 });
    expect(value(parseInt32('007'))).toEqual({ type: 'int', value: 7 });
  });

  it('turns "-0" into 0 (Int32 has no negative zero)', () => {
    expect(Object.is(value(parseInt32('-0')).value, 0)).toBe(true);
  });

  it('rejects one past either end as overflow', () => {
    expect(error(parseInt32('2147483648'))).toContain('overflows Int32');
    expect(error(parseInt32('-2147483649'))).toContain('overflows Int32');
    expect(error(parseInt32('99999999999999999999999'))).toContain('overflows Int32');
  });

  it('rejects fractions, exponents, hex, words and empty text', () => {
    for (const text of ['1.5', '1.0', '1e3', '0x10', 'twelve', '', '   ', '1 2', '--1']) {
      expect(error(parseInt32(text))).toContain('is not an integer');
    }
  });
});

describe('parseInt64', () => {
  it('accepts both ends of the range exactly', () => {
    expect(value(parseInt64(INT64_MAX.toString())).value).toBe(INT64_MAX);
    expect(value(parseInt64(INT64_MIN.toString())).value).toBe(INT64_MIN);
    expect(value(parseInt64(' 9007199254740993 '))).toEqual({
      type: 'long',
      value: 9007199254740993n,
    });
  });

  it('rejects one past either end as overflow', () => {
    expect(error(parseInt64('9223372036854775808'))).toContain('overflows Int64');
    expect(error(parseInt64('-9223372036854775809'))).toContain('overflows Int64');
  });

  it('rejects non-integers', () => {
    for (const text of ['1.0', '1e3', '', 'abc', 'Infinity']) {
      expect(error(parseInt64(text))).toContain('is not an integer');
    }
  });
});

describe('parseDouble', () => {
  it('accepts plain, signed, exponent and shorthand forms', () => {
    expect(value(parseDouble('3')).value).toBe(3);
    expect(value(parseDouble(' -1.25 ')).value).toBe(-1.25);
    expect(value(parseDouble('.5')).value).toBe(0.5);
    expect(value(parseDouble('5.')).value).toBe(5);
    expect(value(parseDouble('1e308')).value).toBe(1e308);
    expect(value(parseDouble('+2E-3')).value).toBe(0.002);
  });

  it('accepts Infinity, -Infinity, +Infinity and NaN', () => {
    expect(value(parseDouble('Infinity')).value).toBe(Infinity);
    expect(value(parseDouble('-Infinity')).value).toBe(-Infinity);
    expect(value(parseDouble('+Infinity')).value).toBe(Infinity);
    expect(Number.isNaN(value(parseDouble('NaN')).value)).toBe(true);
  });

  it('keeps negative zero', () => {
    expect(Object.is(value(parseDouble('-0')).value, -0)).toBe(true);
    expect(Object.is(value(parseDouble('-0.0')).value, -0)).toBe(true);
  });

  it('rejects numbers too large for a Double instead of making them Infinity', () => {
    expect(error(parseDouble('1e309'))).toContain('overflows Double');
    expect(error(parseDouble('-1e309'))).toContain('overflows Double');
  });

  it('rejects other spellings and non-numbers', () => {
    for (const text of ['nan', 'inf', '-infinity', '0x10', '1_000', '1,5', '', 'abc', '1e']) {
      expect(error(parseDouble(text))).toContain('is not a number');
    }
  });
});

describe('parseDecimal', () => {
  it('keeps the exact decimal text, trailing zeros included', () => {
    expect(value(parseDecimal('1.10'))).toEqual({ type: 'decimal', value: '1.10' });
    expect(value(parseDecimal(' 12 ')).value).toBe('12');
    expect(value(parseDecimal('-0')).value).toBe('-0');
    expect(value(parseDecimal('1234567890123456789012345678901234')).value).toBe(
      '1234567890123456789012345678901234',
    );
  });

  it('accepts the special values Decimal128 has', () => {
    expect(value(parseDecimal('NaN')).value).toBe('NaN');
    expect(value(parseDecimal('Infinity')).value).toBe('Infinity');
    expect(value(parseDecimal('-Infinity')).value).toBe('-Infinity');
  });

  it('rejects exponent overflow, too many digits, empty text and words', () => {
    for (const text of ['1e7000', '1E+6145', '12345678901234567890123456789012345', '', 'abc']) {
      expect(error(parseDecimal(text))).toContain('is not a Decimal128');
    }
  });
});

describe('parseObjectId', () => {
  it('accepts 24 hex characters, stored in lower case', () => {
    expect(value(parseObjectId(' 65A1B2C3D4E5F60718293A4B '))).toEqual({
      type: 'objectId',
      hex: '65a1b2c3d4e5f60718293a4b',
    });
  });

  it('rejects 23 or 25 characters and non-hex characters', () => {
    for (const text of [
      '65a1b2c3d4e5f60718293a4',
      '65a1b2c3d4e5f60718293a4b0',
      '65a1b2c3d4e5f60718293a4g',
      '',
    ]) {
      expect(error(parseObjectId(text))).toContain('is not an ObjectId');
    }
  });
});

describe('parseUuid', () => {
  it('accepts UUID text with or without dashes, any case', () => {
    const expected = { type: 'binary', subtype: 4, base64: UUID_B64 };
    expect(value(parseUuid('00112233-4455-6677-8899-aabbccddeeff'))).toEqual(expected);
    expect(value(parseUuid('00112233445566778899AABBCCDDEEFF'))).toEqual(expected);
  });

  it('rejects text that is not a UUID', () => {
    expect(error(parseUuid('not-a-uuid'))).toContain('is not a UUID');
    expect(error(parseUuid('00112233-4455-6677-8899-aabbccddeef'))).toContain('is not a UUID');
  });
});

describe('parseBinary', () => {
  it('reads the subtype as decimal or 0x hex, up to 255', () => {
    expect(value(parseBinary('0', '')).subtype).toBe(0);
    expect(value(parseBinary('255', '')).subtype).toBe(255);
    expect(value(parseBinary('0x80', '')).subtype).toBe(128);
    expect(value(parseBinary('0xFF', '')).subtype).toBe(255);
    expect(value(parseBinary(' 0x5 ', '')).subtype).toBe(5);
  });

  it('rejects subtypes outside 0 … 255 and other text', () => {
    for (const sub of ['256', '0x100', '-1', '', 'abc', '1.5', '0x', '1000']) {
      expect(error(parseBinary(sub, 'AQI='))).toContain('is not a subtype');
    }
  });

  it('accepts padded base64, ignoring whitespace and line breaks, and empty data', () => {
    expect(value(parseBinary('0', 'AQ ID\nBA=='))).toEqual({
      type: 'binary',
      subtype: 0,
      base64: 'AQIDBA==',
    });
    expect(value(parseBinary('0', 'AQI=')).base64).toBe('AQI=');
    expect(value(parseBinary('0', '')).base64).toBe('');
  });

  it('rejects unpadded, wrongly padded and non-base64 data', () => {
    for (const data of ['AQ', 'A!==', '====', 'AQ=', 'AQIDB', 'AQ-_']) {
      expect(error(parseBinary('0', data))).toContain('not base64');
    }
  });
});

describe('parseRegex', () => {
  it('keeps the pattern as typed and stores the options sorted', () => {
    expect(value(parseRegex('^a(b', ' xmi '))).toEqual({
      type: 'regex',
      pattern: '^a(b',
      options: 'imx',
    });
    expect(value(parseRegex('', '')).options).toBe('');
    expect(value(parseRegex('a', 'usxmli')).options).toBe('ilmsux');
  });

  it("rejects options outside MongoDB's ilmsux, such as JS's g and y", () => {
    expect(error(parseRegex('a', 'g'))).toContain('unknown regex option "g"');
    expect(error(parseRegex('a', 'iyz'))).toContain('unknown regex option "yz"');
    expect(error(parseRegex('a', 'I'))).toContain('unknown regex option');
  });

  it('rejects a repeated option and a NUL in the pattern', () => {
    expect(error(parseRegex('a', 'ii'))).toContain('repeated');
    expect(error(parseRegex('a\0b', 'i'))).toContain('NUL');
  });
});

describe('parseTimestamp', () => {
  it('accepts 0 and the 32-bit maximum for both parts', () => {
    expect(value(parseTimestamp('0', '0'))).toEqual({ type: 'timestamp', t: 0, i: 0 });
    expect(value(parseTimestamp(' 4294967295 ', '4294967295'))).toEqual({
      type: 'timestamp',
      t: 4294967295,
      i: 4294967295,
    });
  });

  it('rejects overflow, negative and fractional parts, naming the part', () => {
    expect(error(parseTimestamp('4294967296', '0'))).toContain('seconds 4294967296 overflows');
    expect(error(parseTimestamp('0', '4294967296'))).toContain('increment 4294967296 overflows');
    expect(error(parseTimestamp('-1', '0'))).toContain('seconds "-1" is not an unsigned integer');
    expect(error(parseTimestamp('0', '1.5'))).toContain('increment "1.5"');
    expect(error(parseTimestamp('', '0'))).toContain('seconds');
  });

  it('reports the seconds first when both parts are wrong', () => {
    expect(error(parseTimestamp('x', 'y'))).toContain('seconds');
  });
});

describe('parseDate', () => {
  it('takes a Z or an explicit offset as is, whatever zone dates are shown in', () => {
    for (const dates of [UTC, ZURICH]) {
      expect(iso(value(parseDate('2024-01-02T03:04:05Z', dates)).ms)).toBe(
        '2024-01-02T03:04:05.000Z',
      );
      expect(iso(value(parseDate('2024-01-02T08:34:05.120+05:30', dates)).ms)).toBe(
        '2024-01-02T03:04:05.120Z',
      );
    }
  });

  it('ignores a trailing zone name as the explorer shows it', () => {
    const shown = '2023-11-14T23:13:20.000+01:00 Europe/Zurich';
    expect(iso(value(parseDate(shown, UTC)).ms)).toBe('2023-11-14T22:13:20.000Z');
    expect(iso(value(parseDate(shown, ZURICH)).ms)).toBe('2023-11-14T22:13:20.000Z');
    expect(
      iso(value(parseDate('2024-01-01T00:00:00-03:00 America/Argentina/Buenos_Aires', UTC)).ms),
    ).toBe('2024-01-01T03:00:00.000Z');
    expect(iso(value(parseDate('2024-01-01T00:00:00-05:00 Etc/GMT+5', UTC)).ms)).toBe(
      '2024-01-01T05:00:00.000Z',
    );
  });

  it('reads a date-time without offset as wall time in the shown zone', () => {
    expect(iso(value(parseDate('2024-07-01T12:00', ZURICH)).ms)).toBe('2024-07-01T10:00:00.000Z');
    expect(iso(value(parseDate('2024-01-15T12:00', ZURICH)).ms)).toBe('2024-01-15T11:00:00.000Z');
    expect(iso(value(parseDate('2024-07-01T12:00', UTC)).ms)).toBe('2024-07-01T12:00:00.000Z');
    expect(iso(value(parseDate(' 2024-07-01T12:00:30.5 ', UTC)).ms)).toBe(
      '2024-07-01T12:00:30.500Z',
    );
  });

  it('reads a date alone as UTC midnight, even when local time is shown', () => {
    expect(iso(value(parseDate('2024-05-01', ZURICH)).ms)).toBe('2024-05-01T00:00:00.000Z');
  });

  it('reads extended years as the explorer writes them', () => {
    expect(value(parseDate('+010000-01-01T00:00:00.000Z', UTC)).ms).toBe(253402300800000n);
    expect(value(parseDate('-000001-01-01T00:00:00.000Z', UTC)).ms).toBe(-62198755200000n);
  });

  it('rejects impossible calendar dates and times, with or without offset', () => {
    expect(error(parseDate('2024-02-30T10:00', ZURICH))).toContain('is not a valid date');
    expect(error(parseDate('2024-01-01T24:00', UTC))).toContain('is not a valid date');
    expect(error(parseDate('2023-02-29', UTC))).toContain('is not an ISO-8601 date');
    expect(error(parseDate('2023-02-29T00:00:00Z', UTC))).toContain('is not an ISO-8601 date');
  });

  it('rejects text that is not ISO-8601', () => {
    for (const text of ['', 'yesterday', '14.11.2023', '2023-11-14 23:13', '1.5', '1e3']) {
      expect(error(parseDate(text, ZURICH))).toContain('not');
    }
  });

  // CR-1 / TW-2: dates outside the JS date range are shown as their bare
  // millisecond count, so that text must be editable too.
  it('reads a bare signed integer outside the JS date range as milliseconds, within Int64', () => {
    expect(value(parseDate(' -100000000000000000 ', UTC)).ms).toBe(-(10n ** 17n));
    expect(value(parseDate('8640000000000001', UTC)).ms).toBe(8_640_000_000_000_001n);
    expect(value(parseDate('-8640000000000001', ZURICH)).ms).toBe(-8_640_000_000_000_001n);
    expect(value(parseDate('+9223372036854775807', UTC)).ms).toBe(2n ** 63n - 1n);
    expect(error(parseDate('9223372036854775808', UTC))).toContain('overflows');
  });

  // Round-2 CR-1: within the JS date range a bare number is more likely a
  // year or a compact date than milliseconds; it must not become a 1970 date.
  it('rejects a bare integer within the JS date range as not ISO-8601', () => {
    for (const text of [
      '2024',
      '20240501',
      '1700000000000',
      '0',
      '-0',
      '8640000000000000',
      '-8640000000000000',
    ]) {
      expect(error(parseDate(text, UTC)), text).toContain('is not an ISO-8601 date');
      expect(error(parseDate(text, ZURICH)), text).toContain('is not an ISO-8601 date');
    }
  });

  // CR-1 / TW-1: local mean time offsets have seconds.
  it('reads an offset with seconds', () => {
    expect(iso(value(parseDate('1850-01-01T00:34:08.000+00:34:08', UTC)).ms)).toBe(
      '1850-01-01T00:00:00.000Z',
    );
    expect(iso(value(parseDate('1850-01-01T00:00:00-00:00:30 Some/Zone', UTC)).ms)).toBe(
      '1850-01-01T00:00:30.000Z',
    );
    expect(error(parseDate('1850-01-01T00:00:00+00:60:00', UTC))).toContain('not');
    expect(error(parseDate('1850-02-30T00:00:00+00:34:08', UTC))).toContain('not');
  });

  // Round 2: both Int64 ends and the units of a seconds offset.
  it('accepts the lowest Int64 milliseconds and rejects one below', () => {
    expect(value(parseDate('-9223372036854775808', UTC)).ms).toBe(INT64_MIN);
    expect(error(parseDate('-9223372036854775809', UTC))).toContain('overflows');
  });

  it('bounds each unit of a seconds offset (hours < 24, minutes and seconds < 60)', () => {
    expect(iso(value(parseDate('2000-01-01T00:00:00+23:59:59', UTC)).ms)).toBe(
      '1999-12-31T00:00:01.000Z',
    );
    expect(iso(value(parseDate('2000-01-01T00:00:00-23:59:59', UTC)).ms)).toBe(
      '2000-01-01T23:59:59.000Z',
    );
    for (const off of ['+24:00:00', '+00:00:60', '-24:00:00']) {
      expect(error(parseDate(`2000-01-01T00:00:00${off}`, UTC)), off).toContain('not');
    }
    // A seconds offset needs a time; a date alone with one is not ISO-8601.
    expect(error(parseDate('2000-01-01+00:34:08', UTC))).toContain('not');
  });

  it('the shown text of extended-year dates in local mean time parses back', () => {
    for (const t of ['-000001-01-01T00:00:00.000Z', '+010000-06-01T12:00:00.000Z']) {
      const d = { type: 'date' as const, ms: BigInt(Date.parse(t)) };
      const shown = editText(d, ZURICH);
      const back = parseDate(shown, ZURICH);
      expect(back.ok ? back.value.ms : back.error, `shown as ${shown}`).toBe(d.ms);
    }
  });

  it('the bare milliseconds shown for out-of-range dates parse back in any zone', () => {
    for (const t of [
      10n ** 17n,
      -(10n ** 17n),
      8_640_000_000_000_001n,
      -8_640_000_000_000_001n,
      INT64_MIN,
      2n ** 63n - 1n,
    ]) {
      for (const dates of [UTC, ZURICH]) {
        const shown = editText({ type: 'date', ms: t }, dates);
        expect(value(parseDate(shown, dates)).ms, `shown as ${shown}`).toBe(t);
      }
    }
  });
});

describe('wallTimeToMs', () => {
  it('reads wall time in UTC mode as UTC', () => {
    expect(iso(wallTimeToMs('2024-07-01T12:00', UTC))).toBe('2024-07-01T12:00:00.000Z');
    expect(iso(wallTimeToMs('2024-07-01T12:00:05.123', UTC))).toBe('2024-07-01T12:00:05.123Z');
  });

  it('returns null for impossible dates and text that is not a wall time', () => {
    expect(wallTimeToMs('2024-02-30T10:00', ZURICH)).toBeNull();
    expect(wallTimeToMs('2024-01-01T10:60', UTC)).toBeNull();
    expect(wallTimeToMs('2024-01-01', UTC)).toBeNull();
    expect(wallTimeToMs('2024-01-01T10:00Z', UTC)).toBeNull();
    expect(wallTimeToMs('', UTC)).toBeNull();
  });

  it('uses the system zone when no zone is given', () => {
    const result = wallTimeToMs('2024-07-01T12:00', { utc: false });
    expect(result).not.toBeNull();
    // Whatever the machine's zone, the result shows the same wall time there.
    expect(dateToWallTime(result ?? 0n, { utc: false })).toBe('2024-07-01T12:00:00.000');
  });

  it('a wall time in the spring-forward gap (Zurich) moves forward by the gap, as JS dates do', () => {
    // 2024-03-31 02:00 → 03:00 in Zurich: 02:30 does not exist.
    expect(iso(wallTimeToMs('2024-03-31T02:30', ZURICH))).toBe('2024-03-31T01:30:00.000Z');
    expect(dateToWallTime(ms('2024-03-31T01:30:00Z'), ZURICH)).toBe('2024-03-31T03:30:00.000');
  });

  it('a wall time in the fall-back overlap (Zurich) gives one of its two instants', () => {
    // 2024-10-27 03:00 → 02:00 in Zurich: 02:30 happens at 00:30Z and at 01:30Z.
    const result = iso(wallTimeToMs('2024-10-27T02:30', ZURICH));
    expect(['2024-10-27T00:30:00.000Z', '2024-10-27T01:30:00.000Z']).toContain(result);
  });

  it('just before and after both Zurich changes, wall times map to the right offset', () => {
    expect(iso(wallTimeToMs('2024-03-31T01:59:59.999', ZURICH))).toBe('2024-03-31T00:59:59.999Z');
    expect(iso(wallTimeToMs('2024-03-31T03:00', ZURICH))).toBe('2024-03-31T01:00:00.000Z');
    expect(iso(wallTimeToMs('2024-10-27T01:59:59.999', ZURICH))).toBe('2024-10-26T23:59:59.999Z');
    expect(iso(wallTimeToMs('2024-10-27T03:00', ZURICH))).toBe('2024-10-27T02:00:00.000Z');
  });

  // Every instant on the change days (15 min steps) round-trips through its
  // wall time, except the repeated hour, which at least shows the same wall time.
  for (const zone of [
    'Europe/Zurich',
    'America/St_Johns',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Asia/Kathmandu',
  ]) {
    it(`round-trips instants across a year's offset changes in ${zone}`, () => {
      const dates: DateDisplay = { utc: false, timeZone: zone };
      const failures: string[] = [];
      const start = Date.parse('2024-01-01T00:00:00Z');
      const end = Date.parse('2025-01-01T00:00:00Z');
      for (let t = start; t < end; t += 15 * 60_000) {
        const wall = dateToWallTime(BigInt(t), dates);
        const back = wallTimeToMs(wall, dates);
        if (back === BigInt(t)) continue;
        // Ambiguous wall time (repeated hour): any instant showing it is fine.
        if (back !== null && dateToWallTime(back, dates) === wall) continue;
        failures.push(`${new Date(t).toISOString()} → ${wall} → ${iso(back)}`);
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('dateToWallTime', () => {
  it('gives the wall time in the shown zone, with milliseconds', () => {
    const t = ms('2023-11-14T22:13:20.042Z');
    expect(dateToWallTime(t, UTC)).toBe('2023-11-14T22:13:20.042');
    expect(dateToWallTime(t, ZURICH)).toBe('2023-11-14T23:13:20.042');
  });

  it('is empty for dates a datetime-local picker cannot show', () => {
    // Beyond the JS date range.
    expect(dateToWallTime(8_640_000_000_000_001n, UTC)).toBe('');
    expect(dateToWallTime(-8_640_000_000_000_001n, ZURICH)).toBe('');
    // Five- and six-digit or negative years.
    expect(dateToWallTime(253402300800000n, UTC)).toBe('');
    expect(dateToWallTime(8_640_000_000_000_000n, ZURICH)).toBe('');
    expect(dateToWallTime(-62198755200000n, UTC)).toBe('');
  });

  it('shows the last four-digit-year instant', () => {
    expect(dateToWallTime(253402300799999n, UTC)).toBe('9999-12-31T23:59:59.999');
  });
});

describe('generateObjectId', () => {
  const fill =
    (...values: number[]) =>
    (bytes: Uint8Array) =>
      bytes.set(values.slice(0, bytes.length));

  it('puts the seconds first, then five random bytes, then a 3-byte counter', () => {
    const id = generateObjectId(1_700_000_000_999, fill(1, 2, 3, 4, 0xfe, 9, 9, 9));
    expect(id.type).toBe('objectId');
    expect(id.hex).toMatch(/^[0-9a-f]{24}$/);
    expect(id.hex.slice(0, 8)).toBe((1_700_000_000).toString(16));
    expect(id.hex.slice(8, 18)).toBe('01020304fe');
  });

  it('counts up by one per id (wrapping at 2^24) with the same clock and random bytes', () => {
    const random = fill(0, 0, 0, 0, 0);
    const a = generateObjectId(0, random);
    const b = generateObjectId(0, random);
    expect(a.hex.slice(0, 18)).toBe('000000000000000000');
    expect(b.hex).not.toBe(a.hex);
    const counterA = parseInt(a.hex.slice(18), 16);
    const counterB = parseInt(b.hex.slice(18), 16);
    expect(counterB).toBe((counterA + 1) % 0x100_0000);
  });

  it('pads small times and wraps times past 32 bits', () => {
    expect(generateObjectId(16_000, fill()).hex.slice(0, 8)).toBe('00000010');
    expect(generateObjectId(2 ** 32 * 1000 + 5000, fill()).hex.slice(0, 8)).toBe('00000005');
  });

  it('uses the clock and crypto by default', () => {
    vi.useFakeTimers({ now: Date.parse('2030-01-01T00:00:00Z'), toFake: ['Date'] });
    const hex = generateObjectId().hex;
    expect(hex.slice(0, 8)).toBe((Date.parse('2030-01-01T00:00:00Z') / 1000).toString(16));
    expect(generateObjectId().hex).not.toBe(hex);
  });
});

describe('editText', () => {
  it('shows numbers exactly, -0 included', () => {
    expect(editText({ type: 'int', value: -5 }, UTC)).toBe('-5');
    expect(editText({ type: 'long', value: INT64_MAX }, UTC)).toBe('9223372036854775807');
    expect(editText({ type: 'double', value: -0 }, UTC)).toBe('-0');
    expect(editText({ type: 'double', value: NaN }, UTC)).toBe('NaN');
    expect(editText({ type: 'double', value: 1e21 }, UTC)).toBe('1e+21');
    expect(editText({ type: 'decimal', value: '1.10' }, UTC)).toBe('1.10');
  });

  it('shows ObjectIds, code, UUIDs and other binaries as their text', () => {
    expect(editText({ type: 'objectId', hex: '65a1b2c3d4e5f60718293a4b' }, UTC)).toBe(
      '65a1b2c3d4e5f60718293a4b',
    );
    expect(editText({ type: 'javascript', code: 'x => 1' }, UTC)).toBe('x => 1');
    expect(editText(UUID_LEAF.bson, UTC)).toBe('00112233-4455-6677-8899-aabbccddeeff');
    expect(editText({ type: 'binary', subtype: 0, base64: UUID_B64 }, UTC)).toBe(UUID_B64);
  });

  it('shows dates as the explorer does, and out-of-range dates as their milliseconds', () => {
    const t = ms('2023-11-14T22:13:20Z');
    expect(editText({ type: 'date', ms: t }, UTC)).toBe('2023-11-14T22:13:20.000Z');
    expect(editText({ type: 'date', ms: t }, ZURICH)).toBe(
      '2023-11-14T23:13:20.000+01:00 Europe/Zurich',
    );
    expect(editText({ type: 'date', ms: 10n ** 17n }, UTC)).toBe('100000000000000000');
  });

  it('has no single text for multi-part values', () => {
    expect(editText({ type: 'regex', pattern: 'a', options: 'i' }, UTC)).toBe('');
    expect(editText({ type: 'timestamp', t: 1, i: 2 }, UTC)).toBe('');
  });

  // What an input shows must read back as the same value, or merely leaving
  // an untouched date input shows an error (see bson-input.component.spec).
  it('the shown date text parses back to the same instant (offsets in whole minutes)', () => {
    for (const t of [
      '2023-11-14T22:13:20.042Z',
      '2024-07-01T10:00:00Z',
      '1970-01-01T00:00:00Z',
      '1950-06-15T12:00:00Z',
      '9999-12-31T22:00:00Z',
    ]) {
      for (const dates of [UTC, ZURICH, { utc: false, timeZone: 'Asia/Kathmandu' }]) {
        const shown = editText({ type: 'date', ms: ms(t) }, dates);
        const back = parseDate(shown, dates);
        expect(back.ok ? iso(back.value.ms) : back.error, `${t} shown as ${shown}`).toBe(
          new Date(t).toISOString(),
        );
      }
    }
  });

  it('the shown date text parses back for years past 9999 and before 0', () => {
    for (const t of [253402300800000n, -62198755200000n, 8_640_000_000_000_000n]) {
      const shown = editText({ type: 'date', ms: t }, UTC);
      expect(value(parseDate(shown, UTC)).ms).toBe(t);
    }
  });

  // TW-1: local mean time offsets have seconds (Zurich +00:34:08 before
  // 1894-06-01, Kathmandu +05:41:16 before 1920); the explorer shows them,
  // but parseDate only reads ±HH:MM offsets.
  it('the shown date text parses back when the offset has seconds (local mean time)', () => {
    const cases: [string, DateDisplay][] = [
      ['1850-01-01T00:00:00Z', ZURICH],
      ['0001-01-01T00:00:00Z', ZURICH],
      ['1900-06-15T12:00:00Z', { utc: false, timeZone: 'Asia/Kathmandu' }],
    ];
    for (const [t, dates] of cases) {
      const shown = editText({ type: 'date', ms: ms(t) }, dates);
      const back = parseDate(shown, dates);
      expect(back.ok ? iso(back.value.ms) : back.error, `shown as ${shown}`).toBe(
        new Date(t).toISOString(),
      );
    }
  });
});

describe('currentTarget and isEmptyValue', () => {
  it('names a 16-byte subtype-4 binary uuid and everything else by its BSON type', () => {
    expect(currentTarget(UUID_LEAF)).toBe('uuid');
    expect(currentTarget(leaf({ type: 'binary', subtype: 4, base64: 'AQI=' }))).toBe('binary');
    expect(currentTarget(leaf({ type: 'binary', subtype: 0, base64: UUID_B64 }))).toBe('binary');
    expect(currentTarget(1)).toBe('int');
    expect(currentTarget(1.5)).toBe('double');
    expect(currentTarget('x')).toBe('string');
    expect(currentTarget({})).toBe('object');
    expect(currentTarget(null)).toBe('null');
  });

  it('counts null, undefined, "", [], {}, MinKey and MaxKey as empty', () => {
    for (const v of [
      null,
      undefined,
      '',
      [],
      {},
      leaf({ type: 'minKey' }),
      leaf({ type: 'maxKey' }),
    ]) {
      expect(isEmptyValue(v)).toBe(true);
    }
  });

  it('does not count blank-looking values with content as empty', () => {
    for (const v of [
      ' ',
      0,
      false,
      [null],
      { a: undefined },
      leaf({ type: 'int', value: 0 }),
      leaf({ type: 'binary', subtype: 0, base64: '' }),
    ]) {
      expect(isEmptyValue(v)).toBe(false);
    }
  });
});

describe('typeOptions and convertValue', () => {
  const states = (v: unknown) =>
    Object.fromEntries(typeOptions(v).map((o) => [o.target, o.enabled]));

  it('lists the 18 creatable types in order and never a deprecated one', () => {
    const targets = typeOptions('x').map((o) => o.target);
    expect(targets).toEqual(CREATABLE_TARGETS);
    expect(targets).toHaveLength(18);
    for (const t of ['undefined', 'symbol', 'dbPointer', 'javascriptWithScope']) {
      expect(targets).not.toContain(t);
    }
    expect(typeOptions('x').find((o) => o.target === 'javascript')?.label).toBe('Code');
  });

  it('enables every type for each kind of empty value', () => {
    for (const v of [null, '', [], {}, leaf({ type: 'minKey' }), leaf({ type: 'maxKey' })]) {
      expect(Object.values(states(v)).every(Boolean), JSON.stringify(v)).toBe(true);
    }
  });

  it('gives an empty value the empty value of a type it has no conversion to', () => {
    expect(convertValue('', 'timestamp')).toEqual(leaf({ type: 'timestamp', t: 0, i: 0 }));
    expect(convertValue(null, 'int')).toEqual(leaf({ type: 'int', value: 0 }));
    expect(convertValue(leaf({ type: 'minKey' }), 'long')).toEqual(
      leaf({ type: 'long', value: 0n }),
    );
    expect(convertValue(leaf({ type: 'maxKey' }), 'string')).toBe('');
    expect(convertValue({}, 'decimal')).toEqual(leaf({ type: 'decimal', value: '0' }));
    expect(convertValue([], 'bool')).toBe(false);
    expect(convertValue('', 'binary')).toEqual(leaf({ type: 'binary', subtype: 0, base64: '' }));
    expect(convertValue(null, 'javascript')).toEqual(leaf({ type: 'javascript', code: '' }));
  });

  it('uses the real conversion for an empty value when one exists', () => {
    expect(convertValue([], 'object')).toEqual({});
    expect(convertValue({}, 'array')).toEqual([]);
    expect(convertValue('', 'regex')).toEqual(leaf({ type: 'regex', pattern: '', options: '' }));
    expect(convertValue(null, 'minKey')).toEqual(leaf({ type: 'minKey' }));
  });

  it('gives an empty value a date of now and a fresh ObjectId', () => {
    vi.useFakeTimers({ now: Date.parse('2026-02-03T04:05:06.789Z'), toFake: ['Date'] });
    expect(convertValue('', 'date')).toEqual(
      leaf({ type: 'date', ms: ms('2026-02-03T04:05:06.789Z') }),
    );
    const oid = convertValue(null, 'objectId') as BsonLeaf;
    expect(oid.bson.type).toBe('objectId');
    expect(oid.bson.type === 'objectId' && oid.bson.hex.slice(0, 8)).toBe(
      Math.floor(Date.parse('2026-02-03T04:05:06Z') / 1000).toString(16),
    );
  });

  it('gives an empty value a random version-4 UUID', () => {
    const a = convertValue('', 'uuid') as BsonLeaf;
    const b = convertValue('', 'uuid') as BsonLeaf;
    const text = uuidOf(a.bson);
    expect(text).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidOf(b.bson)).not.toBe(text);
    expect(currentTarget(a)).toBe('uuid');
  });

  it('throws a ConversionError for a non-empty value without conversion, and says why', () => {
    expect(() => convertValue('abc', 'timestamp')).toThrow(ConversionError);
    expect(() => convertValue('abc', 'int')).toThrow(ConversionError);
    expect(() => convertValue(leaf({ type: 'int', value: 1 }), 'objectId')).toThrow(
      'only strings convert to ObjectId',
    );
    const ts = typeOptions('abc').find((o) => o.target === 'timestamp');
    expect(ts).toMatchObject({ enabled: false });
    expect(ts?.reason).toContain('timestamps are created by the server');
  });

  it('a UUID can become a string but not a plain Binary (it already is one)', () => {
    const s = states(UUID_LEAF);
    expect(s['uuid']).toBe(true);
    expect(s['string']).toBe(true);
    expect(s['binary']).toBe(false);
    expect(typeOptions(UUID_LEAF).find((o) => o.target === 'binary')?.reason).toContain(
      'it already is one; edit its subtype instead',
    );
    expect(convertValue(UUID_LEAF, 'string')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });

  // CR-2: a filled document or array is decided by its type alone (no deep
  // conversion), with the same result as converting it.
  it('enables for a filled document or array exactly what converting it allows', () => {
    const doc = { a: [1, { b: leaf({ type: 'long', value: 1n }) }], c: 'x' };
    const arr = [{ a: 1 }, 'x', leaf({ type: 'date', ms: 0n })];
    for (const v of [doc, arr]) {
      for (const o of typeOptions(v)) {
        let converts = o.target === currentTarget(v);
        try {
          convertValue(v, o.target);
          converts = true;
        } catch (e) {
          expect(e).toBeInstanceOf(ConversionError);
          expect(o.reason).toBe((e as Error).message);
        }
        expect(o.enabled, `${JSON.stringify(v)} -> ${o.target}`).toBe(converts);
      }
    }
    const enabled = (v: unknown) =>
      typeOptions(v)
        .filter((o) => o.enabled)
        .map((o) => o.target);
    expect(enabled(doc)).toEqual(['object', 'array', 'null', 'minKey', 'maxKey']);
    expect(enabled(arr)).toEqual(['object', 'array', 'null', 'minKey', 'maxKey']);
  });

  it('a 16-byte binary can become a UUID, a shorter one cannot', () => {
    const bin16 = leaf({ type: 'binary', subtype: 0, base64: UUID_B64 });
    expect(convertValue(bin16, 'uuid')).toEqual(UUID_LEAF);
    expect(states(bin16)['binary']).toBe(true);
    const short = leaf({ type: 'binary', subtype: 0, base64: 'AQI=' });
    expect(states(short)['uuid']).toBe(false);
  });

  it('choosing the current type gives the same value back', () => {
    const v = leaf({ type: 'long', value: 5n });
    expect(convertValue(v, 'long')).toEqual(v);
    expect(convertValue(7, 'int')).toEqual(leaf({ type: 'int', value: 7 }));
    expect(convertValue('a', 'string')).toBe('a');
  });

  it('converts plain explorer numbers by their BSON type (Int32 or Double)', () => {
    expect(convertValue(7, 'long')).toEqual(leaf({ type: 'long', value: 7n }));
    expect(states(1.5)['int']).toBe(false);
    expect(convertValue(1.5, 'decimal')).toEqual(leaf({ type: 'decimal', value: '1.5' }));
  });

  it('converts an array to a document keyed by index, and back', () => {
    expect(convertValue(['a', 'b'], 'object')).toEqual({ 0: 'a', 1: 'b' });
    expect(convertValue({ x: 'a', y: 'b' }, 'array')).toEqual(['a', 'b']);
  });

  it('enables the deprecated types never, even for a deprecated value', () => {
    const sym = leaf({ type: 'symbol', value: 's' });
    const options = typeOptions(sym);
    expect(options.map((o) => o.target)).not.toContain('symbol');
    expect(convertValue(sym, 'string')).toBe('s');
  });
});

describe('emptyOf and blankBson', () => {
  it('blanks numbers, text and parts to their type’s zero', () => {
    const cases: [BsonLeafValue, BsonLeafValue][] = [
      [
        { type: 'int', value: 5 },
        { type: 'int', value: 0 },
      ],
      [
        { type: 'long', value: 5n },
        { type: 'long', value: 0n },
      ],
      [
        { type: 'double', value: 2.5 },
        { type: 'double', value: 0 },
      ],
      [
        { type: 'decimal', value: '9.99' },
        { type: 'decimal', value: '0' },
      ],
      [
        { type: 'regex', pattern: 'a', options: 'i' },
        { type: 'regex', pattern: '', options: '' },
      ],
      [
        { type: 'javascript', code: 'f()' },
        { type: 'javascript', code: '' },
      ],
      [
        { type: 'timestamp', t: 9, i: 9 },
        { type: 'timestamp', t: 0, i: 0 },
      ],
      [{ type: 'minKey' }, { type: 'minKey' }],
      [{ type: 'maxKey' }, { type: 'maxKey' }],
    ];
    for (const [from, to] of cases) expect(blankBson(from)).toEqual(to);
  });

  it('keeps a binary’s subtype with empty data', () => {
    expect(blankBson({ type: 'binary', subtype: 0x80, base64: 'AQI=' })).toEqual({
      type: 'binary',
      subtype: 0x80,
      base64: '',
    });
  });

  it('gives new ObjectIds, UUIDs and a date of now', () => {
    vi.useFakeTimers({ now: Date.parse('2026-02-03T04:05:06Z'), toFake: ['Date'] });
    const oid = blankBson({ type: 'objectId', hex: '000000000000000000000000' });
    expect(oid.type === 'objectId' && oid.hex).not.toBe('000000000000000000000000');
    const uuid = blankBson(UUID_LEAF.bson);
    expect(uuid.type).toBe('binary');
    expect(uuidOf(uuid)).not.toBeNull();
    expect(uuidOf(uuid)).not.toBe('00112233-4455-6677-8899-aabbccddeeff');
    expect(blankBson({ type: 'date', ms: 0n })).toEqual({
      type: 'date',
      ms: ms('2026-02-03T04:05:06Z'),
    });
  });

  it('turns deprecated types into null', () => {
    const deprecated: BsonLeafValue[] = [
      { type: 'undefined' },
      { type: 'symbol', value: 's' },
      { type: 'dbPointer', ref: 'db.c', hex: '65a1b2c3d4e5f60718293a4b' },
      { type: 'javascriptWithScope', code: 'f', scope: { type: 'object', fields: [] } },
    ];
    for (const v of deprecated) expect(blankBson(v)).toEqual({ type: 'null' });
  });

  it('has an empty value for every creatable type, of that type', () => {
    for (const target of CREATABLE_TARGETS) {
      const v = emptyOf(target);
      expect(target === 'uuid' ? uuidOf(v) !== null : v.type === target, target).toBe(true);
    }
  });
});

describe('newNumber', () => {
  it('int32: integers that fit become Int32, others Double', () => {
    expect(newNumber(12)).toEqual({ type: 'int', value: 12 });
    expect(newNumber(2147483647, 'int32')).toEqual({ type: 'int', value: 2147483647 });
    expect(newNumber(-2147483648, 'int32')).toEqual({ type: 'int', value: -2147483648 });
    expect(newNumber(2147483648, 'int32')).toEqual({ type: 'double', value: 2147483648 });
    expect(newNumber(1.5, 'int32')).toEqual({ type: 'double', value: 1.5 });
  });

  it('int64: integers that fit 32 bits and safe larger ones become Int64', () => {
    expect(newNumber(12, 'int64')).toEqual({ type: 'long', value: 12n });
    expect(newNumber(-2147483649, 'int64')).toEqual({ type: 'long', value: -2147483649n });
    expect(newNumber(Number.MAX_SAFE_INTEGER, 'int64')).toEqual({
      type: 'long',
      value: 9007199254740991n,
    });
    // Not exact any more: a Double.
    expect(newNumber(2 ** 53, 'int64')).toEqual({ type: 'double', value: 2 ** 53 });
    expect(newNumber(0.5, 'int64')).toEqual({ type: 'double', value: 0.5 });
  });

  it('double: every number becomes a Double', () => {
    expect(newNumber(12, 'double')).toEqual({ type: 'double', value: 12 });
    expect(newNumber(2 ** 40, 'double')).toEqual({ type: 'double', value: 2 ** 40 });
  });

  it('-0, NaN and infinities are Doubles whatever the setting', () => {
    for (const setting of ['int32', 'int64', 'double'] as const) {
      expect(Object.is((newNumber(-0, setting) as { value: number }).value, -0)).toBe(true);
      expect(newNumber(-0, setting).type).toBe('double');
      expect(newNumber(NaN, setting).type).toBe('double');
      expect(newNumber(Infinity, setting)).toEqual({ type: 'double', value: Infinity });
    }
  });
});
