import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CSV_TYPES,
  METHOD_NAMES,
  WRITE_METHODS,
  conflictDetail,
  ejsonArray,
  ejsonDocument,
  ejsonDocumentOrArray,
  ejsonSchemas,
  hasPassword,
  ejsonValue,
  errorInfo,
  errorSummary,
  event,
  cancel,
  isMethodName,
  methods,
  parseParams,
  parseResult,
  route,
  serverErrorDetail,
  streamEnd,
  streamError,
  type MethodDef,
  type MethodName,
  type ResultOf,
  type StreamDataOf,
  type StreamMethodName,
} from './index';

/*
 * Complements index.spec.ts: result and stream schemas of every method, write-param boundaries,
 * message readability and the shared EJSON / error building blocks. All data is fictitious.
 */

const P = 'p-test';
const NS = { profileId: P, db: 'shop', coll: 'orders' };
const OID = '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}';
const PROFILE = {
  id: P,
  name: 'Example',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: true,
  production: false,
};
const SERVER = {
  version: '7.0.5',
  topology: 'replicaSet' as const,
  enterprise: false,
  raw: '{"ok":{"$numberDouble":"1.0"}}',
};
const SAVED_PIPELINE = {
  ...NS,
  pipelineId: 'pl-1',
  name: 'Big orders',
  stages: [
    { stage: '{"$match":{"total":{"$gt":{"$numberInt":"100"}}}}', enabled: true },
    { stage: '{"$limit":{"$numberInt":"5"}}', enabled: false },
  ],
  updatedAt: '2026-11-17T04:00:00.000Z',
};
const SETTINGS = {
  style: 'business' as const,
  mode: 'system' as const,
  pageSize: 50 as const,
  nestedPageSize: 100,
  defaultIntegerType: 'int32' as const,
  dateDisplay: 'utc' as const,
  checkForUpdates: false,
  schemaSampleSize: 1000,
  sidebarWidth: 260,
};
const QUERY = {
  filter: '{ status: "open" }',
  projection: '',
  sort: '',
  collation: '',
  limit: '10',
};
const AT = '2026-01-02T03:04:05.000Z';
const FAVORITE = { id: 'f1', name: 'Open orders', query: QUERY, at: AT };
const INDEX = {
  name: 'status_1',
  key: '{"status":{"$numberInt":"1"}}',
  unique: false,
  sparse: false,
  hidden: false,
  partialFilterExpression: '{"status":"open"}',
  raw: '{"v":{"$numberInt":"2"}}',
};

