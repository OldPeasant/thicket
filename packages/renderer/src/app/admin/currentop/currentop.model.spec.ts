import { describe, expect, it } from 'vitest';

import {
  currentOpCall,
  durationLevel,
  durationShare,
  EMPTY_FILTER,
  ejsonNumber,
  formatDuration,
  toOpEntry,
} from './currentop.model';

describe('ejsonNumber', () => {
  it('reads plain JSON numbers and canonical EJSON Int32, Int64 and Double', () => {
    expect(ejsonNumber(7)).toBe(7);
    expect(ejsonNumber({ $numberInt: '42' })).toBe(42);
    expect(ejsonNumber({ $numberLong: '9000000' })).toBe(9_000_000);
    expect(ejsonNumber({ $numberDouble: '1.5' })).toBe(1.5);
  });

  it('is null for anything that is not a finite number', () => {
    expect(ejsonNumber(null)).toBeNull();
    expect(ejsonNumber(undefined)).toBeNull();
    expect(ejsonNumber('42')).toBeNull();
    expect(ejsonNumber({})).toBeNull();
    expect(ejsonNumber({ $numberInt: 42 })).toBeNull();
    expect(ejsonNumber({ $numberDouble: 'NaN' })).toBeNull();
    expect(ejsonNumber({ $numberDouble: 'Infinity' })).toBeNull();
    expect(ejsonNumber({ $numberLong: 'abc' })).toBeNull();
  });
});

