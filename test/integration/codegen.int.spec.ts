import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  generateCode,
  parseShellSyntaxDocument,
  stringifyEJson,
  type BsonDocument,
  type CodegenLanguage,
  type CodegenQuery,
} from '@thicket/core';
import { BSON, MongoClient, type Document } from 'mongodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Generated Node, Python and Java programs run against the mongo8 fixture and must print the
 * same documents as the same query run directly through the Node driver. Typed values (Int64
 * beyond 2^53, UUID, binary subtype, timestamp, Double vs Int32, …) only match when each
 * language's constructor produces the right BSON type; `$type` of literals checks the rest.
 *
 * Node runs on the host. Python (PyMongo) and Java (sync driver) run in containers with host
 * networking, so the fixture's `localhost:<port>` URI works from inside them unchanged.
 */

const exec = promisify(execFile);
const DB = 'codegen_it';
const COLL = 'items';
const PYTHON_IMAGE = 'docker.io/library/python:3.13-slim';
const JAVA_IMAGE = 'docker.io/library/eclipse-temurin:21-jdk';
const JAVA_DRIVER = '5.14.0';
const JAVA_JARS = ['bson', 'bson-record-codec', 'mongodb-driver-core', 'mongodb-driver-sync'];
const NODE_MODULES = join(import.meta.dirname, '..', '..', 'node_modules');

const d = (text: string): BsonDocument => parseShellSyntaxDocument(text);
/** Model → driver values, through canonical EJSON (lossless). */
const toDriver = (value: BsonDocument): Document =>
  BSON.EJSON.parse(stringifyEJson(value), { relaxed: false }) as Document;

const SEED = [
  `{ _id: 1, status: "open", customer: "a", total: NumberDecimal("120.50"),
     qty: NumberLong("9007199254740993"), at: ISODate("2024-01-02T03:04:05.678Z"),
     ratio: Double(3), name: "report-1.pdf", hash: BinData(0, "AAECAwQ="),
     tag: UUID("0e5a6b43-1f2c-4d8e-9a7b-6c5d4e3f2a1b"), ts: Timestamp({ t: 1700000000, i: 7 }),
     ref: ObjectId("65a1b2c3d4e5f60718293a4b") }`,
  `{ _id: 2, status: "open", customer: "b", total: NumberDecimal("80"), qty: NumberLong(5),
     at: ISODate("2023-06-01T00:00:00Z"), ratio: 0.5, name: "Report-22.PDF",
     hash: BinData(0, "AAECAwQ="), tag: UUID("11111111-2222-4333-8444-555555555555"),
     ts: Timestamp({ t: 1700000000, i: 8 }), ref: ObjectId("65a1b2c3d4e5f60718293a4c") }`,
  `{ _id: 3, status: "closed", customer: "a", total: NumberDecimal("300"), qty: NumberLong(1),
     at: ISODate("2024-03-01T00:00:00Z"), name: "notes.txt" }`,
  `{ _id: 4, status: "open", customer: "b", total: NumberDecimal("150"), qty: NumberLong(2),
     at: ISODate("2024-05-01T00:00:00Z"), name: "report-3.pdf" }`,
].map(d);

const QUERIES: readonly { name: string; query: CodegenQuery }[] = [
  {
    name: 'find with filter, projection, sort and limit',
    query: {
      kind: 'find',
      database: DB,
      collection: COLL,
      filter: d(`{ status: "open", total: { $gt: NumberDecimal("100") },
                   at: { $gte: ISODate("2024-01-01T00:00:00Z") } }`),
      projection: d('{ customer: 1, total: 1, at: 1, qty: 1, ratio: 1 }'),
      sort: d('{ total: -1 }'),
      skip: 0,
      limit: 5,
    },
  },
  {
    name: 'find by binary, uuid, regex, timestamp, ObjectId and Int64 with a collation',
    query: {
      kind: 'find',
      database: DB,
      collection: COLL,
      filter: d(`{
        hash: BinData(0, "AAECAwQ="), tag: UUID("0e5a6b43-1f2c-4d8e-9a7b-6c5d4e3f2a1b"),
        name: /^report-\\d+\\.pdf$/i, ts: Timestamp({ t: 1700000000, i: 7 }),
        ref: ObjectId("65a1b2c3d4e5f60718293a4b"), qty: NumberLong("9007199254740993"),
        status: "OPEN"
      }`),
      collation: d('{ locale: "en", strength: 2 }'),
    },
  },
  {
    name: 'pipeline with $match, $group, $sort and typed literals',
    query: {
      kind: 'aggregate',
      database: DB,
      collection: COLL,
      pipeline: [
        d('{ $match: { status: "open", name: { $regex: "pdf$", $options: "i" } } }'),
        d('{ $group: { _id: "$customer", total: { $sum: "$total" }, n: { $sum: 1 } } }'),
        d('{ $sort: { _id: 1 } }'),
        d(`{ $addFields: { types: [
          { $type: { $literal: Double(3) } }, { $type: { $literal: -0 } },
          { $type: { $literal: 0.5 } }, { $type: { $literal: NumberLong(5) } },
          { $type: { $literal: 7 } }, { $type: { $literal: NumberDecimal("1.10") } },
          { $type: { $literal: ISODate("2024-01-02T03:04:05.678Z") } },
          { $type: { $literal: ObjectId("65a1b2c3d4e5f60718293a4b") } },
          { $type: { $literal: BinData(0, "AAECAwQ=") } },
          { $type: { $literal: /a.c/i } }, { $type: { $literal: Timestamp({ t: 1, i: 2 }) } },
          { $type: { $literal: MinKey() } }, { $type: { $literal: MaxKey() } },
          { $type: { $literal: Code("function () { return 1; }") } },
          { $type: { $literal: true } }, { $type: { $literal: null } },
          { $type: { $literal: "s" } }, { $type: { $literal: [1] } },
          { $type: { $literal: { a: 1 } } }
        ],
           big: { $add: [NumberLong("9007199254740993"), NumberLong(0)] } } }`),
      ],
    },
  },
];

