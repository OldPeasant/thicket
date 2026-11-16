import { MongoClient } from 'mongodb';

import { expect, test } from './harness';

// Checks the harness's MongoDB helper; skipped when no container runtime (Docker/Podman) answers.
test('the mongo fixture starts a reachable MongoDB server from the integration harness', async ({
  mongo,
}) => {
  expect(mongo.uri).toMatch(/^mongodb:\/\//);
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const hello = await client.db('admin').command({ hello: 1 });
    expect(hello['ok']).toBe(1);
  } finally {
    await client.close();
  }
});