describe('toOpEntry', () => {
  it('reduces an active operation to what the tab shows', () => {
    const entry = toOpEntry(
      JSON.stringify({
        opid: { $numberInt: '42' },
        op: 'query',
        ns: 'shop.orders',
        active: true,
        microsecs_running: { $numberLong: '2500000' },
        secs_running: { $numberLong: '2' },
        client: '10.0.0.5:51234',
        appName: 'reporter',
        desc: 'conn12',
        effectiveUsers: [{ user: 'alice', db: 'admin' }],
        users: [{ user: 'other', db: 'shop' }],
        command: { find: 'orders', filter: { qty: { $gt: 5 } } },
        planSummary: 'COLLSCAN',
        waitingForLock: true,
      }),
    );
    expect(entry).toEqual({
      opId: '{"$numberInt":"42"}',
      opIdLabel: '42',
      op: 'query',
      ns: 'shop.orders',
      active: true,
      secs: 2.5,
      client: '10.0.0.5:51234',
      appName: 'reporter',
      desc: 'conn12',
      users: ['alice@admin'],
      command: entry.command,
      planSummary: 'COLLSCAN',
      waitingForLock: true,
    });
    expect(entry.command).toContain('find');
    expect(entry.command).toContain('$gt');
    expect(entry.command).not.toContain('\n');
  });

  it('keeps the opId as canonical EJSON text that admin.killOp takes', () => {
    expect(toOpEntry('{"opid":{"$numberLong":"9007199254740993"}}').opId).toBe(
      '{"$numberLong":"9007199254740993"}',
    );
    expect(toOpEntry('{"opid":{"$numberInt":"5"}}').opId).toBe('{"$numberInt":"5"}');
  });

  it('labels a mongos shard:opid string as it is and keeps it killable', () => {
    const entry = toOpEntry('{"opid":"shard01:123","active":true}');
    expect(entry.opIdLabel).toBe('shard01:123');
    expect(entry.opId).toBe('"shard01:123"');
  });

  it('has no opId when the server reports none', () => {
    expect(toOpEntry('{"op":"none"}')).toMatchObject({ opId: null, opIdLabel: '' });
    expect(toOpEntry('{"opid":null}')).toMatchObject({ opId: null, opIdLabel: '' });
  });

  it('falls back to secs_running when microsecs_running is missing', () => {
    expect(toOpEntry('{"active":true,"secs_running":{"$numberLong":"12"}}').secs).toBe(12);
    expect(toOpEntry('{"active":true}').secs).toBeNull();
  });

  it('has no running time for an idle (inactive) connection', () => {
    const entry = toOpEntry(
      '{"opid":{"$numberInt":"7"},"active":false,"microsecs_running":{"$numberLong":"9000000"}}',
    );
    expect(entry.active).toBe(false);
    expect(entry.secs).toBeNull();
  });

  it('only treats a literal true as active or waiting for a lock', () => {
    const entry = toOpEntry('{"active":"true","waitingForLock":1}');
    expect(entry.active).toBe(false);
    expect(entry.waitingForLock).toBe(false);
  });

  it('uses client_s (mongos) when client is missing', () => {
    expect(toOpEntry('{"client_s":"10.0.0.9:4000"}').client).toBe('10.0.0.9:4000');
    expect(toOpEntry('{"client":"a:1","client_s":"b:2"}').client).toBe('a:1');
  });

  it('falls back to users when there are no effectiveUsers and drops empty ones', () => {
    expect(
      toOpEntry(
        JSON.stringify({
          effectiveUsers: [],
          users: [{ user: 'bob', db: 'shop' }, {}, 'junk', null, { user: 'carol' }],
        }),
      ).users,
    ).toEqual(['bob@shop', 'carol@']);
    expect(toOpEntry('{"users":"bob"}').users).toEqual([]);
  });

  it('has no command text without a command document', () => {
    expect(toOpEntry('{}').command).toBe('');
    expect(toOpEntry('{"command":"find"}').command).toBe('');
    expect(toOpEntry('{"command":[1,2]}').command).toBe('');
  });

  it('has no command text when the command is not valid canonical EJSON', () => {
    const entry = toOpEntry(
      JSON.stringify({ opid: { $numberInt: '3' }, command: { find: { $numberInt: 'x' } } }),
    );
    expect(entry.command).toBe('');
    expect(entry.opIdLabel).toBe('3');
  });

  it('cuts a long command after 400 characters with an ellipsis', () => {
    const command = toOpEntry(
      JSON.stringify({ command: { insert: 'orders', note: 'x'.repeat(1000) } }),
    ).command;
    expect(command).toHaveLength(400);
    expect(command.endsWith('…')).toBe(true);
  });

  it('does not throw on non-string fields or a document that is not an object', () => {
    expect(toOpEntry('{"op":5,"ns":["a"],"appName":{},"desc":null}')).toMatchObject({
      op: '',
      ns: '',
      appName: '',
      desc: '',
    });
    for (const text of ['[]', 'null', '42', '"text"']) {
      expect(toOpEntry(text)).toMatchObject({ opId: null, active: false, secs: null, users: [] });
    }
  });
});

describe('formatDuration', () => {
  it('shows idle for no running time', () => {
    expect(formatDuration(null)).toBe('idle');
  });

  it('shows milliseconds below one second', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(0.0015)).toBe('2 ms');
    expect(formatDuration(0.85)).toBe('850 ms');
  });

  it('shows seconds with one decimal from 1 s to below a minute', () => {
    expect(formatDuration(1)).toBe('1.0 s');
    expect(formatDuration(12.44)).toBe('12.4 s');
    expect(formatDuration(59.9)).toBe('59.9 s');
  });

  it('shows minutes and zero-padded seconds from one minute to below an hour', () => {
    expect(formatDuration(60)).toBe('1 min 00 s');
    expect(formatDuration(185.7)).toBe('3 min 05 s');
    expect(formatDuration(3599.9)).toBe('59 min 59 s');
  });

  it('shows hours and zero-padded minutes from one hour', () => {
    expect(formatDuration(3600)).toBe('1 h 00 min');
    expect(formatDuration(2 * 3600 + 7 * 60 + 59)).toBe('2 h 07 min');
    expect(formatDuration(30 * 3600)).toBe('30 h 00 min');
  });
});

