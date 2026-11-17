import { randomBytes } from 'node:crypto';

import { MongoClient, type CommandStartedEvent, type Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ConnectionManager,
  RpcError,
  collectionStats,
  insertDocuments,
  listCollections,
  streamFind,
  type ClientLike,
} from '@thicket/backend';
import type { Profile } from '@thicket/contract';

import {
  PRIMARY_HOST,
  SECONDARY_HOST,
  startSocksFixture,
  type SocksFixture,
} from './fixtures/socks.ts';

// The backend's raw-command reads follow the profile's read preference and its writes the
// profile's write concern (task raw-cmd-read-pref), on the SOCKS5 two-member replica set fixture
// (rs-a primary, rs-b a priority-0 secondary). Commands are observed with command monitoring
// (`commandStarted` carries the server address) on the backend's own driver clients.

const run = randomBytes(3).toString('hex');
const DB = `rcrp_${run}`;

let socks: SocksFixture;
/** A driver client of the test (not the backend's), through the proxy, for setup and checks. */
let admin: MongoClient;

beforeAll(async () => {
  socks = await startSocksFixture();
  admin = new MongoClient(socks.uri, {
    ...socks.proxyOptions,
    serverSelectionTimeoutMS: 30_000,
    writeConcern: { w: 2, wtimeoutMS: 20_000 },
  });
  await admin.connect();
});
afterAll(async () => {
  await admin?.close();
  await socks?.stop();
});

const managers: ConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

function proxied(id: string, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `Proxy ${id}`,
    connectionString: socks.uri,
    proxy: { host: socks.proxyHost, port: socks.proxyPort, username: socks.proxyUsername },
    serverSelectionTimeoutMS: 10_000,
    readOnly: false,
    production: false,
    ...extra,
  };
}

/** Opens `profile` in a new manager whose driver client records every command it starts. */
async function openMonitored(profile: Profile) {
  const commands: CommandStartedEvent[] = [];
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === profile.id
        ? Promise.resolve(profile)
        : Promise.reject(new RpcError('NOT_FOUND', `No profile ${id}`)),
    loadSecrets: () => Promise.resolve({ proxyPassword: socks.proxyPassword }),
    createClient: (uri, options) => {
      const client = new MongoClient(uri, { ...options, monitorCommands: true });
      client.on('commandStarted', (event) => commands.push(event));
      return client;
    },
  });
  managers.push(manager);
  await manager.open(profile.id, undefined);
  const client = manager.client(profile.id) as ClientLike;
  /** `[commandName, address]` of the commands started since the last call, filtered by name. */
  const take = (...names: string[]): [string, string][] =>
    commands
      .splice(0)
      .filter((e) => names.includes(e.commandName))
      .map((e) => [e.commandName, e.address]);
  return { client, take };
}

/** A collection with `n` documents, written to both members (w: 2). */
async function seeded(name: string, n: number): Promise<string> {
  const coll = `${name}_${run}`;
  await admin
    .db(DB)
    .collection<{ _id: number; pad: string }>(coll)
    .insertMany(Array.from({ length: n }, (_, i) => ({ _id: i, pad: 'x'.repeat(64) })));
  return coll;
}

