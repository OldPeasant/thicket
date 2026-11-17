import { describe, expect, it } from 'vitest';

import replSetStatus from './fixtures/repl-set-status-8.2.json';
import status1 from './fixtures/server-status-1-8.2.json';
import status2 from './fixtures/server-status-2-8.2.json';
import statusRs from './fixtures/server-status-rs-8.2.json';
import {
  addSample,
  EMPTY_HISTORY,
  ejsonDate,
  ejsonNumber,
  formatBytes,
  formatCount,
  formatLag,
  formatUptime,
  linePath,
  memberLevel,
  niceMax,
  parseReplSet,
  parseStatus,
  pointBetween,
  type StatusSample,
  totalOps,
} from './server-stats.model';

const sample = (doc: unknown): StatusSample => {
  const parsed = parseStatus(JSON.stringify(doc));
  if (parsed === null) throw new Error('not a sample');
  return parsed;
};

describe('ejsonNumber / ejsonDate', () => {
  it('reads canonical and relaxed numbers', () => {
    expect(ejsonNumber({ $numberInt: '3' })).toBe(3);
    expect(ejsonNumber({ $numberLong: '9007199254740993' })).toBe(9007199254740992);
    expect(ejsonNumber({ $numberDouble: '1.5' })).toBe(1.5);
    expect(ejsonNumber({ $numberDouble: 'NaN' })).toBeNull();
    expect(ejsonNumber({ $numberDecimal: '2.25' })).toBe(2.25);
    expect(ejsonNumber(7)).toBe(7);
    expect(ejsonNumber('7')).toBeNull();
    expect(ejsonNumber(null)).toBeNull();
  });

  it('reads canonical and relaxed dates', () => {
    expect(ejsonDate({ $date: { $numberLong: '1000' } })).toBe(1000);
    expect(ejsonDate({ $date: '1970-01-01T00:00:01Z' })).toBe(1000);
    expect(ejsonDate({ $date: 'soon' })).toBeNull();
    expect(ejsonDate(5)).toBeNull();
  });
});

describe('parseStatus', () => {
  it('reduces the recorded standalone serverStatus', () => {
    expect(sample(status1)).toEqual({
      at: 1794897898932,
      uptimeMs: 20573,
      host: 'e64ac6ac4426',
      version: '8.2.12',
      process: 'mongod',
      storageEngine: 'wiredTiger',
      opcounters: { insert: 100, query: 0, update: 0, delete: 0, getmore: 0, command: 8 },
      connections: { current: 2, available: 209713, active: 1 },
      mem: { resident: 217, virtual: 3693 },
      network: { bytesIn: 4383, bytesOut: 1361 },
      setName: null,
      primary: null,
    });
  });

  it('reads the replica set name and role', () => {
    const s = sample(statusRs);
    expect(s.setName).toBe('rs0');
    expect(s.primary).toBe(true);
  });

  it('falls back to uptime seconds and the receive time; missing sections are zeros', () => {
    expect(parseStatus('{"uptime":{"$numberDouble":"3.0"}}', 42)).toMatchObject({
      at: 42,
      uptimeMs: 3000,
      opcounters: { insert: 0, command: 0 },
      connections: { current: 0, available: 0, active: null },
      mem: { resident: null, virtual: null },
    });
  });

  it('is null for text that is not a document', () => {
    expect(parseStatus('not json')).toBeNull();
    expect(parseStatus('[1]')).toBeNull();
    expect(parseStatus('null')).toBeNull();
  });
});

describe('pointBetween / addSample', () => {
  it('turns the counters of two recorded samples into per-second rates', () => {
    const point = pointBetween(sample(status1), sample(status2));
    expect(point).not.toBeNull();
    const secs = (22607 - 20573) / 1000;
    expect(point?.ops.insert).toBeCloseTo(40 / secs);
    expect(point?.ops.query).toBeCloseTo(40 / secs);
    expect(point?.ops.update).toBeCloseTo(10 / secs);
    expect(point?.ops.delete).toBeCloseTo(4 / secs);
    expect(point?.ops.getmore).toBe(0);
    expect(point?.bytesIn).toBeCloseTo((19136 - 4383) / secs);
    expect(point?.connections).toBe(2);
    expect(point?.resident).toBe(217);
    expect(point && totalOps(point)).toBeCloseTo(96 / secs);
  });

  it('is null when no time passed or the counters went back', () => {
    expect(pointBetween(sample(status1), sample(status1))).toBeNull();
    expect(pointBetween(sample(status2), sample(status1))).toBeNull();
  });

  it('collects points, keeps at most `size` and starts over on restart or another host', () => {
    const a = sample(status1);
    const b = sample(status2);
    let h = addSample(EMPTY_HISTORY, a);
    expect(h.points).toHaveLength(0);
    h = addSample(h, b);
    expect(h.points).toHaveLength(1);
    expect(addSample(h, b)).toBe(h);
    const later = { ...b, uptimeMs: b.uptimeMs + 1000, at: b.at + 1000 };
    const evenLater = { ...b, uptimeMs: b.uptimeMs + 2000, at: b.at + 2000 };
    const capped = addSample(addSample(h, later, 2), evenLater, 2);
    expect(capped.points.map((p) => p.at)).toEqual([later.at, evenLater.at]);
    expect(addSample(h, a).points).toHaveLength(0);
    expect(addSample(h, { ...later, host: 'other' }).points).toHaveLength(0);
  });
});

