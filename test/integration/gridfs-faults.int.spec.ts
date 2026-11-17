import { randomBytes } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { downloadFile, RpcError, uploadFile } from '@thicket/backend';
import type { GridfsProgress } from '@thicket/contract';

// Local file system failures in the middle of a GridFS transfer (task gridfs), against the 8.x
// standalone fixture. `node:fs` is wrapped so that a test can make the source file fail after
// some reads (upload) or the target file fail after some bytes (download); without a fault set,
// the real functions run.

const fault = vi.hoisted(() => ({
  /** Upload: the source yields this many bytes of its content in 64 KiB reads, then fails. */
  readFailsAfter: undefined as number | undefined,
  /** Download: the target accepts this many bytes, then the next write fails. */
  writeFailsAfter: undefined as number | undefined,
  /** Download: the target file is opened only once this settles (a slow file system). */
  openGate: undefined as Promise<void> | undefined,
  /** The write stream of the last download (to check that it was closed). */
  lastOutput: undefined as WriteStream | undefined,
}));

function fsError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const createReadStream = (file: string, options?: { signal?: AbortSignal }) => {
    const limit = fault.readFailsAfter;
    if (limit === undefined) return fs.createReadStream(file, options);
    const content = fs.readFileSync(file);
    async function* reads(end: number) {
      for (let at = 0; at < end; at += 64 * 1024) {
        await new Promise((resolve) => setImmediate(resolve));
        yield content.subarray(at, Math.min(at + 64 * 1024, end));
      }
      throw fsError('EIO', 'i/o error, read (fictitious)');
    }
    return Readable.from(reads(limit), { objectMode: false });
  };
  const createWriteStream = (
    file: string,
    options?: Parameters<typeof fs.createWriteStream>[1],
  ) => {
    const gate = fault.openGate;
    type Open = (...args: unknown[]) => void;
    const slowFs = gate && {
      open: (...args: unknown[]) => {
        const callback = args.pop() as (...result: unknown[]) => void;
        void gate.then(() => (fs.open as unknown as Open)(...args, callback));
      },
      write: fs.write,
      writev: fs.writev,
      close: fs.close,
    };
    const stream = fs.createWriteStream(
      file,
      slowFs ? { ...(typeof options === 'object' ? options : {}), fs: slowFs } : options,
    );
    fault.lastOutput = stream;
    const limit = fault.writeFailsAfter;
    if (limit === undefined) return stream;
    let written = 0;
    const write = stream._write.bind(stream);
    stream._writev = undefined;
    stream._write = (chunk: Buffer, encoding, callback) => {
      if (written + chunk.length > limit) {
        callback(fsError('ENOSPC', 'no space left on device, write (fictitious)'));
        return;
      }
      written += chunk.length;
      write(chunk, encoding, callback);
    };
    return stream;
  };
  return {
    ...fs,
    default: { ...fs, createReadStream, createWriteStream },
    createReadStream,
    createWriteStream,
  };
});

const mongo = inject('mongo').mongo8;
const DB = `gridfs_faults_${randomBytes(3).toString('hex')}`;
const KB = 1024;
const MB = 1024 * KB;

let dir: string;
let direct: MongoClient;

async function counts(bucket: string): Promise<number[]> {
  return [
    await direct.db(DB).collection(`${bucket}.files`).countDocuments(),
    await direct.db(DB).collection(`${bucket}.chunks`).countDocuments(),
  ];
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-gridfs-faults-'));
  direct = new MongoClient(mongo.uri);
  await direct.connect();
});

afterEach(() => {
  fault.readFailsAfter = undefined;
  fault.writeFailsAfter = undefined;
  fault.openGate = undefined;
  fault.lastOutput = undefined;
});

afterAll(async () => {
  await direct.db(DB).dropDatabase();
  await direct.close();
  await rm(dir, { recursive: true, force: true });
});

