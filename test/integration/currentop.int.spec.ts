import { randomBytes } from 'node:crypto';

import { BSON, MongoClient, MongoServerError, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  currentOpHandlers,
  guardWrites,
  RpcClient,
  RpcError,
  serve,
} from '@thicket/backend';
import { methods, type MethodName, type Profile, type ResultOf } from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// admin.currentOp / admin.killOp (task currentop) against the 8.x standalone fixture: a slow
// find (server-side `$where` with `sleep`) is listed with the filters and killed, served like
// the backend serves them (contract validation, write guard).

const mongo = inject('mongo');
const fixture = mongo.mongo8;

const PROFILE: Profile = {
  id: 'currentop-p',
  name: 'CurrentOp',
  connectionString: fixture.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};
const READ_ONLY: Profile = { ...PROFILE, id: 'currentop-ro', readOnly: true };

const DB = `curop_${randomBytes(3).toString('hex')}`;
const COLL = 'slow';

let direct: MongoClient;
let manager: ConnectionManager;
let rpc: RpcClient;
let stop: () => void;

const call = <M extends MethodName>(method: M, params: unknown) =>
  rpc.call(method, params) as Promise<ResultOf<M>>;

const parse = (text: string) => BSON.EJSON.parse(text, { relaxed: false }) as Document;

const profiles = new Map([PROFILE, READ_ONLY].map((p) => [p.id, p]));
const loadProfile = (id: string) => {
  const profile = profiles.get(id);
  return profile
    ? Promise.resolve(profile)
    : Promise.reject(new RpcError('NOT_FOUND', `No profile with id ${id}`));
};

/** Starts a find that runs for minutes (each document sleeps 200 ms in `$where`). */
function startSlowFind(comment: string): Promise<unknown> {
  return direct
    .db(DB)
    .collection(COLL)
    .find({ $where: 'sleep(200); return true;' }, { comment, batchSize: 1000 })
    .toArray();
}

/** Polls `admin.currentOp` until the operation with `comment` shows up. */
async function findListed(params: Document, comment: string): Promise<Document> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { ops } = await call('admin.currentOp', { profileId: PROFILE.id, ...params });
    const op = ops
      .map(parse)
      .find((o) => (o['command'] as Document | undefined)?.['comment'] === comment);
    if (op) return op;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`operation ${comment} never showed up in currentOp`);
}

beforeAll(async () => {
  direct = await MongoClient.connect(fixture.uri);
  await direct
    .db(DB)
    .collection(COLL)
    .insertMany(Array.from({ length: 1000 }, (_, n) => ({ n })));

  manager = new ConnectionManager({ loadProfile, loadSecrets: () => Promise.resolve(null) });
  await manager.open(PROFILE.id, undefined);
  await manager.open(READ_ONLY.id, undefined);
  const [serverPort, clientPort] = portPair();
  stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: guardWrites(currentOpHandlers(manager), loadProfile),
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

describe('admin.currentOp and admin.killOp', () => {
  it('lists a slow operation with the filters and kills it', async () => {
    const comment = `slow-${randomBytes(4).toString('hex')}`;
    const slow = startSlowFind(comment);
    const outcome = slow.then(
      () => 'finished',
      (error: unknown) => error,
    );

    const op = await findListed({ ns: DB, opType: 'query' }, comment);
    expect(op['ns']).toBe(`${DB}.${COLL}`);
    expect(op['op']).toBe('query');
    expect(op['active']).toBe(true);

    // Other filters: a namespace prefix that is not on a name boundary, another op type and a
    // longer running time than the operation has don't list it.
    const listed = async (params: Document) =>
      (await call('admin.currentOp', { profileId: PROFILE.id, ...params })).ops
        .map(parse)
        .some((o) => (o['command'] as Document | undefined)?.['comment'] === comment);
    expect(await listed({ ns: DB.slice(0, -1) })).toBe(false);
    expect(await listed({ ns: `${DB}.${COLL}`, opType: 'insert' })).toBe(false);
    expect(await listed({ ns: DB, minSecsRunning: 3600 })).toBe(false);
    expect(await listed({ ns: `${DB}.${COLL}`, all: true })).toBe(true);

    // The read-only profile may look, but not kill.
    const opId = BSON.EJSON.stringify(op['opid'], { relaxed: false });
    await expect(call('admin.killOp', { profileId: READ_ONLY.id, opId })).rejects.toMatchObject({
      code: 'READ_ONLY',
    });

    await expect(call('admin.killOp', { profileId: PROFILE.id, opId })).resolves.toEqual({});
    const error = await outcome;
    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).codeName).toBe('Interrupted');

    const { ops } = await call('admin.currentOp', { profileId: PROFILE.id, ns: DB });
    expect(
      ops.map(parse).some((o) => (o['command'] as Document | undefined)?.['comment'] === comment),
    ).toBe(false);
  }, 60_000);

  it('does not list its own currentOp command', async () => {
    const { ops } = await call('admin.currentOp', { profileId: PROFILE.id, all: true });
    expect(ops.length).toBeGreaterThan(0);
    for (const text of ops) {
      const command = parse(text)['command'] as Document | undefined;
      expect(command && 'currentOp' in command).toBeFalsy();
    }
  });

  it('answers NOT_CONNECTED for a profile without an open connection', async () => {
    await expect(call('admin.currentOp', { profileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
  });
});
