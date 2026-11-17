// Captures the server stats fixtures of this folder from real servers (not part of the check).
//   docker run -d --rm -p 27991:27017 docker.io/library/mongo:8.2
//   docker run -d --rm -p 27992:27017 docker.io/library/mongo:8.2 --replSet rs0
//   node packages/renderer/src/app/admin/stats/fixtures/capture.mjs \
//     mongodb://127.0.0.1:27991 mongodb://127.0.0.1:27992
// Writes canonical EJSON without `$`-named fields, as `admin.serverStatus` / `admin.replSetStatus`
// return it: two `serverStatus` samples two seconds apart with some load in between, the
// `serverStatus` and `replSetGetStatus` of a one-member replica set. `serverStatus` is cut down to the sections the
// dashboard reads (the full output is ~100 kB of storage engine and metrics counters).
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { EJSON } from 'bson';
import { MongoClient } from 'mongodb';

const [single = 'mongodb://127.0.0.1:27991', rs = 'mongodb://127.0.0.1:27992'] =
  process.argv.slice(2);
const dir = new URL('.', import.meta.url);
const KEEP = [
  'host',
  'version',
  'process',
  'pid',
  'uptime',
  'uptimeMillis',
  'localTime',
  'asserts',
  'connections',
  'mem',
  'network',
  'opcounters',
  'opcountersRepl',
  'repl',
  'storageEngine',
  'ok',
];

const STATUS = { serverStatus: 1 };

/** `doc` without `$`-named fields at any depth, like the backend's `withoutDollarFields`. */
function withoutDollarFields(doc) {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, inner]) => [key, strip(inner)]),
    );
  };
  return strip(doc);
}

function trim(status) {
  return Object.fromEntries(KEEP.filter((k) => k in status).map((k) => [k, status[k]]));
}

async function save(name, doc) {
  const text = EJSON.stringify(withoutDollarFields(doc), undefined, 2, { relaxed: false });
  await writeFile(new URL(`${name}.json`, dir), `${text}\n`);
  console.log('wrote', name);
}

const raw = { promoteLongs: false };

const a = new MongoClient(single);
const items = a.db('stats_fixture').collection('items');
await items.insertMany(Array.from({ length: 100 }, (_, n) => ({ n })));
await save('server-status-1-8.2', trim(await a.db('admin').command(STATUS, raw)));
for (let i = 0; i < 40; i += 1) {
  await items.insertOne({ n: 1000 + i });
  await items
    .find({ n: { $gt: i } })
    .limit(5)
    .toArray();
  if (i % 4 === 0) await items.updateOne({ n: i }, { $set: { seen: true } });
  if (i % 10 === 0) await items.deleteOne({ n: 1000 + i });
}
await sleep(2000);
await save('server-status-2-8.2', trim(await a.db('admin').command(STATUS, raw)));
await a.db('stats_fixture').dropDatabase();
await a.close();

const b = new MongoClient(rs, { directConnection: true });
try {
  await b
    .db('admin')
    .command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] } });
} catch {
  // already initiated
}
for (;;) {
  const hello = await b.db('admin').command({ hello: 1 });
  if (hello.isWritablePrimary) break;
  await sleep(250);
}
await save('server-status-rs-8.2', trim(await b.db('admin').command(STATUS, raw)));
await save('repl-set-status-8.2', await b.db('admin').command({ replSetGetStatus: 1 }, raw));
await b.close();
