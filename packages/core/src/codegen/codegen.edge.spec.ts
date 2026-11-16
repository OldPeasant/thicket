import * as bson from 'bson';
import { describe, expect, it } from 'vitest';
import { stringifyEJson } from '../bson/ejson';
import type { BsonDocument, BsonValue } from '../bson/model';
import { parseShellSyntax, parseShellSyntaxDocument } from '../shellsyntax';
import {
  CODEGEN_LANGUAGES,
  CodegenError,
  DEFAULT_URI,
  generateCode,
  type CodegenLanguage,
  type CodegenQuery,
  type FindQuery,
} from './index';
import { chain, concat, flat, layout, list, WIDTH } from './layout';
import { CODEGEN_SAMPLES } from './samples';

const d = (text: string): BsonDocument => parseShellSyntaxDocument(text);
const find = (filter: BsonDocument, extra: Partial<FindQuery> = {}): FindQuery => ({
  kind: 'find',
  database: 'demo',
  collection: 'items',
  filter,
  ...extra,
});
const fields = (...pairs: [string, BsonValue][]): BsonDocument => ({
  type: 'object',
  fields: pairs.map(([key, value]) => ({ key, value })),
});
const int = (value: number): BsonValue => ({ type: 'int', value });
const date = (ms: bigint): BsonDocument => fields(['at', { type: 'date', ms }]);
const ts = (t: number, i: number): BsonDocument => fields(['op', { type: 'timestamp', t, i }]);

/** The calls a generated Node program makes, captured with a fake `MongoClient`. */
interface NodeCalls {
  uri?: string;
  database?: string;
  collection?: string;
  method?: 'find' | 'aggregate';
  args: unknown[];
}

/**
 * Runs a generated Node program with the real `bson` exports and a fake `MongoClient`, and
 * returns what it passed to the driver. No server and no network.
 */