/** A valid result per method, plus one that must be rejected (documents as objects where possible). */
const RESULTS: { [M in MethodName]: { valid: ResultOf<M>; invalid: unknown } } = {
  'profiles.list': { valid: { profiles: [PROFILE] }, invalid: { profiles: [{ id: P }] } },
  'profiles.get': {
    valid: { profile: PROFILE, storedSecrets: ['password'] },
    invalid: { profile: PROFILE, storedSecrets: ['pin'] },
  },
  'profiles.save': { valid: { profile: PROFILE }, invalid: { profile: { ...PROFILE, id: '' } } },
  'profiles.delete': { valid: {}, invalid: null },
  'profiles.duplicate': { valid: { profile: PROFILE }, invalid: {} },
  'profiles.importCompass': {
    valid: { imported: [], skipped: [{ source: 'conn-1', reason: 'unsupported auth' }] },
    invalid: { imported: [] },
  },
  'profiles.importUris': {
    valid: { imported: [PROFILE], skipped: [] },
    invalid: { imported: [{ ...PROFILE, connectionString: 'http://x' }], skipped: [] },
  },
  'profiles.export': {
    valid: { path: null, exported: 0 },
    invalid: { path: '/tmp/x.json', exported: -1 },
  },
  'profiles.chooseFile': {
    valid: { path: '/home/user/certs/ca.pem' },
    invalid: { path: '' },
  },
  'profiles.setSecret': { valid: { secureStorage: false }, invalid: { secureStorage: 'no' } },
  'profiles.clearSecret': { valid: {}, invalid: 'done' },
  'profiles.secretStorage': {
    valid: { level: 'weak', backend: 'basic_text', defaultSecretMode: 'ask' },
    invalid: { level: 'plaintext', backend: 'basic_text', defaultSecretMode: 'ask' },
  },

  'conn.test': {
    valid: { latencyMS: 2.5, server: SERVER },
    invalid: { latencyMS: 2.5, server: { ...SERVER, raw: { ok: 1 } } },
  },
  'conn.open': {
    valid: { profileId: P, state: 'connected' },
    invalid: { profileId: P, state: 'open' },
  },
  'conn.close': { valid: {}, invalid: [] },
  'conn.status': {
    valid: { connections: [{ profileId: P, state: 'disconnected' }] },
    invalid: {
      connections: [{ profileId: P, state: 'error', error: { code: 'X', message: 'm' } }],
    },
  },
  'conn.trustHostKey': { valid: {}, invalid: [] },
  'conn.serverInfo': { valid: SERVER, invalid: { ...SERVER, topology: 'mesh' } },

  'db.listDatabases': {
    valid: { databases: [{ name: 'shop', sizeOnDisk: 8192, empty: false }] },
    invalid: { databases: [{ name: 'shop', sizeOnDisk: -1 }] },
  },
  'db.create': { valid: {}, invalid: null },
  'db.drop': { valid: {}, invalid: null },
  'db.stats': {
    valid: {
      collections: 2,
      views: 0,
      objects: 10,
      dataSize: 1024,
      storageSize: 4096,
      indexSize: 512,
      raw: '{"db":"shop"}',
    },
    invalid: {
      collections: 2,
      views: 0,
      objects: 10,
      dataSize: 1024,
      storageSize: 4096,
      indexSize: 512,
      raw: { db: 'shop' },
    },
  },

  'coll.list': {
    valid: {
      collections: [
        { name: 'orders', type: 'collection', raw: '{"name":"orders"}' },
        { name: 'open_orders', type: 'view', viewOn: 'orders', raw: '{"name":"open_orders"}' },
      ],
    },
    invalid: { collections: [{ name: 'orders', type: 'table', raw: '{}' }] },
  },
  'coll.create': { valid: {}, invalid: null },
  'coll.drop': { valid: {}, invalid: null },
  'coll.rename': { valid: {}, invalid: null },
  'coll.stats': {
    valid: { count: 3, size: 300, storageSize: 4096, totalIndexSize: 4096, nindexes: 1, raw: '{}' },
    invalid: {
      count: 3,
      size: 300,
      storageSize: 4096,
      totalIndexSize: 4096,
      nindexes: 1.5,
      raw: '{}',
    },
  },
  'coll.validator.get': {
    valid: { validator: null, validationLevel: 'off', validationAction: 'warn' },
    invalid: {
      validator: { $jsonSchema: {} },
      validationLevel: 'strict',
      validationAction: 'error',
    },
  },
  'coll.validator.set': { valid: {}, invalid: null },
  'coll.validator.check': {
    valid: { invalid: '[]', hasValidator: true },
    invalid: { invalid: '[]' },
  },

  'docs.find': { valid: { streamId: 's1' }, invalid: { streamId: '' } },
  'docs.count': { valid: { count: 0 }, invalid: { count: -1 } },
  'docs.estimatedCount': { valid: { count: 12 }, invalid: { count: '12' } },
  'docs.get': {
    valid: { doc: `{"_id":${OID}}`, sliced: [] },
    invalid: { doc: `{"_id":${OID}}`, sliced: [{ path: '', total: 1, loaded: 1 }] },
  },
  'docs.getSlice': {
    valid: { items: '[{"$numberInt":"1"}]', total: 2000 },
    invalid: { items: [1], total: 2000 },
  },
  'docs.insert': {
    valid: { insertedIds: [OID, '"custom-id"'] },
    invalid: { insertedIds: [{ $oid: '64b7f0c2a1b2c3d4e5f60718' }] },
  },
  'docs.update': { valid: { modified: false }, invalid: { modified: 1 } },
  'docs.replace': { valid: { modified: true }, invalid: {} },
  'docs.delete': { valid: { deleted: true }, invalid: { deleted: 'yes' } },
  'docs.previewMany': {
    valid: { matched: 2, sample: [`{"_id":${OID}}`] },
    invalid: { matched: 2, sample: [{ _id: 1 }] },
  },
  'docs.updateMany': { valid: { matched: 2, modified: 1 }, invalid: { matched: 2 } },
  'docs.deleteMany': { valid: { deleted: 2 }, invalid: { deleted: 2.5 } },

  'agg.run': { valid: { streamId: 's2' }, invalid: {} },
  'agg.previewStage': { valid: { docs: ['{}'] }, invalid: { docs: [{}] } },
  'agg.explain': {
    valid: { explain: '{"queryPlanner":{}}' },
    invalid: { explain: { queryPlanner: {} } },
  },
  'agg.createView': { valid: {}, invalid: null },

  'idx.list': {
    valid: { indexes: [INDEX] },
    invalid: { indexes: [{ ...INDEX, key: { status: 1 } }] },
  },
  'idx.stats': {
    valid: {
      indexes: [{ name: '_id_', sizeBytes: 4096, accesses: 7, since: '2026-01-01T00:00:00Z' }],
    },
    invalid: { indexes: [{ name: '_id_', sizeBytes: -1 }] },
  },
  'idx.create': { valid: { name: 'status_1' }, invalid: { name: 1 } },
  'idx.drop': { valid: {}, invalid: null },
  'idx.hide': { valid: {}, invalid: null },

  'schema.analyze': {
    valid: {
      sampled: 2,
      fields: [
        {
          path: 'status',
          probability: 1,
          count: 2,
          types: [{ bsonType: 'string', probability: 0.5, count: 1, examples: '["open"]' }],
        },
      ],
    },
    invalid: {
      sampled: 2,
      fields: [
        {
          path: 'status',
          probability: 1.5,
          count: 2,
          types: [{ bsonType: 'string', probability: 0.5, count: 1, examples: ['open'] }],
        },
      ],
    },
  },

  'io.export': { valid: { streamId: null, path: null }, invalid: { streamId: 's3' } },
  'io.previewImport': {
    valid: {
      fileToken: 'tok-1',
      fileName: 'orders.csv',
      sizeBytes: 2048,
      sample: ['{"a":"1"}'],
      csvColumns: ['a'],
    },
    invalid: { fileToken: 'tok-1', fileName: 'orders.json', sizeBytes: 2048, sample: [{ a: 1 }] },
  },
  'io.import': { valid: { streamId: 's4' }, invalid: { streamId: 4 } },

  'gridfs.buckets': {
    valid: { buckets: [{ name: 'fs', files: 3, hasChunks: true }] },
    invalid: { buckets: [{ name: 'fs', files: -1, hasChunks: true }] },
  },
  'gridfs.files': {
    valid: {
      files: [
        {
          id: '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}',
          filename: 'a.pdf',
          length: 10,
          chunkSize: 261120,
          uploadDate: '2026-01-01T00:00:00.000Z',
          contentType: 'application/pdf',
          metadata: '{"owner":"x"}',
        },
      ],
      total: 1,
    },
    invalid: {
      files: [{ id: '', filename: 'a', length: 1, chunkSize: 1, uploadDate: '' }],
      total: 1,
    },
  },
  'gridfs.download': {
    valid: { streamId: 's7', path: '/tmp/a.pdf' },
    invalid: { streamId: '', path: null },
  },
  'gridfs.upload': {
    valid: { streamId: null, fileName: null, sizeBytes: null },
    invalid: { streamId: 's8', fileName: 'a.pdf' },
  },
  'gridfs.delete': { valid: { deleted: true }, invalid: { deleted: 'yes' } },

  'shell.open': { valid: { sessionId: 'sh1', db: 'test' }, invalid: { sessionId: '', db: 'test' } },
  'shell.eval': { valid: { streamId: 's5' }, invalid: null },
  'shell.complete': {
    valid: { completions: ['db.orders'] },
    invalid: { completions: 'db.orders' },
  },
  'shell.close': { valid: {}, invalid: null },

  'admin.currentOp': {
    valid: { ops: ['{"opid":{"$numberInt":"1"}}'] },
    invalid: { ops: [{ opid: 1 }] },
  },
  'admin.killOp': { valid: {}, invalid: null },
  'admin.users': { valid: { users: [] }, invalid: { users: [{ user: 'example' }] } },
  'admin.roles': { valid: { roles: ['{"role":"read"}'] }, invalid: { roles: ['read'] } },
  'admin.serverStatus': { valid: { status: '{"ok":1}' }, invalid: { status: { ok: 1 } } },
  'admin.watch': { valid: { streamId: 's6' }, invalid: { stream: 's6' } },

  'pipelines.list': {
    valid: { pipelines: [SAVED_PIPELINE] },
    invalid: {
      pipelines: [{ ...SAVED_PIPELINE, stages: [{ stage: { $match: {} }, enabled: true }] }],
    },
  },
  'pipelines.save': {
    valid: { saved: SAVED_PIPELINE },
    invalid: { saved: { ...SAVED_PIPELINE, updatedAt: 'yesterday' } },
  },
  'pipelines.rename': {
    valid: { saved: { ...SAVED_PIPELINE, name: 'Renamed' } },
    invalid: { saved: { ...SAVED_PIPELINE, name: '' } },
  },
  'pipelines.delete': { valid: {}, invalid: null },
  'history.list': {
    valid: { entries: [{ query: QUERY, at: AT }], favorites: [FAVORITE] },
    invalid: { entries: [{ query: { filter: '{}' }, at: AT }], favorites: [] },
  },
  'history.add': { valid: { entries: [] }, invalid: { entries: [{ at: AT }] } },
  'history.clear': { valid: { entries: [] }, invalid: { entries: null } },
  'history.saveFavorite': {
    valid: { favorites: [FAVORITE] },
    invalid: { favorites: [{ id: 'f1' }] },
  },
  'history.deleteFavorite': { valid: { favorites: [] }, invalid: {} },

  'app.settings.get': {
    valid: { settings: SETTINGS },
    invalid: { settings: { ...SETTINGS, pageSize: 25 } },
  },
  'app.settings.set': {
    valid: { settings: { ...SETTINGS, style: 'tron' } },
    invalid: { settings: { style: 'tron' } },
  },
  'app.theme': {
    valid: { style: 'tron', mode: 'system', effective: 'dark' },
    invalid: { style: 'tron', mode: 'system', effective: 'system' },
  },
  'app.checkForUpdate': {
    valid: {
      current: '0.1.0',
      latest: '0.2.0',
      updateAvailable: true,
      url: 'https://example.test/r',
    },
    invalid: { current: '0.1.0', latest: null, updateAvailable: 'no', url: null },
  },
  'app.ping': {
    valid: { process: 'main', version: '0.1.0' },
    invalid: { process: 'backend', version: '0.1.0' },
  },
  'backend.ping': {
    valid: { process: 'backend', pid: 4242, mainReachable: true },
    invalid: { process: 'backend', pid: 0, mainReachable: true },
  },
  'backend.sleep': { valid: { sleptMs: 50 }, invalid: { sleptMs: -1 } },
};

