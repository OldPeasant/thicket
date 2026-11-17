import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  browseHandlers,
  ConnectionManager,
  RpcClient,
  RpcError,
  serve,
  statsHandlers,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// The server stats dashboard's data methods (task server-stats): admin.serverStatus,
// admin.replSetStatus and db.stats against the 8.x standalone and replica set fixtures, served
// like the backend serves them (contract validation of params and results).

const mongo = inject('mongo');

const STANDALONE: Profile = {
  id: 'stats-single',
  name: 'Stats standalone',
  connectionString: mongo.mongo8.uri,
  readOnly: true,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};
const REPLICA_SET: Profile = {
  ...STANDALONE,
  id: 'stats-rs',
  name: 'Stats replica set',
  connectionString: mongo.mongo8rs.uri,
};

const DB = `stats_${randomBytes(3).toString('hex')}`;

let direct: MongoClient;
let manager: ConnectionManager;
let rpc: RpcClient;
let stop: () => void;

const call = <M extends MethodName>(method: M, params: unknown) =>
  rpc.call(method, params) as Promise<ResultOf<M>>;

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;
const num = (value: unknown) => Number((value as { valueOf(): unknown }).valueOf());

const profiles = new Map([STANDALONE, REPLICA_SET].map((p) => [p.id, p]));
const loadProfile = (id: string) => {
  const profile = profiles.get(id);
  return profile
    ? Promise.resolve(profile)
    : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
};

beforeAll(async () => {
  direct = await MongoClient.connect(mongo.mongo8.uri);
  await direct
    .db(DB)
    .collection('items')
    .insertMany(Array.from({ length: 50 }, (_, n) => ({ n, text: 'x'.repeat(100) })));

  manager = new ConnectionManager({ loadProfile, loadSecrets: () => Promise.resolve(null) });
  await manager.open(STANDALONE.id, undefined);
  await manager.open(REPLICA_SET.id, undefined);
  const [serverPort, clientPort] = portPair();
  stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: { ...statsHandlers(manager), ...browseHandlers(manager) },
  });
  rpc = new RpcClient(clientPort);
}, 60_000);

afterAll(async () => {
  rpc.close();
  stop();
  await manager.closeAll();
  await direct
    .db(DB)
    .dropDatabase()
    .catch(() => undefined);
  await direct.close();
});

describe('server stats data methods', () => {
  it('admin.serverStatus answers the server status with the dashboard fields', async () => {
    const { status } = await call('admin.serverStatus', { profileId: STANDALONE.id });
    const doc = parse(status);
    expect(String(doc['version'])).toMatch(/^8\./);
    expect(num(doc['ok'])).toBe(1);
    expect(num(doc['uptime'])).toBeGreaterThan(0);
    const opcounters = doc['opcounters'] as Document;
    for (const key of ['insert', 'query', 'update', 'delete', 'getmore', 'command']) {
      expect(num(opcounters[key])).toBeGreaterThanOrEqual(0);
    }
    expect(num((doc['connections'] as Document)['current'])).toBeGreaterThan(0);
    expect(num((doc['mem'] as Document)['resident'])).toBeGreaterThan(0);
    expect(num((doc['network'] as Document)['bytesIn'])).toBeGreaterThan(0);
    expect(doc['localTime']).toBeInstanceOf(Date);
  });

  it('admin.serverStatus counters grow between two samples', async () => {
    const first = parse((await call('admin.serverStatus', { profileId: STANDALONE.id })).status);
    await direct.db(DB).collection('items').insertOne({ n: -1 });
    const second = parse((await call('admin.serverStatus', { profileId: STANDALONE.id })).status);
    const inserts = (doc: Document) => num((doc['opcounters'] as Document)['insert']);
    expect(inserts(second)).toBeGreaterThan(inserts(first));
  });

  it('admin.replSetStatus is null on a standalone', async () => {
    await expect(call('admin.replSetStatus', { profileId: STANDALONE.id })).resolves.toEqual({
      status: null,
    });
  });

  it('admin.replSetStatus lists the replica set members', async () => {
    const { status } = await call('admin.replSetStatus', { profileId: REPLICA_SET.id });
    expect(status).not.toBeNull();
    const doc = parse(status ?? '{}');
    expect(doc['set']).toBe(mongo.mongo8rs.replicaSet);
    const members = doc['members'] as Document[];
    expect(members.length).toBeGreaterThan(0);
    expect(members.some((m) => m['stateStr'] === 'PRIMARY')).toBe(true);
    expect(members[0]?.['optimeDate']).toBeInstanceOf(Date);
  });

  it('admin.serverStatus on the replica set reports its repl section', async () => {
    const { status } = await call('admin.serverStatus', { profileId: REPLICA_SET.id });
    expect((parse(status)['repl'] as Document)['setName']).toBe(mongo.mongo8rs.replicaSet);
  });

  it('db.stats answers the sizes of a database', async () => {
    const stats = await call('db.stats', { profileId: STANDALONE.id, db: DB });
    expect(stats.collections).toBe(1);
    expect(stats.objects).toBeGreaterThanOrEqual(50);
    expect(stats.dataSize).toBeGreaterThan(0);
    expect(stats.storageSize).toBeGreaterThan(0);
    expect(stats.indexSize).toBeGreaterThan(0);
    expect(parse(stats.raw)['db']).toBe(DB);
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    await expect(call('admin.serverStatus', { profileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    await expect(call('admin.replSetStatus', { profileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
  });
});
