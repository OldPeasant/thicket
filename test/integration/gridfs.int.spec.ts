import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MongoClient, ObjectId, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ConnectionManager,
  RpcClient,
  RpcError,
  gridfsHandlers,
  guardWrites,
  serve,
  uploadFile,
  type FileDialogs,
} from '@thicket/backend';
import {
  methods,
  type ErrorInfo,
  type Event,
  type GridfsProgress,
  type MethodName,
  type ParamsOf,
  type Profile,
  type ResultOf,
} from '@thicket/contract';

import { portPair } from '../../packages/backend/src/server/testing';

// gridfs.* (task gridfs) against the 8.x standalone fixture, served like startBackend serves them
// (contract validation, streams, write guard). The native dialogs are a queue of temp file paths.

const mongo = inject('mongo').mongo8;
const run = randomBytes(3).toString('hex');
const DB = `gridfs_${run}`;
const MB = 1024 * 1024;

const PROFILE: Profile = {
  id: 'gridfs',
  name: 'GridFS',
  connectionString: mongo.uri,
  readOnly: false,
  production: false,
  serverSelectionTimeoutMS: 10_000,
};
const READ_ONLY: Profile = { ...PROFILE, id: 'gridfs-ro', readOnly: true };

interface StreamOutcome {
  progress: GridfsProgress[];
  end?: { delivered: number };
  error?: ErrorInfo;
}

let dir: string;
const chosen: (string | null)[] = [];
const dialogs: FileDialogs = {
  saveFile: () => Promise.resolve(chosen.shift() ?? null),
  openFile: () => Promise.resolve(chosen.shift() ?? null),
};

function profileOf(id: string): Profile {
  if (id === PROFILE.id) return PROFILE;
  if (id === READ_ONLY.id) return READ_ONLY;
  throw new RpcError('NOT_FOUND', `No profile ${id}`);
}

function backendFor() {
  const manager = new ConnectionManager({
    loadProfile: (id) => Promise.resolve(profileOf(id)),
    loadSecrets: () => Promise.resolve(null),
  });
  const [serverPort, clientPort] = portPair();
  const stop = serve(serverPort, {
    table: methods,
    route: 'backend',
    handlers: guardWrites(gridfsHandlers(manager, dialogs), profileOf),
  });
  const client = new RpcClient(clientPort);
  const events = new Map<string, Event[]>();
  const listeners = new Map<string, Set<() => void>>();
  clientPort.onMessage((message) => {
    const event = message as Partial<Event>;
    if (typeof event.stream !== 'string' || event.kind === undefined) return;
    const list = events.get(event.stream) ?? [];
    list.push(event as Event);
    events.set(event.stream, list);
    for (const listener of listeners.get(event.stream) ?? []) listener();
  });
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>) =>
    client.call(method, params) as Promise<ResultOf<M>>;
  const listen = (streamId: string, check: () => void) => {
    const set = listeners.get(streamId) ?? new Set();
    set.add(check);
    listeners.set(streamId, set);
    check();
  };
  const finished = (streamId: string): Promise<StreamOutcome> =>
    new Promise((resolve) => {
      listen(streamId, () => {
        const list = events.get(streamId) ?? [];
        const last = list.at(-1);
        if (last === undefined || last.kind === 'data') return;
        resolve({
          progress: list.filter((e) => e.kind === 'data').map((e) => e.payload as GridfsProgress),
          ...(last.kind === 'end' ? { end: last.payload as { delivered: number } } : {}),
          ...(last.kind === 'error' ? { error: last.payload as ErrorInfo } : {}),
        });
      });
    });
  /** Resolves with the first event of the stream (a progress event while it is running). */
  const firstEvent = (streamId: string): Promise<Event> =>
    new Promise((resolve) => {
      listen(streamId, () => {
        const first = events.get(streamId)?.[0];
        if (first !== undefined) resolve(first);
      });
    });
  const cancel = (streamId: string) => clientPort.send({ cancel: streamId });
  const close = async () => {
    client.close();
    stop();
    await manager.closeAll();
  };
  return { manager, call, finished, firstEvent, cancel, close };
}

let backend: ReturnType<typeof backendFor>;
let direct: MongoClient;