function runNode(code: string): Promise<NodeCalls> {
  return new Promise((resolve, reject) => {
    const calls: NodeCalls = { args: [] };
    const empty = (): AsyncIterable<never> => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined as never }),
      }),
    });
    class MongoClient {
      constructor(uri: string) {
        calls.uri = uri;
      }
      db(name: string) {
        calls.database = name;
        return {
          collection: (c: string) => {
            calls.collection = c;
            return {
              find: (...args: unknown[]) => {
                calls.method = 'find';
                calls.args = args;
                return empty();
              },
              aggregate: (...args: unknown[]) => {
                calls.method = 'aggregate';
                calls.args = args;
                return empty();
              },
            };
          },
        };
      }
      close(): Promise<void> {
        // Resolve after the program's own `catch` had a chance to report an error.
        setTimeout(() => resolve(calls), 0);
        return Promise.resolve();
      }
    }
    const fakeRequire = (name: string): unknown => {
      if (name !== 'mongodb') throw new Error(`unexpected require(${name})`);
      return { ...bson, MongoClient };
    };
    const fakeConsole = { log: () => undefined, error: (e: unknown) => reject(e) };
    const fakeProcess = { exitCode: 0 };
    const program = new Function('require', 'console', 'process', code) as (
      r: unknown,
      c: unknown,
      p: unknown,
    ) => void;
    try {
      program(fakeRequire, fakeConsole, fakeProcess);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Model → driver values through canonical EJSON (lossless), then the BSON bytes. */
const toDriver = (value: BsonValue): unknown =>
  bson.EJSON.parse(stringifyEJson(value), { relaxed: false });
const bytes = (value: unknown): string =>
  Array.from(bson.serialize({ v: value } as bson.Document), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** The arguments the Node driver should receive for `query`. */
function expectedNodeArgs(query: CodegenQuery): unknown[] {
  if (query.kind === 'aggregate') return [query.pipeline.map(toDriver)];
  const opts: Record<string, unknown> = {};
  const add = (name: string, x: BsonDocument | undefined) => {
    if (x && x.fields.length > 0) opts[name] = toDriver(x);
  };
  add('projection', query.projection);
  add('sort', query.sort);
  add('collation', query.collation);
  if (query.skip) opts.skip = query.skip;
  if (query.limit) opts.limit = query.limit;
  return Object.keys(opts).length > 0 ? [toDriver(query.filter), opts] : [toDriver(query.filter)];
}

describe('layout', () => {
  it('keeps a group on one line when it fits exactly into WIDTH columns', () => {
    const fits = list('[', ['a'.repeat(WIDTH - 4)], ']', true);
    expect(flat(fits)).toHaveLength(WIDTH);
    expect(layout(fits, '', '  ')).toBe(`[ ${'a'.repeat(WIDTH - 4)} ]`);
  });

  it('breaks a group one column over WIDTH into one item per line', () => {
    const over = list('[', ['a'.repeat(WIDTH - 6), 'b'], ']', true);
    expect(flat(over)).toHaveLength(WIDTH + 1);
    expect(layout(over, '', '  ')).toBe(`[\n  ${'a'.repeat(WIDTH - 6)},\n  b\n]`);
  });

  it('counts the trailing text and the start column', () => {
    const node = list('(', ['x'.repeat(WIDTH - 2)], ')');
    expect(layout(node, '', '  ')).not.toContain('\n');
    expect(layout(node, '', '  ', 0, 1)).toContain('\n');
    expect(layout(node, '', '  ', 1)).toContain('\n');
  });

  it('breaks only the outer group when the inner one fits on its own line', () => {
    const inner = list('{', ['k: 1', 'm: 2'], '}', true);
    const outer = list('[', [inner, 'z'.repeat(WIDTH)], ']');
    expect(layout(outer, '', '  ')).toBe(`[\n  { k: 1, m: 2 },\n  ${'z'.repeat(WIDTH)}\n]`);
  });

  it('never breaks empty lists or plain strings', () => {
    expect(layout(list('{', [], '}', true), '', '  ', WIDTH + 10)).toBe('{}');
    expect(layout('s'.repeat(WIDTH * 2), '', '  ')).toBe('s'.repeat(WIDTH * 2));
  });

  it('puts every chain tail on its own indented line when the chain is too long', () => {
    const c = chain('new Document("a", 1)', [
      `.append("b", "${'b'.repeat(40)}")`,
      `.append("c", "${'c'.repeat(40)}")`,
    ]);
    expect(layout(c, '    ', '    ')).toBe(
      `new Document("a", 1)\n        .append("b", "${'b'.repeat(40)}")\n        .append("c", "${'c'.repeat(40)}")`,
    );
    expect(chain('head', [])).toBe('head');
  });

  it('does not let text after a group push the line past WIDTH', () => {
    const node = concat(list('(', ['a'.repeat(WIDTH - 2)], ')'), ';');
    for (const line of layout(node, '', '  ').split('\n')) {
      expect(line.length).toBeLessThanOrEqual(WIDTH);
    }
  });

  it('counts later parts up to their first break, and the outer trailing text', () => {
    const group = list('(', ['a'.repeat(WIDTH - 4)], ')');
    // `group` + `.x(` (up to where the next list can break) is one column too wide.
    expect(layout(concat(group, '.x', list('(', ['b'], ')')), '', '  ').split('\n')[0]).toBe('(');
    // Only `.(` must fit when the next list breaks: the group stays on one line.
    const fits = layout(concat(group, '.', list('(', ['b'.repeat(WIDTH)], ')')), '', '  ');
    expect(fits.split('\n')[0]).toBe(`${flat(group)}.(`);
    // With nothing breakable after the group, the outer trailing text counts too.
    expect(layout(concat(group, '..'), '', '  ', 0, 1)).toContain('\n');
    expect(layout(concat(group, '.'), '', '  ', 0, 1)).not.toContain('\n');
  });

  it('counts an empty list after a group as unbreakable text', () => {
    const group = list('(', ['a'.repeat(WIDTH - 4)], ')'); // flat: WIDTH - 2 columns
    const empty = list('[', [], ']');
    // `group[]` is exactly WIDTH: one line.
    expect(layout(concat(group, empty), '', '  ')).toBe(`${flat(group)}[]`);
    // `group[];` is one column over, and `[]` can't break, so the group must.
    expect(layout(concat(group, empty, ';'), '', '  ').split('\n')[0]).toBe('(');
  });

  it('generated find statements stay within WIDTH when `;` or `)` follows the group (TW-1)', () => {
    // Before the fix, these lengths gave 81-column lines: node 41, shell 18, java 37.
    for (const language of CODEGEN_LANGUAGES) {
      for (let n = 1; n <= 45; n++) {
        const code = generateCode(
          find(fields(['a', { type: 'string', value: 'v'.repeat(n) }])),
          language,
        );
        const lines = code.split('\n').filter((line) => line.includes('"v'));
        expect(lines.length, `${language} n=${n}`).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.length, `${language} n=${n}: ${line}`).toBeLessThanOrEqual(WIDTH);
        }
      }
    }
  });

  it('continues a concat after a broken part at the column of its last line', () => {
    const node = concat(list('(', ['a'.repeat(WIDTH)], ')'), '.next()');
    expect(layout(node, '', '  ')).toBe(`(\n  ${'a'.repeat(WIDTH)}\n).next()`);
  });
});

