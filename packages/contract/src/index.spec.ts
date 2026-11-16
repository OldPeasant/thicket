import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BROADCAST_STREAMS,
  ERROR_CODES,
  MAX_SLEEP_MS,
  METHOD_NAMES,
  WRITE_METHODS,
  cancel,
  ejsonSchemas,
  event,
  isErrorCode,
  methods,
  parseParams,
  parseResult,
  profile,
  profileDraft,
  request,
  response,
  route,
  type MethodDef,
  type MethodName,
  type ParamsOf,
} from './index';

const P = 'p1';
const NS = { profileId: P, db: 'shop', coll: 'orders' };
const OID = '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}';
const PROFILE = {
  id: P,
  name: 'Local',
  connectionString: 'mongodb://localhost:27017',
  readOnly: false,
  production: true,
};

/** One valid and one invalid params sample per method. */
const SAMPLES: { [M in MethodName]: { valid: ParamsOf<M>; invalid: unknown } } = {
  'profiles.list': { valid: {}, invalid: { extra: 1 } },
  'profiles.get': { valid: { profileId: P }, invalid: { profileId: '' } },
  'profiles.save': {
    valid: {
      profile: {
        ...PROFILE,
        id: undefined,
        auth: {
          mechanism: 'SCRAM-SHA-256',
          username: 'u',
          authSource: 'admin',
          secretMode: 'saved',
        },
        tls: { enabled: true, allowInvalidHostnames: false },
        ssh: { host: 'bastion', port: 22, username: 'me', method: 'agent' },
        readPreference: 'secondaryPreferred',
      },
    },
    invalid: { profile: { ...PROFILE, connectionString: 'http://x' } },
  },
  'profiles.delete': { valid: { profileId: P }, invalid: {} },
  'profiles.duplicate': { valid: { profileId: P }, invalid: { profileId: 3 } },
  'profiles.importCompass': { valid: {}, invalid: { path: '/etc/passwd' } },
  'profiles.importUris': { valid: { uris: ['mongodb://a:27017'] }, invalid: { uris: [] } },
  'profiles.export': { valid: { profileIds: [P] }, invalid: { profileIds: P } },
  'profiles.chooseFile': { valid: { purpose: 'tlsCaFile' }, invalid: { purpose: 'anyFile' } },
  'profiles.setSecret': {
    valid: { profileId: P, kind: 'password', value: 's3cret' },
    invalid: { profileId: P, kind: 'pin', value: 'x' },
  },
  'profiles.clearSecret': { valid: { profileId: P }, invalid: { profileId: P, kind: 'pin' } },
  'profiles.secretStorage': { valid: {}, invalid: { refresh: true } },

  'conn.test': {
    valid: { profile: PROFILE, password: 'pw' },
    invalid: { profileId: P, profile: PROFILE },
  },
  'conn.open': { valid: { profileId: P }, invalid: { profileId: P, password: 1 } },
  'conn.close': { valid: { profileId: P }, invalid: {} },
  'conn.status': { valid: {}, invalid: { profileId: '' } },
  'conn.serverInfo': { valid: { profileId: P }, invalid: { id: P } },

  'db.listDatabases': {
    valid: { profileId: P, withSizes: true },
    invalid: { profileId: P, withSizes: 'y' },
  },
  'db.create': {
    valid: { profileId: P, db: 'shop', firstCollection: 'orders', confirmed: true },
    invalid: { profileId: P, db: 'shop' },
  },
  'db.drop': { valid: { profileId: P, db: 'shop' }, invalid: { profileId: P, db: '' } },
  'db.stats': { valid: { profileId: P, db: 'shop' }, invalid: { db: 'shop' } },

  'coll.list': { valid: { profileId: P, db: 'shop' }, invalid: { profileId: P } },
  'coll.create': {
    valid: { ...NS, options: '{"capped":true,"size":{"$numberInt":"4096"}}' },
    invalid: { ...NS, options: { capped: true } },
  },
  'coll.drop': { valid: { ...NS, confirmed: true }, invalid: { ...NS, confirmed: 'yes' } },
  'coll.rename': { valid: { ...NS, newName: 'orders2' }, invalid: { ...NS } },
  'coll.stats': { valid: NS, invalid: { ...NS, coll: '' } },
  'coll.validator.get': { valid: NS, invalid: { profileId: P, db: 'shop' } },
  'coll.validator.set': {
    valid: {
      ...NS,
      validator: '{"$jsonSchema":{}}',
      validationLevel: 'strict',
      validationAction: 'error',
    },
    invalid: { ...NS, validator: null, validationLevel: 'always', validationAction: 'error' },
  },

  'docs.find': {
    valid: {
      ...NS,
      filter: '{"status":"open"}',
      sort: '{"_id":{"$numberInt":"1"}}',
      limit: 50,
      after: `{"_id":${OID}}`,
    },
    invalid: { ...NS, filter: '[]' },
  },
  'docs.count': { valid: { ...NS, filter: '{}' }, invalid: { ...NS, filter: {} } },
  'docs.estimatedCount': { valid: NS, invalid: { ...NS, maxTimeMS: -1 } },
  'docs.get': { valid: { ...NS, id: OID, sliceAbove: 100 }, invalid: { ...NS, id: '' } },
  'docs.getSlice': {
    valid: { ...NS, id: OID, path: 'items', skip: 100, limit: 100 },
    invalid: { ...NS, id: OID, path: 'items', skip: -1, limit: 100 },
  },
  'docs.insert': {
    valid: { ...NS, docs: ['{"a":{"$numberInt":"1"}}'] },
    invalid: { ...NS, docs: [] },
  },
  'docs.update': {
    valid: {
      ...NS,
      id: OID,
      update: '{"$set":{"total":{"$numberDecimal":"5"}}}',
      expected: '{"total":null}',
    },
    invalid: { ...NS, id: OID, update: '{"$set":{}}' },
  },
  'docs.replace': { valid: { ...NS, id: OID, doc: `{"_id":${OID}}` }, invalid: { ...NS, id: OID } },
  'docs.delete': { valid: { ...NS, id: OID, confirmed: true }, invalid: { ...NS } },
  'docs.previewMany': {
    valid: { ...NS, filter: '{}', sampleSize: 20 },
    invalid: { ...NS, filter: '{}', sampleSize: 0 },
  },
  'docs.updateMany': {
    valid: {
      ...NS,
      filter: '{}',
      update: '[{"$set":{"x":{"$numberInt":"1"}}}]',
      expectedCount: 10,
    },
    invalid: { ...NS, filter: '{}', update: 'x' },
  },
  'docs.deleteMany': {
    valid: { ...NS, filter: '{}', confirmed: true },
    invalid: { ...NS, filter: '{}', confirm: true },
  },

  'agg.run': {
    valid: { ...NS, pipeline: '[{"$match":{}}]' },
    invalid: { ...NS, pipeline: '{"$match":{}}' },
  },
  'agg.previewStage': { valid: { ...NS, pipeline: '[]', limit: 20 }, invalid: { ...NS } },
  'agg.explain': {
    valid: { ...NS, target: { kind: 'find', filter: '{}' }, verbosity: 'executionStats' },
    invalid: { ...NS, target: { kind: 'count', filter: '{}' } },
  },
  'agg.createView': {
    valid: { profileId: P, db: 'shop', view: 'v', viewOn: 'orders', pipeline: '[]' },
    invalid: { profileId: P, db: 'shop', view: 'v', pipeline: '[]' },
  },

  'idx.list': { valid: NS, invalid: { ...NS, extra: true } },
  'idx.stats': { valid: NS, invalid: { ...NS, db: 1 } },
  'idx.create': {
    valid: { ...NS, key: '{"status":{"$numberInt":"1"}}', options: '{"unique":true}' },
    invalid: { ...NS, key: '"status"' },
  },
  'idx.drop': { valid: { ...NS, name: 'status_1' }, invalid: { ...NS, name: '' } },
  'idx.hide': {
    valid: { ...NS, name: 'status_1', hidden: true },
    invalid: { ...NS, name: 'status_1' },
  },

  'schema.analyze': { valid: { ...NS, sampleSize: 1000 }, invalid: { ...NS, sampleSize: 1.5 } },

  'io.export': {
    valid: { ...NS, source: { kind: 'find', filter: '{}' }, format: 'jsonl', ejsonMode: 'relaxed' },
    invalid: { ...NS, source: { kind: 'find', filter: '{}' }, format: 'xml' },
  },
  'io.previewImport': {
    valid: { format: 'json' },
    invalid: { format: 'json', path: '/tmp/a.json' },
  },
  'io.import': {
    valid: { ...NS, fileToken: 't1', ordered: false },
    invalid: { ...NS, fileToken: '' },
  },

  'shell.open': { valid: { profileId: P, db: 'shop' }, invalid: { db: 'shop' } },
  'shell.eval': {
    valid: { sessionId: 's1', code: 'db.orders.countDocuments()' },
    invalid: { sessionId: 's1' },
  },
  'shell.complete': {
    valid: { sessionId: 's1', code: 'db.or', cursor: 5 },
    invalid: { sessionId: 's1', code: 'db.or', cursor: -1 },
  },
  'shell.close': { valid: { sessionId: 's1' }, invalid: { sessionId: '' } },

  'admin.currentOp': {
    valid: { profileId: P, ns: 'shop', minSecsRunning: 5 },
    invalid: { profileId: P, minSecsRunning: -1 },
  },
  'admin.killOp': {
    valid: { profileId: P, opId: '{"$numberInt":"42"}', confirmed: true },
    invalid: { profileId: P, opId: 42 },
  },
  'admin.users': { valid: { profileId: P, db: 'admin' }, invalid: { profileId: P } },
  'admin.roles': {
    valid: { profileId: P, db: 'admin', builtin: true },
    invalid: { profileId: P, db: 'admin', builtin: 'no' },
  },
  'admin.serverStatus': { valid: { profileId: P }, invalid: {} },
  'admin.watch': {
    valid: { profileId: P, db: 'shop', fullDocument: 'updateLookup' },
    invalid: { profileId: P, fullDocument: 'all' },
  },

  'app.ping': { valid: {}, invalid: { echo: 1 } },
  'app.settings.get': { valid: {}, invalid: { key: 'style' } },
  'app.settings.set': {
    valid: { settings: { style: 'tron', pageSize: 100 } },
    invalid: { settings: { pageSize: 30 } },
  },
  'app.theme': { valid: {}, invalid: { style: 'tron' } },
  'app.checkForUpdate': { valid: {}, invalid: { force: true } },
  'backend.ping': { valid: {}, invalid: { pid: 1 } },
  'backend.sleep': { valid: { ms: 50 }, invalid: { ms: MAX_SLEEP_MS + 1 } },
};