/** Data payload samples of every streaming method (the type forces one per stream method). */
const STREAMS: { [M in StreamMethodName]: { valid: StreamDataOf<M>[]; invalid: unknown[] } } = {
  'docs.find': {
    valid: [{ docs: [] }, { docs: [`{"_id":${OID}}`] }],
    invalid: [{ docs: [{ _id: 1 }] }, { docs: '[]' }, {}],
  },
  'agg.run': { valid: [{ docs: ['{}'] }], invalid: [{ docs: ['[]'] }] },
  'io.export': {
    valid: [{ processed: 10, failed: 0, errors: [] }],
    invalid: [{ processed: -1, failed: 0, errors: [] }],
  },
  'gridfs.download': {
    valid: [{ bytes: 10, totalBytes: 20 }],
    invalid: [{ bytes: -1, totalBytes: 20 }],
  },
  'gridfs.upload': {
    valid: [{ bytes: 20, totalBytes: 20, fileId: '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}' }],
    invalid: [{ bytes: 20 }],
  },
  'io.import': {
    valid: [
      {
        processed: 10,
        failed: 1,
        errors: [{ index: 3, error: { code: 'SERVER_ERROR', message: 'duplicate key' } }],
      },
    ],
    invalid: [
      { processed: 10, failed: 1, errors: [{ index: 3, error: { code: 'DUP', message: 'x' } }] },
    ],
  },
  'shell.eval': {
    valid: [
      { kind: 'print', text: 'hello' },
      { kind: 'result', value: '{"$numberInt":"3"}', text: '3', type: 'number' },
      { kind: 'result', text: 'undefined' },
      { kind: 'error', text: 'ReferenceError: x is not defined' },
      { kind: 'db', db: 'admin' },
    ],
    invalid: [{ kind: 'result', value: 3, text: '3' }, { kind: 'print' }, { kind: 'db' }],
  },
  'admin.watch': {
    valid: [{ event: '{"operationType":"insert"}' }],
    invalid: [{ event: { operationType: 'insert' } }, {}],
  },
};

