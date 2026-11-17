import { MongoClient } from 'mongodb';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { FIXTURE_NAMES, FIXTURE_SPECS } from './fixtures/mongo.ts';

const clients: MongoClient[] = [];
function client(uri: string, options: ConstructorParameters<typeof MongoClient>[1] = {}) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000, ...options });
  clients.push(c);
  return c;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe('MongoDB fixtures', () => {
  const mongo = inject('mongo');
  const tlsCAFile = inject('tlsCaFile');

  it.each(FIXTURE_NAMES)('%s accepts a Node driver connection', async (name) => {
    const fixture = mongo[name];
    const spec = FIXTURE_SPECS[name];
    const c = client(fixture.uri, fixture.tls ? { tls: true, tlsCAFile } : {});
    const db = c.db('admin');

    expect((await db.command({ ping: 1 }))['ok']).toBe(1);
    const { version } = await db.command({ buildInfo: 1 });
    expect(String(version).split('.')[0]).toBe(spec.version);

    const hello = await db.command({ hello: 1 });
    expect(hello['setName']).toBe(spec.replicaSet ? 'rs0' : undefined);

    const coll = c.db('fixture_smoke').collection(`t_${name}`);
    await coll.insertOne({ name });
    expect(await coll.countDocuments({ name })).toBe(1);
  });

  // mongod 8.2 crashes (SIGSEGV) ~30 s after start with TCMalloc's background thread on; the 8.x
  // fixtures pass MONGOD_8_ARGS. 7.0 lacks the parameter and must start without it.
  it.each(FIXTURE_NAMES)(
    '%s runs with TCMalloc background thread off on 8.x only',
    async (name) => {
      const fixture = mongo[name];
      const spec = FIXTURE_SPECS[name];
      const c = client(fixture.uri, fixture.tls ? { tls: true, tlsCAFile } : {});
      const admin = c.db('admin');
      if (spec.version === '8') {
        const reply = await admin.command({ getParameter: 1, tcmallocEnableBackgroundThread: 1 });
        expect(reply['tcmallocEnableBackgroundThread']).toBe(false);
      } else {
        const { argv } = await admin.command({ getCmdLineOpts: 1 });
        expect((argv as string[]).join(' ')).not.toContain('tcmallocEnableBackgroundThread');
      }
    },
  );

  it('replica set fixture supports transactions', async () => {
    const c = client(mongo.mongo8rs.uri);
    const coll = c.db('fixture_smoke').collection('tx');
    await coll.insertOne({ seed: true });
    await c.withSession((session) =>
      session.withTransaction(async () => {
        await coll.insertOne({ inTx: true }, { session });
      }),
    );
    expect(await coll.countDocuments({ inTx: true })).toBe(1);
  });
});