/** The methods that write to the server (SPEC.md section 4: they carry profileId and confirmed). */
const EXPECTED_WRITES = [
  'db.create',
  'db.drop',
  'coll.create',
  'coll.drop',
  'coll.rename',
  'coll.validator.set',
  'docs.insert',
  'docs.update',
  'docs.replace',
  'docs.delete',
  'docs.updateMany',
  'docs.deleteMany',
  'agg.run',
  'agg.createView',
  'idx.create',
  'idx.drop',
  'idx.hide',
  'io.import',
  'admin.killOp',
].sort();

const table: Record<string, MethodDef> = methods;

describe('method table', () => {
  it('covers every group of SPEC.md section 4 (plus the backend.* wiring diagnostics)', () => {
    const groups = new Set(METHOD_NAMES.map((name) => name.split('.')[0]));
    expect([...groups].sort()).toEqual(
      [
        'admin',
        'agg',
        'app',
        'backend',
        'coll',
        'conn',
        'db',
        'docs',
        'idx',
        'io',
        'profiles',
        'schema',
        'shell',
      ].sort(),
    );
  });

  it.each(METHOD_NAMES)('%s has params and result schemas and a sample', (name) => {
    const def = table[name];
    expect(def?.params).toBeInstanceOf(z.ZodType);
    expect(def?.result).toBeInstanceOf(z.ZodType);
    expect(def?.summary.length).toBeGreaterThan(0);
    expect(Object.keys(SAMPLES)).toContain(name);
  });

  it('has no sample for a method that does not exist', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...METHOD_NAMES].sort());
  });
});