const table: Record<string, MethodDef> = methods;

describe('result schemas', () => {
  it('has a result sample for exactly the methods of the contract', () => {
    expect(Object.keys(RESULTS).sort()).toEqual([...METHOD_NAMES].sort());
  });

  it.each(METHOD_NAMES)('%s accepts a well-formed result', (name) => {
    const parsed = parseResult(name, RESULTS[name].valid);
    expect(parsed.ok ? 'ok' : parsed.error.message).toBe('ok');
  });

  it.each(METHOD_NAMES)(
    '%s rejects a malformed result as INTERNAL with a readable message',
    (name) => {
      const parsed = parseResult(name, RESULTS[name].invalid);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.code).toBe('INTERNAL');
      expect(parsed.error.message).toMatch(
        new RegExp(`^Invalid result for ${name.replace(/\./g, '\\.')}:\\n✖ `),
      );
      expect(parsed.error.message).not.toContain('[object Object]');
      expect(Array.isArray(parsed.error.detail)).toBe(true);
    },
  );

  it.each(METHOD_NAMES)('%s tolerates unknown result keys (forward compatible)', (name) => {
    const valid: unknown = RESULTS[name].valid;
    if (valid === null || typeof valid !== 'object') return;
    expect(parseResult(name, { ...valid, addedInALaterVersion: 1 }).ok).toBe(true);
  });

  it('nullable results accept null only where a dialog can be cancelled', () => {
    const nullable = METHOD_NAMES.filter((name) => parseResult(name, null).ok);
    expect(nullable.sort()).toEqual(['io.previewImport', 'profiles.importCompass']);
  });
});

