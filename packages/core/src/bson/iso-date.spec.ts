import { describe, expect, it } from 'vitest';

import { formatIsoDate, parseIsoDate } from './iso-date';

describe('parseIsoDate', () => {
  it.each([
    ['1970-01-01T00:00:00Z', 0n],
    ['1970-01-01', 0n],
    ['1970-01-01T00:00Z', 0n],
    ['1970-01-01T01:00:00+01:00', 0n],
    ['1969-12-31T19:00:00-0500', 0n],
    ['1970-01-01T00:00:00.1Z', 100n],
    ['1970-01-01T00:00:00.123456Z', 123n],
    ['0001-01-01T00:00:00Z', -62135596800000n],
    ['2024-02-29T00:00:00Z', 1709164800000n],
  ])('%s → %s', (text, ms) => {
    expect(parseIsoDate(text)).toBe(ms);
  });

  it.each([
    'yesterday',
    '2023-02-29T00:00:00Z',
    '2024-13-01',
    '2024-01-01T24:00:00Z',
    '2024-01-01T00:60:00Z',
    '2024-01-01T00:00:60Z',
    '2024-01-01T00:00:00+24:00',
    '2024-01-01T00:00:00+01:60',
    '2024-01-01T00:00:00',
  ])('rejects %s', (text) => {
    expect(() => parseIsoDate(text)).toThrow();
  });
});

describe('formatIsoDate', () => {
  it('formats UTC and rejects dates JS cannot represent', () => {
    expect(formatIsoDate(0n)).toBe('1970-01-01T00:00:00.000Z');
    expect(formatIsoDate(8_640_000_000_000_000n)).toBe('+275760-09-13T00:00:00.000Z');
    expect(() => formatIsoDate(8_640_000_000_000_001n)).toThrow('outside');
    expect(() => formatIsoDate(-8_640_000_000_000_001n)).toThrow('outside');
  });
});
