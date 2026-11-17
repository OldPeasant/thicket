import { describe, expect, it } from 'vitest';

import { bucketCall, formatBytes, formatDate, fraction, gridfsTabId } from './gridfs.model';

describe('gridfsTabId', () => {
  it('is stable per profile and database', () => {
    expect(gridfsTabId('p1', 'shop')).toBe('gridfs:p1:shop');
    expect(gridfsTabId('p1', 'shop')).toBe(gridfsTabId('p1', 'shop'));
    expect(gridfsTabId('p1', 'other')).not.toBe(gridfsTabId('p1', 'shop'));
    expect(gridfsTabId('p2', 'shop')).not.toBe(gridfsTabId('p1', 'shop'));
  });
});

describe('formatBytes', () => {
  it('shows bytes below 1 KB as whole bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches unit exactly at 1024 and drops a trailing ".0"', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });

  it('keeps one decimal below 10 and none from 10 on', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(9.94 * 1024)).toBe('9.9 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(600 * 1024)).toBe('600 KB');
  });

  it('stays in TB above the largest unit', () => {
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('shows negative counts as 0 B', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('fraction', () => {
  it('is bytes / total, clamped to 0…1', () => {
    expect(fraction(0, 100)).toBe(0);
    expect(fraction(25, 100)).toBe(0.25);
    expect(fraction(100, 100)).toBe(1);
    expect(fraction(150, 100)).toBe(1);
    expect(fraction(-10, 100)).toBe(0);
  });

  it('an empty (or unknown-size) file counts as complete', () => {
    expect(fraction(0, 0)).toBe(1);
    expect(fraction(5, -1)).toBe(1);
  });
});

describe('bucketCall', () => {
  it('shows the mongosh call that lists the bucket, with the name as a string literal', () => {
    expect(bucketCall('fs')).toBe('db.getGridFSBucket({ bucketName: "fs" }).find()');
    expect(bucketCall('we"ird\\b')).toBe(
      'db.getGridFSBucket({ bucketName: "we\\"ird\\\\b" }).find()',
    );
  });
});

describe('formatDate', () => {
  it('shows a valid ISO date as local date and time with zero padding', () => {
    expect(formatDate(new Date(2026, 10, 17, 7, 31, 59).toISOString())).toBe('2026-11-17 07:31');
    expect(formatDate(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04');
  });

  it('keeps empty text empty and shows unparseable text as it came', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('sometime')).toBe('sometime');
  });
});