/** Gives writes still in flight (driver inserts, a file open) time to land. */
const settleWrites = () => new Promise((resolve) => setTimeout(resolve, 300));

/** Asserts that `bucket` holds no files document and no chunk, also after a settle. */
async function expectNoFile(bucket: string) {
  const counts = async () => [
    await direct.db(DB).collection(`${bucket}.files`).countDocuments(),
    await direct.db(DB).collection(`${bucket}.chunks`).countDocuments(),
  ];
  expect(await counts()).toEqual([0, 0]);
  await settleWrites();
  expect(await counts()).toEqual([0, 0]);
}

const sha256 = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

async function upload(file: string, bucket = 'fs', filename?: string) {
  chosen.push(file);
  const result = await backend.call('gridfs.upload', {
    profileId: PROFILE.id,
    db: DB,
    bucket,
    ...(filename !== undefined ? { filename } : {}),
  });
  expect(result.streamId).not.toBeNull();
  return { result, outcome: await backend.finished(result.streamId ?? '') };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-gridfs-'));
  direct = new MongoClient(mongo.uri);
  await direct.connect();
  backend = backendFor();
  await backend.manager.open(PROFILE.id, undefined);
  await backend.manager.open(READ_ONLY.id, undefined);
});

afterAll(async () => {
  await backend.close();
  await direct.db(DB).dropDatabase();
  await direct.close();
  await rm(dir, { recursive: true, force: true });
});