describe('duplicate keys', () => {
  const dup = fields(['a', int(1)], ['a', int(2)]);

  it('Python writes a document with a repeated key as a dict literal, nested too', () => {
    // A dict (and SON, a dict subclass) keeps one value per key, so there is no SON case.
    const top = generateCode(find(dup), 'python');
    expect(top).toContain('cursor = coll.find({"a": 1, "a": 2})');
    expect(top).toMatch(/^from bson import json_util$/m);
    expect(top).not.toContain('SON');

    const nested = generateCode(find(fields(['x', dup], ['y', int(3)])), 'python');
    expect(nested).toContain('{"x": {"a": 1, "a": 2}, "y": 3}');

    const pipeline = generateCode(
      {
        kind: 'aggregate',
        database: 'demo',
        collection: 'items',
        pipeline: [fields(['$match', dup])],
      },
      'python',
    );
    expect(pipeline).toContain('[{"$match": {"a": 1, "a": 2}}]');
  });

  it('Python uses a plain dict (and no SON import) when the keys are unique', () => {
    const code = generateCode(find(fields(['a', int(1)], ['b', int(2)])), 'python');
    expect(code).toContain('coll.find({"a": 1, "b": 2})');
    expect(code).not.toContain('SON');
  });

  it('shell, Node and Java keep both fields in order', () => {
    expect(generateCode(find(dup), 'shell')).toContain('.find({ a: 1, a: 2 });');
    expect(generateCode(find(dup), 'node')).toContain('coll.find({ a: 1, a: 2 });');
    expect(generateCode(find(dup), 'java')).toContain(
      'coll.find(new Document("a", 1).append("a", 2))',
    );
  });
});

describe('dates outside the JS and Python ranges', () => {
  const JS_MAX = 8_640_000_000_000_000n;
  const PY_MIN = -62_135_596_800_000n; // 0001-01-01T00:00:00Z
  const PY_MAX = 253_402_300_799_999n; // 9999-12-31T23:59:59.999Z

  it('Node writes the JS Date limits as ISO strings and beyond them NaN with the value', () => {
    expect(generateCode(find(date(JS_MAX)), 'node')).toContain(
      'new Date("+275760-09-13T00:00:00.000Z")',
    );
    expect(generateCode(find(date(-JS_MAX)), 'node')).toContain(
      'new Date("-271821-04-20T00:00:00.000Z")',
    );
    expect(generateCode(find(date(JS_MAX + 1n)), 'node')).toContain(
      `new Date(NaN /* ${JS_MAX + 1n} ms is outside the JS Date range */)`,
    );
    expect(generateCode(find(date(-JS_MAX - 1n)), 'node')).toContain(
      `new Date(NaN /* ${-JS_MAX - 1n} ms is outside the JS Date range */)`,
    );
  });

  it('Python writes datetime for years 1..9999 and DatetimeMS outside', () => {
    const min = generateCode(find(date(PY_MIN)), 'python');
    expect(min).toContain('datetime(1, 1, 1, tzinfo=timezone.utc)');
    expect(min).toContain('from datetime import datetime, timezone');
    expect(generateCode(find(date(PY_MAX)), 'python')).toContain(
      'datetime(9999, 12, 31, 23, 59, 59, 999000, tzinfo=timezone.utc)',
    );

    const below = generateCode(find(date(PY_MIN - 1n)), 'python');
    expect(below).toContain(`DatetimeMS(${PY_MIN - 1n})`);
    expect(below).toMatch(/^from bson import DatetimeMS, json_util$/m);
    expect(below).not.toContain('from datetime');
    expect(generateCode(find(date(PY_MAX + 1n)), 'python')).toContain(`DatetimeMS(${PY_MAX + 1n})`);
    expect(generateCode(find(date(JS_MAX + 1n)), 'python')).toContain(`DatetimeMS(${JS_MAX + 1n})`);
  });

  it('Python leaves out trailing zero time parts and keeps milliseconds as microseconds', () => {
    expect(generateCode(find(d('{ at: ISODate("2024-01-02T00:00:00Z") }')), 'python')).toContain(
      'datetime(2024, 1, 2, tzinfo=timezone.utc)',
    );
    expect(
      generateCode(find(d('{ at: ISODate("2024-01-02T00:00:00.007Z") }')), 'python'),
    ).toContain('datetime(2024, 1, 2, 0, 0, 0, 7000, tzinfo=timezone.utc)');
    expect(
      generateCode(find(d('{ at: ISODate("1969-12-31T23:59:59.999Z") }')), 'python'),
    ).toContain('datetime(1969, 12, 31, 23, 59, 59, 999000, tzinfo=timezone.utc)');
  });

  it('Java uses Instant.parse for 4-digit years and the milliseconds otherwise', () => {
    expect(generateCode(find(date(PY_MAX)), 'java')).toContain(
      'Date.from(Instant.parse("9999-12-31T23:59:59.999Z"))',
    );
    // Year 0 still has four digits.
    expect(generateCode(find(date(PY_MIN - 1n)), 'java')).toContain(
      'Date.from(Instant.parse("0000-12-31T23:59:59.999Z"))',
    );
    const big = generateCode(find(date(PY_MAX + 1n)), 'java');
    expect(big).toContain(`new Date(${PY_MAX + 1n}L)`);
    expect(big).not.toContain('Instant');
    expect(generateCode(find(date(-62_198_755_200_001n)), 'java')).toContain(
      'new Date(-62198755200001L)',
    );
    expect(generateCode(find(date(JS_MAX + 1n)), 'java')).toContain(`new Date(${JS_MAX + 1n}L)`);
    expect(generateCode(find(date(-(2n ** 63n))), 'java')).toContain(
      'new Date(-9223372036854775808L)',
    );
  });
});