describe('params validation', () => {
  it.each(METHOD_NAMES)('%s accepts its valid sample', (name) => {
    const parsed = parseParams(name, SAMPLES[name].valid);
    expect(parsed.ok ? 'ok' : parsed.error.message).toBe('ok');
  });

  it.each(METHOD_NAMES)('%s rejects its invalid sample with a readable message', (name) => {
    const parsed = parseParams(name, SAMPLES[name].invalid);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('INVALID_PARAMS');
    expect(parsed.error.message).toMatch(
      new RegExp(`^Invalid params for ${name.replace(/\./g, '\\.')}:\\n✖ `),
    );
    expect(parsed.error.message).not.toContain('[object Object]');
    expect(Array.isArray(parsed.error.detail)).toBe(true);
  });

  it('names the field and the expectation', () => {
    const parsed = parseParams('docs.find', { ...NS, filter: '[1]' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('filter must be canonical EJSON text of a document');
    expect(parsed.error.message).toContain('→ at filter');
    expect(parsed.error.detail).toEqual([
      {
        path: ['filter'],
        message: 'filter must be canonical EJSON text of a document (starting with "{")',
      },
    ]);
  });

  it('rejects unknown keys so a misspelt confirmed fails loudly', () => {
    const parsed = parseParams('docs.delete', { ...NS, id: OID, confirm: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('confirm');
  });

  it('rejects params that are not an object', () => {
    for (const params of [undefined, null, 'x', 42, []]) {
      expect(parseParams('conn.open', params).ok).toBe(false);
    }
  });

  it('answers UNKNOWN_METHOD for names outside the contract', () => {
    for (const name of ['docs.nope', 'toString', '__proto__', 'constructor', '']) {
      const parsed = parseParams(name, {});
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe('UNKNOWN_METHOD');
      expect(parseResult(name, {}).ok).toBe(false);
    }
  });

  it('conn.test needs exactly one of profileId and profile', () => {
    expect(parseParams('conn.test', { profileId: P }).ok).toBe(true);
    expect(parseParams('conn.test', {}).ok).toBe(false);
  });
});

describe('result validation', () => {
  it('accepts well-formed results', () => {
    expect(parseResult('docs.find', { streamId: 's1' }).ok).toBe(true);
    expect(
      parseResult('docs.get', {
        doc: `{"_id":${OID}}`,
        sliced: [{ path: 'items', total: 2000, loaded: 100 }],
      }).ok,
    ).toBe(true);
    expect(parseResult('docs.get', { doc: null, sliced: [] }).ok).toBe(true);
    expect(parseResult('profiles.importCompass', null).ok).toBe(true);
    expect(
      parseResult('conn.open', {
        profileId: P,
        state: 'error',
        error: { code: 'AUTH_FAILED', message: 'bad password' },
      }).ok,
    ).toBe(true);
  });

  it('reports a malformed result as INTERNAL', () => {
    const parsed = parseResult('docs.get', { doc: { _id: 1 }, sliced: [] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('INTERNAL');
      expect(parsed.error.message).toContain('Invalid result for docs.get');
    }
  });
});

/** Field names that hold documents, query parts, pipelines or BSON values. */
const DOC_FIELDS = new Set([
  'after',
  'before',
  'collation',
  'current',
  'doc',
  'docs',
  'event',
  'examples',
  'expected',
  'explain',
  'filter',
  'hint',
  'id',
  'insertedIds',
  'items',
  'key',
  'opId',
  'ops',
  'options',
  'partialFilterExpression',
  'pipeline',
  'projection',
  'raw',
  'roles',
  'sample',
  'sort',
  'status',
  'update',
  'users',
  'validator',
  'value',
]);

interface Finding {
  path: string;
  problem: string;
}

/**
 * Walks a schema; reports free-form values and document fields that are not EJSON text.
 * `local` relaxes the doc-field name rule for data without server documents (profiles, settings),
 * where `id`/`value`/`current` are plain strings; free-form values are still rejected there.
 */
function walk(
  schema: z.ZodType,
  path: string,
  docField: boolean,
  out: Finding[],
  local = false,
): void {
  if (schema === profileDraft || schema === profile) local = true;
  const isDoc = docField && !local;
  const kind = ejsonSchemas.get(schema);
  if (kind) {
    if (!(schema instanceof z.ZodString))
      out.push({ path, problem: 'EJSON schema is not a string' });
    return;
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    walk(schema.unwrap() as z.ZodType, path, docField, out, local);
  } else if (schema instanceof z.ZodArray) {
    walk(schema.element as z.ZodType, `${path}[]`, docField, out, local);
  } else if (schema instanceof z.ZodUnion) {
    schema.options.forEach((option, i) =>
      walk(option as z.ZodType, `${path}|${i}`, docField, out, local),
    );
  } else if (schema instanceof z.ZodObject) {
    if (isDoc) out.push({ path, problem: 'document field is an object, not EJSON text' });
    for (const [key, value] of Object.entries(schema.shape)) {
      walk(value as z.ZodType, path ? `${path}.${key}` : key, DOC_FIELDS.has(key), out, local);
    }
  } else if (
    schema instanceof z.ZodUnknown ||
    schema instanceof z.ZodAny ||
    schema instanceof z.ZodRecord ||
    schema instanceof z.ZodMap
  ) {
    out.push({ path, problem: 'free-form value (documents must be EJSON text)' });
  } else if (isDoc) {
    out.push({ path, problem: `document field has type ${schema.def.type}, not EJSON text` });
  } else if (!(
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodLiteral
  )) {
    out.push({ path, problem: `unhandled schema type ${schema.def.type}` });
  }
}

describe('documents travel as EJSON text', () => {
  it.each(METHOD_NAMES)('%s has no object or free-form document fields', (name) => {
    const def = table[name];
    if (!def) throw new Error(name);
    const findings: Finding[] = [];
    // profiles.* and app.* carry no server data; their `id`/`value`/`current` are plain strings.
    // Only the doc-field name rule is relaxed for them: free-form values are still rejected.
    const local = name.startsWith('profiles.') || name.startsWith('app.');
    const run = (schema: z.ZodType, path: string) => walk(schema, path, false, findings, local);
    run(def.params, 'params');
    run(def.result, 'result');
    if (def.stream) run(def.stream, 'stream');
    expect(findings).toEqual([]);
  });

  it('the walker catches a plain object document field', () => {
    const findings: Finding[] = [];
    walk(
      z.object({ doc: z.object({ a: z.number() }), x: z.record(z.string(), z.unknown()) }),
      '',
      false,
      findings,
    );
    expect(findings.map((f) => f.path)).toEqual(['doc', 'x']);
    const local: Finding[] = [];
    walk(z.object({ id: z.string(), extra: z.unknown() }), '', false, local, true);
    expect(local.map((f) => f.path)).toEqual(['extra']);
  });

  it('EJSON fields accept EJSON text and reject other shapes', () => {
    expect(parseParams('docs.insert', { ...NS, docs: ['  {"a":1}'] }).ok).toBe(true);
    expect(parseParams('docs.insert', { ...NS, docs: [{ a: 1 }] }).ok).toBe(false);
    expect(parseParams('agg.run', { ...NS, pipeline: '[]' }).ok).toBe(true);
    expect(parseParams('agg.run', { ...NS, pipeline: [] }).ok).toBe(false);
  });
});

describe('writes', () => {
  it('the write list matches the contract', () => {
    expect([...WRITE_METHODS].sort()).toEqual(EXPECTED_WRITES);
  });

  it('only agg.run writes conditionally', () => {
    expect(WRITE_METHODS.filter((name) => table[name]?.write === 'conditional')).toEqual([
      'agg.run',
    ]);
  });

  it.each(EXPECTED_WRITES)(
    '%s requires profileId and takes an optional boolean confirmed',
    (name) => {
      const params = table[name]?.params;
      if (!(params instanceof z.ZodObject)) throw new Error(`${name} params are not an object`);
      const shape = params.shape as Record<string, z.ZodType>;
      expect(shape['profileId']).toBeDefined();
      expect(shape['profileId']?.safeParse(undefined).success).toBe(false);
      expect(shape['profileId']?.safeParse('p').success).toBe(true);
      expect(shape['confirmed']).toBeDefined();
      expect(shape['confirmed']?.safeParse(undefined).success).toBe(true);
      expect(shape['confirmed']?.safeParse(true).success).toBe(true);
      expect(shape['confirmed']?.safeParse('true').success).toBe(false);

      const sample = SAMPLES[name as MethodName].valid as Record<string, unknown>;
      expect(parseParams(name, { ...sample, confirmed: true }).ok).toBe(true);
      const { profileId: _omitted, ...withoutProfile } = sample;
      expect(_omitted).toBe(P);
      expect(parseParams(name, withoutProfile).ok).toBe(false);
    },
  );
});

describe('route', () => {
  it('sends profiles.*, app.* and io.* to main, the rest to the backend', () => {
    for (const name of METHOD_NAMES) {
      const group = name.split('.')[0] ?? '';
      expect([name, route(name)]).toEqual([
        name,
        ['profiles', 'app', 'io'].includes(group) ? 'main' : 'backend',
      ]);
    }
  });

  it('is undefined for unknown methods', () => {
    expect(route('docs.nope')).toBeUndefined();
    expect(route('hasOwnProperty')).toBeUndefined();
  });
});

describe('streams', () => {
  it('methods returning a streamId declare their data payload', () => {
    for (const name of METHOD_NAMES) {
      const def = table[name];
      const result = def?.result;
      const streams = result instanceof z.ZodObject && 'streamId' in result.shape;
      expect([name, def?.stream !== undefined]).toEqual([name, streams]);
    }
  });

  it('data payloads validate', () => {
    expect(methods['docs.find'].stream.safeParse({ docs: ['{}'] }).success).toBe(true);
    expect(methods['shell.eval'].stream.safeParse({ kind: 'print', text: 'hi' }).success).toBe(
      true,
    );
    expect(methods['shell.eval'].stream.safeParse({ kind: 'beep' }).success).toBe(false);
  });
});

describe('envelope', () => {
  it('parses requests, responses, events and cancels', () => {
    expect(request.safeParse({ id: '1', method: 'docs.find', params: {} }).success).toBe(true);
    expect(request.safeParse({ id: '', method: 'docs.find', params: {} }).success).toBe(false);
    expect(response.safeParse({ id: '1', ok: true, result: { streamId: 's' } }).success).toBe(true);
    expect(
      response.safeParse({ id: '1', ok: false, error: { code: 'CONFLICT', message: 'changed' } })
        .success,
    ).toBe(true);
    expect(
      response.safeParse({ id: '1', ok: false, error: { code: 'OOPS', message: 'x' } }).success,
    ).toBe(false);
    expect(response.safeParse({ id: '1', ok: false, result: {} }).success).toBe(false);
    expect(event.safeParse({ stream: 's', kind: 'data', payload: { docs: [] } }).success).toBe(
      true,
    );
    expect(event.safeParse({ stream: 's', kind: 'progress', payload: null }).success).toBe(false);
    expect(cancel.safeParse({ cancel: '1' }).success).toBe(true);
    expect(Object.values(BROADCAST_STREAMS)).toEqual([
      'conn.status',
      'app.theme',
      'backend.restarted',
    ]);
  });

  it('has the stable error codes named in SPEC.md', () => {
    for (const code of [
      'AUTH_FAILED',
      'TLS_ERROR',
      'DNS_ERROR',
      'TIMEOUT',
      'CONFLICT',
      'READ_ONLY',
      'NOT_FOUND',
      'SERVER_ERROR',
      'CANCELLED',
    ]) {
      expect(ERROR_CODES).toContain(code);
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode(1)).toBe(false);
  });
});