describe('gridfs transfers with a failing local file', () => {
  it('a source read error mid-upload fails as INTERNAL "Could not read …" and removes the chunks already stored', async () => {
    const source = path.join(dir, 'flaky.bin');
    await writeFile(source, randomBytes(2 * MB));
    // 10 reads of 64 KiB: two full 255 KiB chunks are stored before the read fails.
    fault.readFailsAfter = 640 * KB;
    const progress: GridfsProgress[] = [];
    const error = await uploadFile(direct, DB, 'flaky', source, 'flaky.bin', {
      signal: new AbortController().signal,
      progressBytes: 64 * KB,
      progress: (p) => progress.push(p),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INTERNAL');
    expect((error as RpcError).message).toBe(
      `Could not read ${source}: EIO: i/o error, read (fictitious)`,
    );
    // The failure came mid-transfer: every read before it was written and reported.
    expect(progress.map((p) => p.bytes)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1) * 64 * KB),
    );
    expect(progress.every((p) => p.totalBytes === 2 * MB && p.fileId === undefined)).toBe(true);
    expect(await counts('flaky')).toEqual([0, 0]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await counts('flaky')).toEqual([0, 0]);
  });

  it('a source that fails on its first read stores nothing', async () => {
    const source = path.join(dir, 'unreadable.bin');
    await writeFile(source, randomBytes(100 * KB));
    fault.readFailsAfter = 0;
    const progress: GridfsProgress[] = [];
    const error = await uploadFile(direct, DB, 'unreadable', source, 'unreadable.bin', {
      signal: new AbortController().signal,
      progress: (p) => progress.push(p),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as RpcError).code).toBe('INTERNAL');
    expect((error as RpcError).message).toContain(`Could not read ${source}`);
    expect(progress).toEqual([]);
    expect(await counts('unreadable')).toEqual([0, 0]);
  });

  it('a target write error mid-download fails as INTERNAL "Could not write …", closes and removes the partial file', async () => {
    const source = path.join(dir, 'whole.bin');
    await writeFile(source, randomBytes(3 * MB));
    const stored = await uploadFile(direct, DB, 'full', source, 'whole.bin', {
      signal: new AbortController().signal,
      progress: () => undefined,
    });
    const id = (JSON.parse(stored.id) as { $oid: string }).$oid;

    const target = path.join(dir, 'whole.copy');
    fault.writeFailsAfter = 1 * MB;
    const progress: GridfsProgress[] = [];
    const error = await downloadFile(direct, DB, 'full', new ObjectId(id), 3 * MB, target, {
      signal: new AbortController().signal,
      progressBytes: 256 * KB,
      progress: (p) => progress.push(p),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('INTERNAL');
    expect((error as RpcError).message).toBe(
      `Could not write ${target}: ENOSPC: no space left on device, write (fictitious)`,
    );
    // Some bytes had gone through, but not the whole file, and the output was closed before rm.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.bytes).toBeLessThan(3 * MB);
    expect(fault.lastOutput?.closed).toBe(true);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    // The stored file is untouched.
    expect(await counts('full')).toEqual([1, 13]);
  });

  // CR-4: the target file is still being opened when the download is cancelled. The removal must
  // wait for that open (and close), or the late open recreates the file after the removal.
  it('a download cancelled while its target file is still opening leaves no file behind', async () => {
    const source = path.join(dir, 'slow-open.bin');
    await writeFile(source, randomBytes(512 * KB));
    const stored = await uploadFile(direct, DB, 'slowopen', source, 'slow-open.bin', {
      signal: new AbortController().signal,
      progress: () => undefined,
    });
    const id = new ObjectId((JSON.parse(stored.id) as { $oid: string }).$oid);

    let release!: () => void;
    fault.openGate = new Promise<void>((resolve) => (release = resolve));
    const target = path.join(dir, 'slow-open.copy');
    const controller = new AbortController();
    const download = downloadFile(direct, DB, 'slowopen', id, 512 * KB, target, {
      signal: controller.signal,
      progress: () => undefined,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    controller.abort();
    // The file system answers the open only later.
    setTimeout(release, 100);
    const error = await download;
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('CANCELLED');
    expect(fault.lastOutput?.closed).toBe(true);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