describe('Java timestamps', () => {
  const raw = (t: number, i: number) => BigInt.asIntN(64, (BigInt(t) << 32n) | BigInt(i));

  it('uses the (int, int) constructor up to INT32_MAX', () => {
    expect(generateCode(find(ts(2147483647, 2147483647)), 'java')).toContain(
      'new BsonTimestamp(2147483647, 2147483647)',
    );
    expect(generateCode(find(ts(0, 0)), 'java')).toContain('new BsonTimestamp(0, 0)');
  });

  it('uses the raw signed 64-bit value when t or i exceeds INT32_MAX', () => {
    expect(generateCode(find(ts(2147483648, 0)), 'java')).toContain(
      'new BsonTimestamp(-9223372036854775808L)',
    );
    expect(generateCode(find(ts(0, 2147483648)), 'java')).toContain(
      'new BsonTimestamp(2147483648L)',
    );
    expect(generateCode(find(ts(1, 4294967295)), 'java')).toContain(
      'new BsonTimestamp(8589934591L)',
    );
    expect(generateCode(find(ts(4294967295, 1)), 'java')).toContain(
      `new BsonTimestamp(${raw(4294967295, 1)}L)`,
    );
    // The raw value decodes back to t and i (as BsonTimestamp#getTime/getInc do).
    const r = BigInt.asUintN(64, raw(4294967295, 1));
    expect([Number(r >> 32n), Number(r & 0xffffffffn)]).toEqual([4294967295, 1]);
  });

  it('other languages keep t and i unsigned', () => {
    const q = find(ts(4294967295, 2147483648));
    expect(generateCode(q, 'node')).toContain('new Timestamp({ t: 4294967295, i: 2147483648 })');
    expect(generateCode(q, 'python')).toContain('Timestamp(4294967295, 2147483648)');
    expect(generateCode(q, 'shell')).toContain('Timestamp({ t: 4294967295, i: 2147483648 })');
  });
});

describe('Java arrays', () => {
  it('casts a lone null so Arrays.asList gets a one-element list, not a null array', () => {
    const code = generateCode(find(d('{ x: { $in: [null] } }')), 'java');
    expect(code).toContain('new Document("$in", Arrays.asList((Object) null))');
  });

  it('leaves other nulls and single items as they are', () => {
    const code = generateCode(find(d('{ a: [null, null], b: [1], c: [[null]] }')), 'java');
    expect(code).toContain('Arrays.asList(null, null)');
    expect(code).toContain('Arrays.asList(1)');
    expect(code).toContain('Arrays.asList(Arrays.asList((Object) null))');
  });
});