describe('stream schemas', () => {
  it('every method with a stream has stream samples', () => {
    const streaming = METHOD_NAMES.filter((name) => table[name]?.stream !== undefined);
    expect(streaming.sort()).toEqual(Object.keys(STREAMS).sort());
  });

  it.each(Object.keys(STREAMS) as StreamMethodName[])('%s data payloads validate', (name) => {
    const stream = table[name]?.stream;
    if (!stream) throw new Error(`${name} has no stream`);
    for (const payload of STREAMS[name].valid) {
      const parsed = stream.safeParse(payload);
      expect([JSON.stringify(payload), parsed.success]).toEqual([JSON.stringify(payload), true]);
    }
    for (const payload of STREAMS[name].invalid) {
      expect([JSON.stringify(payload), stream.safeParse(payload).success]).toEqual([
        JSON.stringify(payload),
        false,
      ]);
    }
  });

  it('end and error events carry their payloads', () => {
    expect(streamEnd.safeParse({ delivered: 0 }).success).toBe(true);
    expect(streamEnd.safeParse({ delivered: -1 }).success).toBe(false);
    expect(streamEnd.safeParse({ delivered: 1.5 }).success).toBe(false);
    expect(streamError).toBe(errorInfo);
    expect(streamError.safeParse({ code: 'CANCELLED', message: 'cancelled by user' }).success).toBe(
      true,
    );
    expect(event.safeParse({ stream: 's', kind: 'end', payload: { delivered: 3 } }).success).toBe(
      true,
    );
    expect(event.safeParse({ stream: '', kind: 'end', payload: {} }).success).toBe(false);
    expect(cancel.safeParse({ cancel: '' }).success).toBe(false);
  });
});