describe('gridfs', () => {
  it('uploads a 20 MB file with progress and downloads it byte for byte (SHA-256)', async () => {
    const source = path.join(dir, 'big.bin');
    await writeFile(source, randomBytes(20 * MB));

    const { result, outcome } = await upload(source);
    expect(outcome.error).toBeUndefined();
    expect(result.fileName).toBe('big.bin');
    expect(result.sizeBytes).toBe(20 * MB);
    expect(outcome.end?.delivered).toBe(20 * MB);
    const last = outcome.progress.at(-1);
    expect(last?.bytes).toBe(20 * MB);
    expect(last?.totalBytes).toBe(20 * MB);
    expect(last?.fileId).toMatch(/^\{"\$oid":"[0-9a-f]{24}"\}$/);
    // Progress came in steps, increasing, not only at the end.
    expect(outcome.progress.length).toBeGreaterThan(10);
    const steps = outcome.progress.map((p) => p.bytes);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));

    const { files, total } = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'fs',
    });
    expect(total).toBe(1);
    expect(files[0]).toMatchObject({ id: last?.fileId, filename: 'big.bin', length: 20 * MB });
    expect(Date.parse(files[0]?.uploadDate ?? '')).not.toBeNaN();

    const target = path.join(dir, 'big.copy');
    chosen.push(target);
    const download = await backend.call('gridfs.download', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'fs',
      id: last?.fileId ?? '',
    });
    expect(download.path).toBe(target);
    const got = await backend.finished(download.streamId ?? '');
    expect(got.error).toBeUndefined();
    expect(got.end?.delivered).toBe(20 * MB);
    expect(got.progress.at(-1)).toEqual({ bytes: 20 * MB, totalBytes: 20 * MB });
    expect((await stat(target)).size).toBe(20 * MB);
    expect(await sha256(target)).toBe(await sha256(source));
  });

  it('lists buckets with counts, and files filtered by name, newest first', async () => {
    const small = path.join(dir, 'notes.txt');
    await writeFile(small, 'hello');
    await upload(small, 'docs', 'Report-A.txt');
    await upload(small, 'docs', 'report-b.txt');
    await upload(small, 'docs', 'other.txt');

    const { buckets } = await backend.call('gridfs.buckets', { profileId: PROFILE.id, db: DB });
    expect(buckets).toEqual([
      { name: 'fs', files: 1, hasChunks: true },
      { name: 'docs', files: 3, hasChunks: true },
    ]);

    const all = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'docs',
    });
    expect(all.files.map((f) => f.filename)).toEqual(['other.txt', 'report-b.txt', 'Report-A.txt']);
    const found = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'docs',
      nameContains: 'REPORT',
      limit: 1,
    });
    expect(found.total).toBe(2);
    expect(found.files.map((f) => f.filename)).toEqual(['report-b.txt']);
    // Regex characters are matched literally.
    const literal = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'docs',
      nameContains: '.*',
    });
    expect(literal.total).toBe(0);
  });

  it('deletes a file with its chunks; a second delete answers deleted: false', async () => {
    const file = path.join(dir, 'gone.bin');
    await writeFile(file, randomBytes(600 * 1024));
    const { outcome } = await upload(file, 'trash');
    const id = outcome.progress.at(-1)?.fileId ?? '';
    const oid = new ObjectId((JSON.parse(id) as { $oid: string }).$oid);
    expect(await direct.db(DB).collection('trash.chunks').countDocuments({ files_id: oid })).toBe(
      3,
    );

    const params = { profileId: PROFILE.id, db: DB, bucket: 'trash', id };
    expect(await backend.call('gridfs.delete', params)).toEqual({ deleted: true });
    expect(await direct.db(DB).collection('trash.files').countDocuments({ _id: oid })).toBe(0);
    expect(await direct.db(DB).collection('trash.chunks').countDocuments({ files_id: oid })).toBe(
      0,
    );
    expect(await backend.call('gridfs.delete', params)).toEqual({ deleted: false });
  });

  it('downloads a file whose _id is not an ObjectId', async () => {
    const files = direct.db(DB).collection<Document>('custom.files');
    await files.insertOne({
      _id: 'my-id' as unknown as ObjectId,
      length: 3,
      chunkSize: 255 * 1024,
      uploadDate: new Date(),
      filename: 'abc.txt',
      contentType: 'text/plain',
    });
    await direct
      .db(DB)
      .collection('custom.chunks')
      .insertOne({ files_id: 'my-id', n: 0, data: Buffer.from('abc') });
    const { files: listed } = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'custom',
    });
    expect(listed[0]).toMatchObject({ id: '"my-id"', contentType: 'text/plain' });

    const target = path.join(dir, 'abc.txt');
    chosen.push(target);
    const download = await backend.call('gridfs.download', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'custom',
      id: '"my-id"',
    });
    expect((await backend.finished(download.streamId ?? '')).error).toBeUndefined();
    expect(await readFile(target, 'utf8')).toBe('abc');
  });

  it('refuses uploads and deletes on read-only profiles, before any dialog', async () => {
    chosen.push(path.join(dir, 'never'));
    await expect(
      backend.call('gridfs.upload', { profileId: READ_ONLY.id, db: DB, bucket: 'fs' }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(chosen).toHaveLength(1);
    chosen.length = 0;
    await expect(
      backend.call('gridfs.delete', {
        profileId: READ_ONLY.id,
        db: DB,
        bucket: 'fs',
        id: '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}',
      }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
  });

  it('a cancelled dialog answers null; an unknown file is NOT_FOUND before the dialog', async () => {
    chosen.push(null);
    expect(
      await backend.call('gridfs.upload', { profileId: PROFILE.id, db: DB, bucket: 'fs' }),
    ).toEqual({ streamId: null, fileName: null, sizeBytes: null });
    await expect(
      backend.call('gridfs.download', {
        profileId: PROFILE.id,
        db: DB,
        bucket: 'fs',
        id: '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a cancelled download ends CANCELLED and removes the partial local file', async () => {
    const source = path.join(dir, 'download-cancel.bin');
    await writeFile(source, randomBytes(40 * MB));
    const { outcome } = await upload(source, 'dlcancel');
    const id = outcome.progress.at(-1)?.fileId ?? '';
    expect(id).not.toBe('');

    const target = path.join(dir, 'download-cancel.copy');
    chosen.push(target);
    const download = await backend.call('gridfs.download', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'dlcancel',
      id,
    });
    expect(download.path).toBe(target);
    const streamId = download.streamId ?? '';
    // Cancel mid-transfer: after the first progress event (1 MiB of 40 written).
    expect((await backend.firstEvent(streamId)).kind).toBe('data');
    backend.cancel(streamId);
    const got = await backend.finished(streamId);
    expect(got.error?.code).toBe('CANCELLED');
    expect(got.progress.length).toBeGreaterThan(0);
    expect(got.progress.at(-1)?.bytes).toBeLessThan(40 * MB);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await settleWrites();
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    // The stored file is untouched.
    const { files } = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'dlcancel',
    });
    expect(files.map((f) => f.length)).toEqual([40 * MB]);
  });

  it('round-trips an empty file (no chunks) with a final progress event', async () => {
    const source = path.join(dir, 'empty.txt');
    await writeFile(source, '');
    const { result, outcome } = await upload(source, 'empty');
    expect(outcome.error).toBeUndefined();
    expect(result.sizeBytes).toBe(0);
    const last = outcome.progress.at(-1);
    expect(last).toMatchObject({ bytes: 0, totalBytes: 0 });
    expect(last?.fileId).toMatch(/^\{"\$oid":"[0-9a-f]{24}"\}$/);

    const { files } = await backend.call('gridfs.files', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'empty',
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: 'empty.txt', length: 0 });

    const target = path.join(dir, 'empty.copy');
    chosen.push(target);
    const download = await backend.call('gridfs.download', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'empty',
      id: last?.fileId ?? '',
    });
    const got = await backend.finished(download.streamId ?? '');
    expect(got.error).toBeUndefined();
    expect(got.progress.at(-1)).toEqual({ bytes: 0, totalBytes: 0 });
    expect((await stat(target)).size).toBe(0);
  });

  it('a download into a folder that does not exist fails as INTERNAL "Could not write …"', async () => {
    const source = path.join(dir, 'unwritable.txt');
    await writeFile(source, 'fictitious');
    const { outcome } = await upload(source, 'unwritable');
    const target = path.join(dir, 'no-such-folder', 'copy.txt');
    chosen.push(target);
    const download = await backend.call('gridfs.download', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'unwritable',
      id: outcome.progress.at(-1)?.fileId ?? '',
    });
    const got = await backend.finished(download.streamId ?? '');
    expect(got.error?.code).toBe('INTERNAL');
    expect(got.error?.message).toContain(`Could not write ${target}`);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('gridfs.files rejects a limit above MAX_GRIDFS_FILES and a bucket with "$"', async () => {
    await expect(
      backend.call('gridfs.files', { profileId: PROFILE.id, db: DB, bucket: 'fs', limit: 1001 }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      backend.call('gridfs.files', { profileId: PROFILE.id, db: DB, bucket: 'a$b' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('an upload cancelled mid-transfer leaves no files document and no chunks behind', async () => {
    const source = path.join(dir, 'cancel.bin');
    await writeFile(source, randomBytes(40 * MB));
    chosen.push(source);
    const result = await backend.call('gridfs.upload', {
      profileId: PROFILE.id,
      db: DB,
      bucket: 'cancelled',
    });
    const streamId = result.streamId ?? '';
    // Cancel after the first progress event: chunks have been written by then.
    expect((await backend.firstEvent(streamId)).kind).toBe('data');
    backend.cancel(streamId);
    const outcome = await backend.finished(streamId);
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(outcome.progress.length).toBeGreaterThan(0);
    expect(outcome.progress.at(-1)?.bytes).toBeLessThan(40 * MB);
    await expectNoFile('cancelled');
  });

  // Every point of an upload, including the last chunk and the files document write: whatever
  // the driver still had in flight when the cancel came must not land after the clean-up.
  it('an upload cancelled at any progress step (also at its end) leaves the bucket empty', async () => {
    const source = path.join(dir, 'steps.bin');
    const size = 600 * 1024 + 123; // three chunks (255 KiB) and a remnant
    await writeFile(source, randomBytes(size));
    const step = 64 * 1024;
    const steps = Math.floor(size / step);
    for (let at = 1; at <= steps; at++) {
      const controller = new AbortController();
      let seen = 0;
      const error = await uploadFile(direct, DB, 'steps', source, 'steps.bin', {
        signal: controller.signal,
        progressBytes: step,
        progress: () => {
          seen++;
          if (seen === at) controller.abort();
        },
      }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error, `cancel at step ${at}`).toBeInstanceOf(RpcError);
      expect((error as RpcError).code).toBe('CANCELLED');
      await expectNoFile('steps');
    }
  });
});