describe('durationLevel', () => {
  it('is idle, ok below 10 s, slow from 10 s and long from 60 s', () => {
    expect(durationLevel(null)).toBe('idle');
    expect(durationLevel(0)).toBe('ok');
    expect(durationLevel(9.99)).toBe('ok');
    expect(durationLevel(10)).toBe('slow');
    expect(durationLevel(59.99)).toBe('slow');
    expect(durationLevel(60)).toBe('long');
    expect(durationLevel(7200)).toBe('long');
  });
});

describe('durationShare', () => {
  it('is 0 for idle, zero or negative running times and without a longest one', () => {
    expect(durationShare(null, 60)).toBe(0);
    expect(durationShare(0, 60)).toBe(0);
    expect(durationShare(-1, 60)).toBe(0);
    expect(durationShare(5, 0)).toBe(0);
    expect(durationShare(5, -3)).toBe(0);
  });

  it('is 100 for the longest operation', () => {
    expect(durationShare(75, 75)).toBe(100);
  });

  it('uses a log scale so a short operation still shows next to a long one', () => {
    const short = durationShare(2, 7200);
    expect(short).toBe(Math.round((Math.log1p(2) / Math.log1p(7200)) * 100));
    expect(short).toBeGreaterThan(10);
    expect(durationShare(60, 7200)).toBeGreaterThan(short);
  });

  it('is at least 2 for a running operation and never above 100', () => {
    expect(durationShare(0.0001, 7200)).toBe(2);
    expect(durationShare(9000, 7200)).toBe(100);
  });
});

describe('currentOpCall', () => {
  it('is a plain db.currentOp() without filters', () => {
    expect(currentOpCall(EMPTY_FILTER)).toBe('db.currentOp()');
    expect(currentOpCall({ ns: '  ', minSecs: 0, opType: ' ', all: false })).toBe('db.currentOp()');
  });

  it('writes every filter in the order $all, ns, secs_running, op', () => {
    expect(currentOpCall({ ns: 'shop.orders', minSecs: 3, opType: 'query', all: true })).toBe(
      'db.currentOp({ $all: true, ns: /^shop\\.orders(\\.|$)/, secs_running: { $gte: 3 }, op: "query" })',
    );
  });

  it('writes a single filter on its own', () => {
    expect(currentOpCall({ ...EMPTY_FILTER, minSecs: 10 })).toBe(
      'db.currentOp({ secs_running: { $gte: 10 } })',
    );
    expect(currentOpCall({ ...EMPTY_FILTER, opType: ' insert ' })).toBe(
      'db.currentOp({ op: "insert" })',
    );
    expect(currentOpCall({ ...EMPTY_FILTER, all: true })).toBe('db.currentOp({ $all: true })');
  });

  it('escapes regex characters and slashes in the namespace so the literal stays valid', () => {
    const call = currentOpCall({ ...EMPTY_FILTER, ns: ' a+b/c ' });
    expect(call).toBe('db.currentOp({ ns: /^a\\+b\\/c(\\.|$)/ })');
    const literal = /ns: \/(.*)\/ \}\)$/.exec(call)?.[1] ?? '';
    const regex = new RegExp(literal);
    expect(regex.test('a+b/c')).toBe(true);
    expect(regex.test('a+b/c.items')).toBe(true);
    expect(regex.test('aab/c')).toBe(false);
  });

  it('matches the namespace prefix on name boundaries only', () => {
    const literal = /ns: \/(.*)\/ \}\)$/.exec(currentOpCall({ ...EMPTY_FILTER, ns: 'shop' }))?.[1];
    const regex = new RegExp(literal ?? '');
    expect(['shop', 'shop.orders'].map((ns) => regex.test(ns))).toEqual([true, true]);
    expect(['shopping.x', 'myshop.a'].map((ns) => regex.test(ns))).toEqual([false, false]);
  });
});