describe('parseReplSet / memberLevel', () => {
  it('reads the recorded one-member replica set', () => {
    const view = parseReplSet(JSON.stringify(replSetStatus));
    expect(view?.set).toBe('rs0');
    expect(view?.members).toEqual([
      expect.objectContaining({
        id: 0,
        name: 'localhost:27017',
        state: 'PRIMARY',
        healthy: true,
        self: true,
        optime: 1794897901000,
        lagSecs: null,
      }),
    ]);
    const [primary] = view?.members ?? [];
    expect(primary && memberLevel(primary)).toBe('good');
  });

  it('computes the lag behind the primary', () => {
    const view = parseReplSet(
      JSON.stringify({
        set: 's',
        members: [
          {
            _id: 0,
            stateStr: 'SECONDARY',
            health: 1,
            optimeDate: { $date: '2026-01-01T00:00:00Z' },
          },
          { _id: 1, stateStr: 'PRIMARY', health: 1, optimeDate: { $date: '2026-01-01T00:00:05Z' } },
          { _id: 2, stateStr: 'SECONDARY', health: 1 },
        ],
      }),
    );
    expect(view?.members.map((m) => m.lagSecs)).toEqual([5, null, null]);
  });

  it('is null without members', () => {
    expect(parseReplSet('{"ok":1}')).toBeNull();
    expect(parseReplSet('oops')).toBeNull();
  });

  it('rates members by health, state and lag', () => {
    const base = {
      id: 0,
      name: 'm',
      self: false,
      uptimeSecs: 1,
      optime: 0,
      pingMs: 1,
      syncSource: '',
      message: '',
    };
    expect(memberLevel({ ...base, state: 'SECONDARY', healthy: true, lagSecs: 2 })).toBe('good');
    expect(memberLevel({ ...base, state: 'SECONDARY', healthy: true, lagSecs: 10 })).toBe('warn');
    expect(memberLevel({ ...base, state: 'RECOVERING', healthy: true, lagSecs: null })).toBe(
      'warn',
    );
    expect(memberLevel({ ...base, state: 'ROLLBACK', healthy: true, lagSecs: null })).toBe('bad');
    expect(memberLevel({ ...base, state: 'PRIMARY', healthy: false, lagSecs: null })).toBe('bad');
  });
});

describe('formatting', () => {
  it('formats bytes, counts, uptimes and lags', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(null)).toBe('–');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(0.5)).toBe('0.5');
    expect(formatCount(19.66)).toBe('19.7');
    expect(formatCount(1234)).toBe('1234');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(3_400_000)).toBe('3.4M');
    expect(formatCount(2e9)).toBe('2G');
    expect(formatCount(null)).toBe('–');
    expect(formatUptime(12_000)).toBe('12 s');
    expect(formatUptime(250_000)).toBe('4 min 10 s');
    expect(formatUptime(7_500_000)).toBe('2 h 5 min');
    expect(formatUptime(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h');
    expect(formatUptime(-1)).toBe('–');
    expect(formatLag(42.4)).toBe('42 s');
    expect(formatLag(null)).toBe('–');
  });
});

describe('chart geometry', () => {
  it('rounds the axis maximum up to 1, 2, 2.5 or 5 × 10ⁿ', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.3, 0.1)).toBe(0.5);
    expect(niceMax(19.7)).toBe(20);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(217)).toBe(250);
    expect(niceMax(600)).toBe(1000);
  });

  it('draws a line right-aligned in the slots, breaking at gaps', () => {
    expect(linePath([], 100, 10, 1)).toBe('');
    expect(linePath([0, 10], 100, 10, 10)).toBe('M0 10L100 0');
    expect(linePath([5, 10], 100, 10, 10, 3)).toBe('M50 5L100 0');
    expect(linePath([5, null, 10], 100, 10, 10)).toBe('M0 5M100 0');
    expect(linePath([20], 100, 10, 10, 1)).toBe('M0 0');
  });
});