describe('Java collation', () => {
  it('maps every collation option to the Collation builder', () => {
    const code = generateCode(
      find(d('{}'), {
        collation: d(`{ locale: "fr", caseLevel: true, caseFirst: "upper", strength: 3,
          numericOrdering: true, alternate: "shifted", maxVariable: "punct",
          normalization: false, backwards: true }`),
      }),
      'java',
    );
    for (const call of [
      'Collation.builder()',
      '.locale("fr")',
      '.caseLevel(true)',
      '.collationCaseFirst(CollationCaseFirst.fromString("upper"))',
      '.collationStrength(CollationStrength.fromInt(3))',
      '.numericOrdering(true)',
      '.collationAlternate(CollationAlternate.fromString("shifted"))',
      '.collationMaxVariable(CollationMaxVariable.fromString("punct"))',
      '.normalization(false)',
      '.backwards(true)',
      '.build()',
    ]) {
      expect(code).toContain(call);
    }
    for (const name of [
      'Collation',
      'CollationAlternate',
      'CollationCaseFirst',
      'CollationMaxVariable',
      'CollationStrength',
    ]) {
      expect(code).toContain(`import com.mongodb.client.model.${name};`);
    }
  });

  it('accepts strength as Int64 or an integral Double', () => {
    for (const s of ['NumberLong(2)', 'Double(1)']) {
      expect(
        generateCode(find(d('{}'), { collation: d(`{ locale: "en", strength: ${s} }`) }), 'java'),
      ).toContain('CollationStrength.fromInt(');
    }
  });

  it.each([
    ['an unknown option', '{ locale: "en", colour: "blue" }', /Unknown collation option "colour"/],
    ['a non-string locale', '{ locale: 1 }', /collation\.locale must be a string/],
    ['a non-string caseFirst', '{ caseFirst: true }', /collation\.caseFirst must be a string/],
    ['a non-boolean caseLevel', '{ caseLevel: "yes" }', /collation\.caseLevel must be a boolean/],
    ['a non-boolean backwards', '{ backwards: 1 }', /collation\.backwards must be a boolean/],
    ['a fractional strength', '{ strength: 2.5 }', /collation\.strength must be an integer/],
    ['a string strength', '{ strength: "2" }', /collation\.strength must be an integer/],
  ])('throws CodegenError for %s', (_name, collation, message) => {
    const q = find(d('{}'), { collation: d(collation) });
    expect(() => generateCode(q, 'java')).toThrow(CodegenError);
    expect(() => generateCode(q, 'java')).toThrow(message);
  });

  it('shell, Node and Python pass an unknown option through as a document', () => {
    const q = find(d('{}'), { collation: d('{ locale: "en", colour: "blue" }') });
    expect(generateCode(q, 'shell')).toContain(
      '.collation({\n  locale: "en",\n  colour: "blue"\n})',
    );
    expect(generateCode(q, 'node')).toContain('collation: { locale: "en", colour: "blue" }');
    expect(generateCode(q, 'python')).toContain('collation={"locale": "en", "colour": "blue"}');
  });
});