/** One line per document, normalised so that the languages' JSON spellings compare equal. */
function normalize(lines: readonly string[]): string[] {
  return lines.map((l) =>
    BSON.EJSON.stringify(BSON.EJSON.parse(l, { relaxed: true }), { relaxed: true }),
  );
}

function outputLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() !== '');
}

let uri = '';
let client: MongoClient;
const expected = new Map<string, string[]>();

beforeAll(async () => {
  uri = inject('mongo').mongo8.uri;
  client = new MongoClient(uri);
  const coll = client.db(DB).collection(COLL);
  await coll.drop().catch(() => undefined);
  await coll.insertMany(SEED.map(toDriver));
  for (const { name, query } of QUERIES) {
    const docs =
      query.kind === 'find'
        ? await coll
            .find(toDriver(query.filter), {
              ...(query.projection ? { projection: toDriver(query.projection) } : {}),
              ...(query.sort ? { sort: toDriver(query.sort) } : {}),
              ...(query.collation ? { collation: toDriver(query.collation) as never } : {}),
              ...(query.limit ? { limit: query.limit } : {}),
            })
            .toArray()
        : await coll.aggregate(query.pipeline.map(toDriver)).toArray();
    expected.set(name, normalize(docs.map((doc) => BSON.EJSON.stringify(doc, { relaxed: true }))));
  }
});

afterAll(async () => {
  await client.db(DB).dropDatabase();
  await client.close();
});

it('the samples find documents (the comparison is not vacuous)', () => {
  expect(QUERIES.map((q) => expected.get(q.name)?.length)).toEqual([2, 1, 2]);
});

/** Runs a generated program and returns its stdout. */
type Runner = (code: string, index: number) => Promise<string>;

function languageSuite(
  language: CodegenLanguage,
  setup: () => Promise<Runner>,
  teardown?: () => Promise<void>,
) {
  describe(`generated ${language} code`, () => {
    let run: Runner;
    beforeAll(async () => {
      run = await setup();
    });
    if (teardown) afterAll(teardown);

    QUERIES.forEach(({ name, query }, index) => {
      it(name, async () => {
        const out = await run(generateCode(query, language, { uri }), index);
        expect(normalize(outputLines(out))).toEqual(expected.get(name));
      });
    });
  });
}

let nodeDir = '';
languageSuite(
  'node',
  async () => {
    nodeDir = await mkdtemp(join(tmpdir(), 'thicket-codegen-'));
    return async (code, index) => {
      const file = join(nodeDir, `query${index}.cjs`);
      await writeFile(file, code);
      const { stdout } = await exec(process.execPath, [file], {
        env: { ...process.env, NODE_PATH: NODE_MODULES },
      });
      return stdout;
    };
  },
  () => rm(nodeDir, { recursive: true, force: true }),
);

/** A long-running container with host networking that runs programs with `exec`. */
async function startRunner(image: string, prepare: string): Promise<StartedTestContainer> {
  const container = await new GenericContainer(image)
    .withNetworkMode('host')
    .withCommand(['sleep', 'infinity'])
    .start();
  const result = await container.exec(['sh', '-c', prepare]);
  if (result.exitCode !== 0) {
    await container.stop();
    throw new Error(`preparing ${image} failed: ${result.output}`);
  }
  return container;
}

async function runIn(
  container: StartedTestContainer,
  dir: string,
  file: string,
  code: string,
  command: string[],
) {
  await container.copyContentToContainer([{ content: code, target: `${dir}/${file}` }]);
  const result = await container.exec(command, { workingDir: dir });
  if (result.exitCode !== 0)
    throw new Error(`${command.join(' ')} failed:\n${result.output}\n${code}`);
  return result.stdout;
}

let python: StartedTestContainer | undefined;
languageSuite(
  'python',
  async () => {
    python = await startRunner(PYTHON_IMAGE, 'pip install -q --root-user-action=ignore pymongo');
    const c = python;
    return (code, index) => runIn(c, `/work/q${index}`, 'query.py', code, ['python', 'query.py']);
  },
  async () => {
    await python?.stop();
  },
);

let java: StartedTestContainer | undefined;
languageSuite(
  'java',
  async () => {
    const urls = JAVA_JARS.map(
      (a) =>
        `https://repo1.maven.org/maven2/org/mongodb/${a}/${JAVA_DRIVER}/${a}-${JAVA_DRIVER}.jar`,
    );
    java = await startRunner(
      JAVA_IMAGE,
      `mkdir -p /jars && cd /jars && curl -fsSLO --remote-name-all ${urls.join(' ')}`,
    );
    const c = java;
    // Single-file source launch: compiles Query.java in memory and runs it.
    return (code, index) =>
      runIn(c, `/work/q${index}`, 'Query.java', code, ['java', '-cp', '/jars/*', 'Query.java']);
  },
  async () => {
    await java?.stop();
  },
);