/** Open cursors on the member `host` (a direct connection through the proxy). */
async function openCursorsOn(host: string): Promise<number> {
  const direct = new MongoClient(`mongodb://${host}/?directConnection=true`, {
    ...socks.proxyOptions,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const status = await direct.db('admin').command({ serverStatus: 1 });
    const open = (status['metrics'] as Document)['cursor'] as Document;
    return Number((open['open'] as Document)['total']);
  } finally {
    await direct.close();
  }
}

function findParams(profileId: string, coll: string, batchSize: number) {
  return { profileId, db: DB, coll, filter: '{}', sort: '{"_id": 1}', batchSize };
}

describe('docs.find follows the read preference', () => {
  it('secondaryPreferred: the find and every getMore run on rs-b', async () => {
    const coll = await seeded('batches', 35);
    const p = proxied('find-secondary', { readPreference: 'secondaryPreferred' });
    const { client, take } = await openMonitored(p);
    take();
    const batches: number[] = [];
    const delivered = await streamFind(client, findParams(p.id, coll, 10), (batch) =>
      batches.push(batch.docs.length),
    );
    expect(delivered).toBe(35);
    expect(batches).toEqual([10, 10, 10, 5]);
    const sent = take('find', 'getMore', 'killCursors');
    expect(sent).toEqual([
      ['find', SECONDARY_HOST],
      ['getMore', SECONDARY_HOST],
      ['getMore', SECONDARY_HOST],
      ['getMore', SECONDARY_HOST],
    ]);
  });

  it('cancelling a multi-batch find on rs-b kills its cursor there', async () => {
    const coll = await seeded('cancel', 35);
    const p = proxied('find-cancel', { readPreference: 'secondaryPreferred' });
    const { client, take } = await openMonitored(p);
    const before = await openCursorsOn(SECONDARY_HOST);
    take();
    const abort = new AbortController();
    const running = streamFind(
      client,
      findParams(p.id, coll, 10),
      () => abort.abort(), // cancel after the first batch: the cursor is open on rs-b
      abort.signal,
    );
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    const sent = take('find', 'getMore', 'killCursors');
    expect(sent[0]).toEqual(['find', SECONDARY_HOST]);
    expect(sent).toContainEqual(['killCursors', SECONDARY_HOST]);
    expect(sent.every(([, address]) => address === SECONDARY_HOST)).toBe(true);
    // No cursor of this find is left open on rs-b.
    expect(await openCursorsOn(SECONDARY_HOST)).toBe(before);
  });

  it('cancelling while a getMore runs on rs-b kills it and its cursor there', async () => {
    const coll = await seeded('cancel_getmore', 35);
    const p = proxied('find-cancel-getmore', { readPreference: 'secondaryPreferred' });
    const { client, take } = await openMonitored(p);
    const before = await openCursorsOn(SECONDARY_HOST);
    take();
    const abort = new AbortController();
    // A slow filter (50 ms per document): every batch of 10 takes about half a second, so the
    // getMore after the first batch is still running on rs-b when the cancel comes.
    const params = { ...findParams(p.id, coll, 10), filter: '{"$where": "sleep(50) || true"}' };
    let batches = 0;
    const running = streamFind(
      client,
      params,
      () => {
        batches += 1;
        if (batches === 1) setTimeout(() => abort.abort(), 150);
      },
      abort.signal,
    );
    // streamFind awaits the cancel cleanup (op.close) before it rejects.
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(batches).toBe(1);
    const sent = take('find', 'getMore', 'currentOp', 'killOp', 'killCursors');
    expect(sent[0]).toEqual(['find', SECONDARY_HOST]);
    expect(sent).toContainEqual(['getMore', SECONDARY_HOST]);
    const kills = sent.filter(([name]) => name === 'killOp' || name === 'killCursors');
    expect(kills.length).toBeGreaterThan(0);
    expect(sent.every(([, address]) => address === SECONDARY_HOST)).toBe(true);
    // No cursor of this find is left open on rs-b.
    expect(await openCursorsOn(SECONDARY_HOST)).toBe(before);
  });

  it('primary (the default): the find and its getMores run on rs-a', async () => {
    const coll = await seeded('primary', 15);
    const p = proxied('find-primary');
    const { client, take } = await openMonitored(p);
    take();
    await streamFind(client, findParams(p.id, coll, 10), () => undefined);
    expect(take('find', 'getMore')).toEqual([
      ['find', PRIMARY_HOST],
      ['getMore', PRIMARY_HOST],
    ]);
  });
});

describe('browse reads follow the read preference', () => {
  it('listCollections and coll.stats run on rs-b with secondaryPreferred', async () => {
    const coll = await seeded('browse', 3);
    const p = proxied('browse-secondary', { readPreference: 'secondaryPreferred' });
    const { client, take } = await openMonitored(p);
    take();
    const { collections } = await listCollections(client, DB);
    expect(collections.map((c) => c.name)).toContain(coll);
    expect((await collectionStats(client, DB, coll)).count).toBe(3);
    expect(take('listCollections', 'aggregate')).toEqual([
      ['listCollections', SECONDARY_HOST],
      ['aggregate', SECONDARY_HOST],
    ]);
  });
});

describe('docs.insert carries the profile write concern', () => {
  it('w: 3 on two members answers SERVER_ERROR (write concern error)', async () => {
    const p = proxied('insert-w3', { writeConcern: { w: 3, wtimeoutMS: 2_000 } });
    const { client, take } = await openMonitored(p);
    take();
    const error = await insertDocuments(client, {
      profileId: p.id,
      db: DB,
      coll: `w3_${run}`,
      docs: ['{"marker": "w3"}'],
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'SERVER_ERROR' });
    // Two members can never satisfy w: 3. The primary applies the insert and answers a write
    // concern error, which the message says.
    expect((error as RpcError).message).toMatch(
      /applied but not acknowledged by the requested write concern: Not enough data-bearing nodes/,
    );
    expect((error as RpcError).detail).toMatchObject({ codeName: 'UnsatisfiableWriteConcern' });
    expect(await admin.db(DB).collection(`w3_${run}`).countDocuments({})).toBe(1);
    const [insert] = take('insert');
    expect(insert).toEqual(['insert', PRIMARY_HOST]);
  });

  it('w: 2: a secondary read sees the inserted document right away', async () => {
    const coll = `w2_${run}`;
    const writer = proxied('insert-w2', { writeConcern: { w: 2, wtimeoutMS: 20_000 } });
    const reader = proxied('reader-secondary', { readPreference: 'secondary' });
    const w = await openMonitored(writer);
    const r = await openMonitored(reader);
    const marker = `w2-${Date.now()}`;
    await insertDocuments(w.client, {
      profileId: writer.id,
      db: DB,
      coll,
      docs: [JSON.stringify({ marker })],
    });
    r.take();
    const docs: string[] = [];
    await streamFind(
      r.client,
      { profileId: reader.id, db: DB, coll, filter: JSON.stringify({ marker }) },
      (batch) => docs.push(...batch.docs),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toContain(marker);
    expect(r.take('find')).toEqual([['find', SECONDARY_HOST]]);
  });
});