describe('skip and limit', () => {
  it.each([
    ['skip', -1],
    ['limit', -1],
    ['skip', 1.5],
    ['limit', 0.5],
    ['limit', Number.NaN],
    ['skip', Number.POSITIVE_INFINITY],
    ['limit', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('%s %d is a CodegenError in every language', (name, value) => {
    for (const language of CODEGEN_LANGUAGES) {
      const q = find(d('{}'), { [name]: value });
      expect(() => generateCode(q, language)).toThrow(CodegenError);
      expect(() => generateCode(q, language)).toThrow(`${name} must be a non-negative integer`);
    }
  });

  it('CodegenError is an Error named CodegenError', () => {
    try {
      generateCode(find(d('{}'), { skip: -1 }), 'node');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('CodegenError');
    }
  });

  it('leaves out 0 and -0', () => {
    for (const language of CODEGEN_LANGUAGES) {
      const code = generateCode(find(d('{}'), { skip: 0, limit: -0 }), language);
      expect(code).not.toMatch(/skip|limit/);
    }
  });

  it('writes positive values in every language', () => {
    const q = find(d('{}'), { skip: 3, limit: 2147483647 });
    // The one-line statement would be 82 columns, so the find arguments break.
    expect(generateCode(q, 'shell')).toContain('.find(\n  {}\n).skip(3).limit(2147483647);');
    expect(generateCode(q, 'node')).toContain('coll.find({}, { skip: 3, limit: 2147483647 });');
    expect(generateCode(q, 'python')).toContain('coll.find({}, skip=3, limit=2147483647)');
    expect(generateCode(q, 'java')).toContain('.skip(3)');
    expect(generateCode(q, 'java')).toContain('.limit(2147483647)');
  });

  it('Java refuses values beyond int; the other languages accept them', () => {
    for (const name of ['skip', 'limit'] as const) {
      const q = find(d('{}'), { [name]: 2147483648 });
      expect(() => generateCode(q, 'java')).toThrow(CodegenError);
      expect(() => generateCode(q, 'java')).toThrow(`${name} 2147483648 is too large`);
      for (const language of ['shell', 'node', 'python'] as const) {
        expect(generateCode(q, language)).toContain('2147483648');
      }
    }
  });
});

describe('empty options', () => {
  const q = find(d('{ a: 1 }'), { projection: d('{}'), sort: d('{}'), collation: d('{}') });

  it.each([
    ['shell', 'db.getSiblingDB("demo").getCollection("items").find({ a: 1 });'],
    ['node', 'const cursor = coll.find({ a: 1 });'],
    ['python', 'cursor = coll.find({"a": 1})'],
    [
      'java',
      'coll.find(new Document("a", 1))\n                .forEach(doc -> System.out.println(doc.toJson()));',
    ],
  ] as const)('%s leaves out an empty projection, sort and collation', (language, line) => {
    const code = generateCode(q, language);
    expect(code).toContain(line);
    expect(code).not.toMatch(/projection|sort|collation|Collation/i);
  });

  it('an empty aggregation pipeline is an empty list', () => {
    const empty: CodegenQuery = {
      kind: 'aggregate',
      database: 'demo',
      collection: 'items',
      pipeline: [],
    };
    expect(generateCode(empty, 'shell')).toContain('.aggregate([]);');
    expect(generateCode(empty, 'node')).toContain('coll.aggregate([]);');
    expect(generateCode(empty, 'python')).toContain('coll.aggregate([])');
    expect(generateCode(empty, 'java')).toContain('coll.aggregate(List.of())');
  });
});

describe('connection string', () => {
  const uri = 'mongodb://db1.example.test:27018,db2.example.test:27018/?replicaSet=rs0';

  it.each([
    ['node', `new MongoClient(${JSON.stringify(uri)})`],
    ['python', `MongoClient(${JSON.stringify(uri)})`],
    ['java', `MongoClients.create(${JSON.stringify(uri)})`],
  ] as const)('%s uses a custom uri and defaults to localhost', (language, text) => {
    expect(generateCode(find(d('{}')), language, { uri })).toContain(text);
    const plain = generateCode(find(d('{}')), language);
    expect(plain).toContain(JSON.stringify(DEFAULT_URI));
    expect(plain).not.toContain('example.test');
  });

  it('shell ignores the uri (it uses the current connection)', () => {
    expect(generateCode(find(d('{}')), 'shell', { uri })).toBe(
      generateCode(find(d('{}')), 'shell'),
    );
  });

  it('a quote in the uri is escaped', async () => {
    const odd = 'mongodb://h.example.test/?appName=a"b\\c';
    for (const language of ['node', 'python', 'java'] as const) {
      expect(generateCode(find(d('{}')), language, { uri: odd })).toContain(JSON.stringify(odd));
    }
    expect((await runNode(generateCode(find(d('{}')), 'node', { uri: odd }))).uri).toBe(odd);
  });
});

describe('__proto__ and other awkward keys', () => {
  const q = find(
    fields(
      ['__proto__', { type: 'string', value: 'x' }],
      ['nested', fields(['__proto__', fields(['polluted', { type: 'bool', value: true }])])],
      ['a-b', int(1)],
      ['1st', int(2)],
      ['', int(3)],
      ['$gt', int(4)],
      ['_ok$', int(5)],
    ),
  );

  it('shell and Node write __proto__ as a computed key, also nested', () => {
    for (const language of ['shell', 'node'] as const) {
      const code = generateCode(q, language);
      expect(code).toContain('["__proto__"]: "x"');
      expect(code).toContain('nested: { ["__proto__"]: { polluted: true } }');
      expect(code).not.toMatch(/[^[]"__proto__":|\b__proto__:/);
    }
  });

  it('quotes keys that are not identifiers and leaves identifiers bare', () => {
    const code = generateCode(q, 'node');
    expect(code).toContain('"a-b": 1');
    expect(code).toContain('"1st": 2');
    expect(code).toContain('"": 3');
    expect(code).toContain('$gt: 4');
    expect(code).toContain('_ok$: 5');
  });

  it('Python and Java use the key as a plain string', () => {
    expect(generateCode(q, 'python')).toContain('"__proto__": "x"');
    expect(generateCode(q, 'java')).toContain('new Document("__proto__", "x")');
  });

  it('the Node program sends __proto__ as a real field (no prototype change)', async () => {
    const calls = await runNode(generateCode(q, 'node'));
    const filter = calls.args[0] as Record<string, unknown>;
    expect(Object.keys(filter)).toEqual(['__proto__', 'nested', 'a-b', '1st', '', '$gt', '_ok$']);
    expect(Object.getPrototypeOf(filter)).toBe(Object.prototype);
    expect(bytes(filter)).toBe(bytes(toDriver(q.filter)));
  });
});

describe('strings and regexes with escapes', () => {
  const text = 'quote " back \\ nl \n tab \t nul \u0000 bell \u0007 ls   emoji 😀 lit \\u000a';
  const pattern = '^a"b\\d+\\/c\\\\$';
  const q = find(
    fields(
      ['k"\\ey', int(1)],
      ['s', { type: 'string', value: text }],
      ['r', { type: 'regex', pattern, options: 'imsx' }],
    ),
  );

  it('Node sends the exact string, pattern and key', async () => {
    const calls = await runNode(generateCode(q, 'node'));
    const filter = calls.args[0] as Record<string, unknown>;
    expect(filter.s).toBe(text);
    expect(filter.r).toBeInstanceOf(bson.BSONRegExp);
    expect((filter.r as bson.BSONRegExp).pattern).toBe(pattern);
    expect((filter.r as bson.BSONRegExp).options).toBe('imsx');
    expect(Object.keys(filter)).toContain('k"\\ey');
  });

  it('Python and Java use JSON string escapes', () => {
    const lit = JSON.stringify(text);
    expect(lit).toContain('\\u0000');
    expect(lit).toContain('\\\\u000a'); // the backslash of the text is doubled
    expect(generateCode(q, 'python')).toContain(`"s": ${lit}`);
    expect(generateCode(q, 'python')).toContain(`Regex(${JSON.stringify(pattern)}, "imsx")`);
    expect(generateCode(q, 'python')).toContain(`${JSON.stringify('k"\\ey')}: 1`);
    expect(generateCode(q, 'java')).toMatch(/\.append\(\s*"s",\s*"quote/);
    expect(generateCode(q, 'java')).toContain(lit);
    expect(generateCode(q, 'java')).toContain(
      `new BsonRegularExpression(${JSON.stringify(pattern)}, "imsx")`,
    );
  });

  it('Java never writes a raw line break or a \\u escape for a quote, backslash or line break', () => {
    const code = generateCode(q, 'java');
    // Java translates \uXXXX before lexing; these would end or break the string literal.
    expect(code).not.toMatch(/(?<!\\)(\\\\)*\\u(000[aAdD]|0022|005[cC])/);
    const body = code.split('\n').find((l) => l.includes('"s"')) ?? '';
    expect(body).not.toContain(' \n');
  });

  it('the shell statement parses back to the same filter', () => {
    const code = generateCode(q, 'shell');
    const inner = code.slice(code.indexOf('.find(') + '.find('.length, code.lastIndexOf(');'));
    expect(parseShellSyntaxDocument(inner)).toEqual(q.filter);
  });
});

describe('Node programs pass the same BSON to the driver as the query', () => {
  for (const { name, query } of CODEGEN_SAMPLES) {
    // undefined, dbPointer: no faithful Node type (documented assumption); checked below.
    if (name === 'find with deprecated types') continue;
    it(name, async () => {
      const calls = await runNode(generateCode(query, 'node'));
      expect(calls.database).toBe(query.database);
      expect(calls.collection).toBe(query.collection);
      expect(calls.method).toBe(query.kind);
      expect(calls.args.map(bytes)).toEqual(expectedNodeArgs(query).map(bytes));
    });
  }

  it('deprecated types: symbol and code with scope are exact; dbPointer becomes a DBRef', async () => {
    const sym: BsonValue = { type: 'symbol', value: 'abc' };
    const scoped: BsonValue = {
      type: 'javascriptWithScope',
      code: 'function () { return x; }',
      scope: fields(['x', int(1)]),
    };
    const ptr: BsonValue = {
      type: 'dbPointer',
      ref: 'other.coll',
      hex: '65a1b2c3d4e5f60718293a4b',
    };
    const q = find(fields(['sym', sym], ['scoped', scoped], ['ptr', ptr]));
    const filter = (await runNode(generateCode(q, 'node'))).args[0] as Record<string, unknown>;
    expect(bytes(filter.sym)).toBe(bytes(toDriver(sym)));
    expect(bytes(filter.scoped)).toBe(bytes(toDriver(scoped)));
    expect(filter.ptr).toBeInstanceOf(bson.DBRef);
    // bson's DBRef splits a "db.collection" namespace into $db and $ref (see TW-2).
    const ref = filter.ptr as bson.DBRef;
    expect([ref.db, ref.collection].filter(Boolean).join('.')).toBe('other.coll');
    expect(ref.oid.toHexString()).toBe('65a1b2c3d4e5f60718293a4b');
  });

  it('a find with every option sends them as driver options', async () => {
    const q = find(d('{ a: NumberLong(1) }'), {
      projection: d('{ _id: 0 }'),
      sort: d('{ a: -1, b: 1 }'),
      collation: d('{ locale: "en", strength: 2 }'),
      skip: 7,
      limit: 3,
    });
    const calls = await runNode(generateCode(q, 'node'));
    expect(calls.args.map(bytes)).toEqual(expectedNodeArgs(q).map(bytes));
    expect(Object.keys(calls.args[1] as object)).toEqual([
      'projection',
      'sort',
      'collation',
      'skip',
      'limit',
    ]);
  });

  it('doubles that look like integers stay doubles and -0 keeps its sign', async () => {
    const q = find(d('{ a: Double(3), b: -0, c: Double(-2147483648), e: 2147483648, f: 1e21 }'));
    const calls = await runNode(generateCode(q, 'node'));
    expect(bytes(calls.args[0])).toBe(bytes(toDriver(q.filter)));
  });
});

describe('the shell statement parses back to the same values', () => {
  for (const { name, query } of CODEGEN_SAMPLES) {
    // Only statements without `.sort(…)`/`.collation(…)`/`.skip(…)`/`.limit(…)` tails.
    const hasTail =
      query.kind === 'find' &&
      ([query.sort, query.collation].some((x) => x && x.fields.length > 0) ||
        Boolean(query.skip) ||
        Boolean(query.limit));
    if (hasTail) continue;
    it(name, () => {
      const code = generateCode(query, 'shell');
      const open = query.kind === 'find' ? '.find(' : '.aggregate(';
      const inner = code.slice(code.indexOf(open) + open.length, code.lastIndexOf(');'));
      if (query.kind === 'aggregate') {
        expect(parseShellSyntax(inner)).toEqual({ type: 'array', items: query.pipeline });
      } else {
        const expected = [query.filter];
        if (query.projection && query.projection.fields.length > 0) {
          expected.push(query.projection);
        }
        expect(parseShellSyntax(`[${inner}]`)).toEqual({ type: 'array', items: expected });
      }
    });
  }
});

describe('generateCode language dispatch', () => {
  it.each(CODEGEN_LANGUAGES.map((l) => [l] as [CodegenLanguage]))('%s ends with a newline', (l) => {
    expect(generateCode(find(d('{}')), l).endsWith('\n')).toBe(true);
  });

  it.each([
    ['shell', '{ t: true, f: false }'],
    ['node', '{ t: true, f: false }'],
    ['python', '{"t": True, "f": False}'],
    ['java', 'new Document("t", true).append("f", false)'],
  ] as const)('%s writes both booleans', (language, text) => {
    expect(generateCode(find(d('{ t: true, f: false }')), language)).toContain(text);
  });
});