describe('write params', () => {
  it.each(WRITE_METHODS)(
    '%s accepts confirmed false and rejects a non-boolean confirmed',
    (name) => {
      const params = table[name]?.params;
      if (!(params instanceof z.ZodObject)) throw new Error(`${name} params are not an object`);
      const shape = params.shape as Record<string, z.ZodType>;
      const confirmed = shape['confirmed'];
      expect(confirmed?.safeParse(false).success).toBe(true);
      for (const value of [null, 1, 'true', {}]) {
        expect(confirmed?.safeParse(value).success).toBe(false);
      }
    },
  );

  it.each(WRITE_METHODS)('%s rejects an empty profileId with a readable message', (name) => {
    const parsed = parseParams(name, { profileId: '' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('profileId must be a non-empty string');
    expect(parsed.error.message).toContain('→ at profileId');
  });

  it.each(WRITE_METHODS)('%s rejects a misspelt confirm key', (name) => {
    const parsed = parseParams(name, { profileId: P, confirm: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('Unrecognized key: "confirm"');
  });

  it('agg.run is a read without confirmed', () => {
    expect(parseParams('agg.run', { ...NS, pipeline: '[{"$match":{}}]' }).ok).toBe(true);
    expect(table['agg.run']?.write).toBe('conditional');
  });

  it('shell.eval is not a contract write', () => {
    expect(WRITE_METHODS).not.toContain('shell.eval');
    expect(parseParams('shell.eval', { sessionId: 's1', code: '1', confirmed: true }).ok).toBe(
      false,
    );
  });
});

describe('readable params messages', () => {
  it('conn.test rejects both profileId and profile', () => {
    const parsed = parseParams('conn.test', { profileId: P, profile: PROFILE });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('exactly one of profileId or profile');
    expect(parseParams('conn.test', { profile: { ...PROFILE, id: undefined } }).ok).toBe(true);
  });

  it('reports array positions as string path segments', () => {
    const parsed = parseParams('docs.insert', { ...NS, docs: ['{}', '[1]'] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('→ at docs[1]');
    expect(parsed.error.detail).toEqual([
      {
        path: ['docs', '1'],
        message: 'document must be canonical EJSON text of a document (starting with "{")',
      },
    ]);
  });

  it('reports every problem of a request, not only the first', () => {
    const parsed = parseParams('docs.find', { profileId: '', db: '', coll: '', filter: 'x' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const paths = (parsed.error.detail as { path: string[] }[]).map((d) => d.path.join('.'));
    expect(paths.sort()).toEqual(['coll', 'db', 'filter', 'profileId']);
    expect(parsed.error.message).toContain('db must be a non-empty database name');
    expect(parsed.error.message).toContain('coll must be a non-empty collection name');
  });

  it('names unknown keys inside nested strict objects', () => {
    const parsed = parseParams('profiles.save', {
      profile: { ...PROFILE, auth: { mechanism: 'NONE', secretMode: 'none', pasword: 'x' } },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('pasword');
    expect(parsed.error.message).toContain('→ at profile.auth');
  });

  it('names the expected discriminator values', () => {
    const parsed = parseParams('io.export', {
      ...NS,
      source: { kind: 'table' },
      format: 'json',
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toMatch(/find.*aggregate/);
  });

  it('docs.updateMany explains that update must be EJSON text of a document or pipeline', () => {
    const parsed = parseParams('docs.updateMany', { ...NS, filter: '{}', update: 'x' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain('→ at update');
    // The message must tell the caller what is expected, not only "Invalid input".
    expect(parsed.error.message).toContain('EJSON');
  });

  it('docs.updateMany accepts both an update document and an update pipeline', () => {
    const base = { ...NS, filter: '{}' };
    expect(parseParams('docs.updateMany', { ...base, update: '{"$set":{"a":1}}' }).ok).toBe(true);
    expect(parseParams('docs.updateMany', { ...base, update: '[{"$set":{"a":1}}]' }).ok).toBe(true);
    expect(parseParams('docs.updateMany', { ...base, update: { $set: { a: 1 } } }).ok).toBe(false);
  });

  it('docs.find rejects after together with before', () => {
    const base = { ...NS, filter: '{}' };
    expect(parseParams('docs.find', { ...base, after: '{"_id":1}' }).ok).toBe(true);
    expect(parseParams('docs.find', { ...base, before: '{"_id":1}', limit: 20 }).ok).toBe(true);
    const parsed = parseParams('docs.find', { ...base, after: '{"_id":1}', before: '{"_id":9}' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('at most one of after or before');
  });

  it('docs.find rejects skip together with range paging', () => {
    const base = { ...NS, filter: '{}' };
    expect(parseParams('docs.find', { ...base, skip: 40, limit: 20 }).ok).toBe(true);
    for (const range of [{ after: '{"_id":1}' }, { before: '{"_id":1}' }]) {
      const parsed = parseParams('docs.find', { ...base, skip: 20, ...range });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.message).toContain('skip or range paging (after/before), not both');
      }
    }
  });
});

describe('profile connection strings', () => {
  const save = (connectionString: string) =>
    parseParams('profiles.save', { profile: { ...PROFILE, connectionString } });

  it('accepts connection strings without userinfo or with a username only', () => {
    for (const uri of [
      'mongodb://db.example.test:27017',
      'mongodb://alice@db.example.test:27017/?authSource=admin',
      'mongodb://alice@h1.example.test:27017,h2.example.test:27018/shop?replicaSet=rs0',
      'mongodb+srv://alice@cluster0.example.test/?retryWrites=true',
      'mongodb+srv://cluster0.example.test',
      'mongodb://h1.example.test:27017,h2.example.test:27018?w=majority',
      'mongodb://db.example.test/?authMechanismProperties=SERVICE_NAME:mongodb',
    ]) {
      expect([uri, hasPassword(uri), save(uri).ok]).toEqual([uri, false, true]);
    }
  });

  it('rejects a password in the userinfo with a readable message', () => {
    for (const uri of [
      'mongodb://alice:pw@db.example.test:27017',
      'mongodb://alice:@db.example.test',
      'mongodb://alice:pw@h1.example.test:27017,h2.example.test:27018/shop?replicaSet=rs0',
      'mongodb+srv://alice:pw@cluster0.example.test/?retryWrites=true',
      'mongodb://alice:p%40w@db.example.test?tls=true',
    ]) {
      expect([uri, hasPassword(uri)]).toEqual([uri, true]);
      const parsed = save(uri);
      expect([uri, parsed.ok]).toEqual([uri, false]);
      if (parsed.ok) continue;
      expect(parsed.error.message).toContain('connectionString must not contain a password');
      expect(parsed.error.message).toContain('→ at profile.connectionString');
      expect(parsed.error.message).not.toContain(':pw@');
    }
  });

  it('ignores "@" and ":" outside the authority (query, path, fragment) and in IPv6 hosts', () => {
    for (const uri of [
      'mongodb://db.example.test/?appName=a@b:c',
      'mongodb://db.example.test/shop@x:y',
      'mongodb://db.example.test/#frag:x@y',
      'mongodb://alice@h1.example.test:1,h2.example.test:2/?authMechanismProperties=A:B&x=y@z',
      'mongodb://[::1]:27017',
      'mongodb://alice@[::1]:27017,[fe80::1]:27018/?replicaSet=rs0',
      'mongodb://alice%40corp.example.test@db.example.test',
      'mongodb://alice%3Apw@db.example.test',
      'mongodb://',
    ]) {
      expect([uri, hasPassword(uri)]).toEqual([uri, false]);
    }
    for (const uri of [
      'mongodb://[::1]:27017',
      'mongodb://alice@[::1]:27017,[fe80::1]:27018/?replicaSet=rs0',
      'mongodb://db.example.test/?appName=a@b:c',
    ]) {
      expect([uri, save(uri).ok]).toEqual([uri, true]);
    }
  });

  it('detects a password with an empty username, an unescaped "@", IPv6 hosts or an srv URI', () => {
    for (const uri of [
      'mongodb://:pw@db.example.test',
      'mongodb://alice:p@ss@db.example.test',
      'mongodb://alice:pw@[::1]:27017,[fe80::1]:27018',
      'mongodb+srv://alice:pw@cluster0.example.test',
      'mongodb+srv://alice:pw@cluster0.example.test/shop?appName=x@y',
    ]) {
      expect([uri, hasPassword(uri), save(uri).ok]).toEqual([uri, true, false]);
    }
  });

  it('rejects a password in results and drafts too', () => {
    const leaked = { ...PROFILE, connectionString: 'mongodb://alice:pw@db.example.test' };
    expect(parseResult('profiles.list', { profiles: [leaked] }).ok).toBe(false);
    expect(parseResult('profiles.importUris', { imported: [leaked], skipped: [] }).ok).toBe(false);
    expect(parseParams('conn.test', { profile: { ...leaked, id: undefined } }).ok).toBe(false);
  });
});

describe('import results (profiles.importCompass / importUris)', () => {
  const notice = { source: 'Encrypted prod', reason: 'credentials are encrypted' };

  it('accept optional notices next to imported and skipped', () => {
    for (const method of ['profiles.importCompass', 'profiles.importUris'] as const) {
      expect(parseResult(method, { imported: [PROFILE], skipped: [] }).ok).toBe(true);
      expect(parseResult(method, { imported: [PROFILE], skipped: [], notices: [] }).ok).toBe(true);
      expect(
        parseResult(method, { imported: [PROFILE], skipped: [notice], notices: [notice] }).ok,
      ).toBe(true);
    }
    expect(parseResult('profiles.importCompass', null).ok).toBe(true);
    expect(parseResult('profiles.importUris', null).ok).toBe(false);
  });

  it('reject malformed notices', () => {
    for (const notices of [
      [{ source: 'x' }],
      [{ reason: 'y' }],
      [{ source: 1, reason: 'y' }],
      'none',
      null,
    ]) {
      expect(parseResult('profiles.importUris', { imported: [], skipped: [], notices }).ok).toBe(
        false,
      );
    }
  });
});

describe('profiles.chooseFile', () => {
  it('is served by main and takes a known purpose', () => {
    expect(route('profiles.chooseFile')).toBe('main');
    for (const purpose of ['tlsCaFile', 'tlsCertificateKeyFile', 'sshPrivateKeyFile']) {
      expect(parseParams('profiles.chooseFile', { purpose }).ok).toBe(true);
    }
    expect(parseParams('profiles.chooseFile', {}).ok).toBe(false);
    expect(parseParams('profiles.chooseFile', { purpose: 'exportFile' }).ok).toBe(false);
    expect(parseResult('profiles.chooseFile', { path: '/home/alice/ca.pem' }).ok).toBe(true);
    expect(parseParams('profiles.chooseFile', { purpose: 'tlsCaFile', path: '/x' }).ok).toBe(false);
  });

  it('returns null as the path when the dialog was cancelled', () => {
    expect(parseResult('profiles.chooseFile', { path: null }).ok).toBe(true);
    expect(parseResult('profiles.chooseFile', {}).ok).toBe(false);
  });
});

describe('EJSON text helpers', () => {
  it('ejsonDocument accepts only text starting with "{"', () => {
    const schema = ejsonDocument('probe');
    expect(ejsonSchemas.get(schema)).toBe('document');
    expect(schema.safeParse('{}').success).toBe(true);
    expect(schema.safeParse('\n\t {"a":1}').success).toBe(true);
    for (const value of ['', '   ', '[]', '"x"', 'null', {}, null, 1]) {
      expect([value, schema.safeParse(value).success]).toEqual([value, false]);
    }
    expect(schema.safeParse('[]').error?.issues[0]?.message).toBe(
      'probe must be canonical EJSON text of a document (starting with "{")',
    );
  });

  it('ejsonArray accepts only text starting with "["', () => {
    const schema = ejsonArray('probe');
    expect(ejsonSchemas.get(schema)).toBe('array');
    expect(schema.safeParse('[]').success).toBe(true);
    expect(schema.safeParse(' [1]').success).toBe(true);
    for (const value of ['', '{}', [], null]) {
      expect([value, schema.safeParse(value).success]).toEqual([value, false]);
    }
    expect(schema.safeParse('{}').error?.issues[0]?.message).toBe(
      'probe must be canonical EJSON text of an array (starting with "[")',
    );
  });

  it('ejsonDocumentOrArray accepts text starting with "{" or "["', () => {
    const schema = ejsonDocumentOrArray('probe');
    expect(ejsonSchemas.get(schema)).toBe('documentOrArray');
    for (const value of ['{}', ' [1]', '\n{"$set":{}}']) {
      expect([value, schema.safeParse(value).success]).toEqual([value, true]);
    }
    for (const value of ['', '   ', '"x"', 'null', {}, [], null]) {
      expect([value, schema.safeParse(value).success]).toEqual([value, false]);
    }
    expect(schema.safeParse('x').error?.issues[0]?.message).toBe(
      'probe must be canonical EJSON text of a document (starting with "{") or an array (starting with "[")',
    );
    expect(ejsonDocumentOrArray().safeParse('x').error?.issues[0]?.message).toContain(
      'EJSON document or array',
    );
  });

  it('ejsonValue rejects whitespace-only text with a readable message', () => {
    const schema = ejsonValue('probe');
    for (const value of ['   ', '\n\t']) {
      expect(schema.safeParse(value).error?.issues[0]?.message).toBe(
        'probe must be non-empty canonical EJSON text',
      );
    }
    expect(parseParams('docs.get', { ...NS, id: '  ' }).ok).toBe(false);
  });

  it('ejsonValue accepts any non-empty text and nothing else', () => {
    const schema = ejsonValue('probe');
    expect(ejsonSchemas.get(schema)).toBe('value');
    for (const value of ['"abc"', OID, '{"$numberInt":"1"}', 'null', '[1]']) {
      expect(schema.safeParse(value).success).toBe(true);
    }
    for (const value of ['', 1, null, { $oid: 'x' }]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
    expect(schema.safeParse('').error?.issues[0]?.message).toBe(
      'probe must be non-empty canonical EJSON text',
    );
  });

  it('uses a default description when none is given', () => {
    expect(ejsonDocument().safeParse('x').error?.issues[0]?.message).toContain('EJSON document');
    expect(ejsonArray().safeParse('x').error?.issues[0]?.message).toContain('EJSON array');
    expect(ejsonValue().safeParse('').error?.issues[0]?.message).toContain('EJSON value');
  });
});

describe('error payloads', () => {
  it('CONFLICT detail carries the current document as EJSON text or null', () => {
    expect(conflictDetail.safeParse({ current: `{"_id":${OID}}` }).success).toBe(true);
    expect(conflictDetail.safeParse({ current: null }).success).toBe(true);
    expect(conflictDetail.safeParse({ current: { _id: 1 } }).success).toBe(false);
    expect(conflictDetail.safeParse({}).success).toBe(false);
  });

  it('SERVER_ERROR detail has an integer server code and a code name', () => {
    expect(
      serverErrorDetail.safeParse({ serverCode: 11000, codeName: 'DuplicateKey' }).success,
    ).toBe(true);
    expect(serverErrorDetail.safeParse({}).success).toBe(true);
    expect(serverErrorDetail.safeParse({ serverCode: 1.5 }).success).toBe(false);
  });

  it('error summaries have a known code and a message', () => {
    expect(
      errorSummary.safeParse({ code: 'NOT_CONNECTED', message: 'not connected' }).success,
    ).toBe(true);
    expect(errorSummary.safeParse({ code: 'NOT_CONNECTED' }).success).toBe(false);
    expect(errorInfo.safeParse({ code: 'nope', message: 'x' }).success).toBe(false);
  });
});

describe('method names', () => {
  it('isMethodName only knows own contract methods', () => {
    expect(isMethodName('docs.find')).toBe(true);
    expect(isMethodName('app.settings.set')).toBe(true);
    for (const name of [
      'toString',
      '__proto__',
      'hasOwnProperty',
      'docs',
      'docs.find ',
      'DOCS.FIND',
    ]) {
      expect([name, isMethodName(name)]).toEqual([name, false]);
    }
  });

  it('routes io.* to the backend (it asks main for the native dialog)', () => {
    expect(route('io.import')).toBe('backend');
    expect(route('io.previewImport')).toBe('backend');
    expect(route('io.export')).toBe('backend');
    expect(route('conn.test')).toBe('backend');
  });
});

describe('CSV import and export params', () => {
  const IMPORT = { ...NS, fileToken: 'tok-1' };
  const entry = { column: 'qty', path: 'stock.qty', bsonType: 'int' };

  it('io.import accepts a csvMapping entry with or without its header index', () => {
    expect(parseParams('io.import', { ...IMPORT, csvMapping: [entry] }).ok).toBe(true);
    expect(parseParams('io.import', { ...IMPORT, csvMapping: [{ ...entry, index: 0 }] }).ok).toBe(
      true,
    );
    expect(
      parseParams('io.import', { ...IMPORT, csvMapping: [{ ...entry, column: '', index: 7 }] }).ok,
    ).toBe(true);
  });

  it.each(CSV_TYPES)('io.import accepts the CSV type %s', (bsonType) => {
    expect(parseParams('io.import', { ...IMPORT, csvMapping: [{ ...entry, bsonType }] }).ok).toBe(
      true,
    );
  });

  it.each([
    ['a negative index', { ...entry, index: -1 }],
    ['a fractional index', { ...entry, index: 1.5 }],
    ['an index as text', { ...entry, index: '2' }],
    ['a type that is no CSV type', { ...entry, bsonType: 'integer' }],
    ['an empty path', { ...entry, path: '' }],
    ['an unknown key', { ...entry, type: 'int' }],
  ])('io.import refuses a csvMapping entry with %s', (_what, bad) => {
    expect(parseParams('io.import', { ...IMPORT, csvMapping: [bad] }).ok).toBe(false);
  });

  it('io.import refuses an empty csvMapping (no column would be imported)', () => {
    expect(parseParams('io.import', { ...IMPORT, csvMapping: [] }).ok).toBe(false);
  });

  it('io.export refuses empty csvFields and an empty field path', () => {
    const base = { ...NS, source: { kind: 'find', filter: '{}' }, format: 'csv' };
    expect(parseParams('io.export', { ...base, csvFields: ['_id', 'address.city'] }).ok).toBe(true);
    expect(parseParams('io.export', { ...base, csvFields: [] }).ok).toBe(false);
    expect(parseParams('io.export', { ...base, csvFields: [''] }).ok).toBe(false);
  });
});
