// Captures the explain fixtures of this folder from a real server (not part of the check).
//   docker run -d --rm -p 27999:27017 docker.io/library/mongo:8.2
//   node packages/renderer/src/app/explain/fixtures/capture.mjs mongodb://localhost:27999
// Writes canonical EJSON, as `agg.explain` returns it.
import { writeFile } from 'node:fs/promises';
import { EJSON, Decimal128 } from 'bson';
import { MongoClient } from 'mongodb';

const uri = process.argv[2] ?? 'mongodb://localhost:27999';
const dir = new URL('.', import.meta.url);
const client = new MongoClient(uri);
const db = client.db('explain_fixture');
await db.dropDatabase();
const orders = db.collection('orders');
await orders.insertMany(
  Array.from({ length: 2000 }, (_, i) => ({
    n: i,
    status: i % 4 === 0 ? 'closed' : 'open',
    customer: `c${i % 7}`,
    total: Decimal128.fromString(`${i % 300}.5`),
  })),
);

async function save(name, command) {
  const reply = await db.command({ explain: command, verbosity: 'executionStats' });
  const text = EJSON.stringify(reply, undefined, 2, { relaxed: false });
  await writeFile(new URL(`${name}.json`, dir), `${text}\n`);
  console.log('wrote', name);
}

const find = { find: 'orders', filter: { status: 'open', n: { $gt: 100 } }, sort: { n: 1 } };
await save('find-collscan-8.2', find);
await save('agg-group-8.2', {
  aggregate: 'orders',
  pipeline: [
    { $match: { status: 'open' } },
    { $group: { _id: '$customer', total: { $sum: '$total' } } },
    { $sort: { total: -1 } },
  ],
  cursor: {},
});
await orders.createIndex({ status: 1, n: 1 });
await save('find-ixscan-8.2', find);
await save('agg-ixscan-8.2', {
  aggregate: 'orders',
  pipeline: [{ $match: { status: 'open', n: { $lt: 50 } } }, { $project: { n: 1 } }, { $limit: 5 }],
  cursor: {},
});
await client.close();
