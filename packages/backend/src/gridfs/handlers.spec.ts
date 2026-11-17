import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseResult, type Profile } from '@thicket/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import type { FileDialogs } from '../io/handlers';
import {
  RpcError,
  type Handler,
  type HandlerContext,
  type StreamProducer,
  type StreamSink,
} from '../server/rpc';
import { gridfsHandlers, suggestedName } from './handlers';

// Handler wiring with a fake (non-driver) client: parameter handling, dialogs, streams and the
// order of checks. The fake client has no driver `Db`, so every data path ends in INTERNAL here;
// those paths are covered against a real server in test/integration/gridfs.int.spec.ts.

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

const OID = '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-gridfs-handlers-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup({ connected = true } = {}) {
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (command) => {
        if ('hello' in command) return Promise.resolve({ isWritablePrimary: true, ok: 1 });
        if ('buildInfo' in command) return Promise.resolve({ version: '8.2.0', ok: 1 });
        return Promise.resolve({ ok: 1 });
      },
    }),
  };
  const manager = new ConnectionManager({
    loadProfile: (id) =>
      id === 'p1' ? Promise.resolve(profile) : Promise.reject(new RpcError('NOT_FOUND', id)),
    loadSecrets: () => Promise.resolve(null),
    createClient: () => client,
  });
  if (connected) await manager.open('p1', undefined);
  const answers: (string | null)[] = [];
  const dialogs = {
    saveFile: vi.fn<FileDialogs['saveFile']>(() => Promise.resolve(answers.shift() ?? null)),
    openFile: vi.fn<FileDialogs['openFile']>(() => Promise.resolve(answers.shift() ?? null)),
  };
  const handlers = gridfsHandlers(manager, dialogs);
  const producers: StreamProducer[] = [];
  const context = (signal: AbortSignal, streaming: boolean): HandlerContext => ({
    signal,
    requestId: 'r1',
    ...(streaming
      ? {
          openStream: (producer: StreamProducer) => {
            producers.push(producer);
            return `stream-${String(producers.length)}`;
          },
        }
      : {}),
  });
  const call = (
    method: string,
    params: unknown,
    { signal = new AbortController().signal, streaming = true } = {},
  ) =>
    new Promise<unknown>((resolve) =>
      resolve((handlers[method] as Handler)(params as never, context(signal, streaming))),
    );
  return { handlers, call, producers, dialogs, answers, manager };
}

function sink(): StreamSink & { batches: unknown[] } {
  const batches: unknown[] = [];
  return {
    streamId: 'stream-1',
    signal: new AbortController().signal,
    batches,
    send: (payload) => batches.push(payload),
  };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('expected a rejection');
}

const target = { profileId: 'p1', db: 'shop', bucket: 'fs' };

describe('suggestedName', () => {
  it('keeps a plain file name', () => {
    expect(suggestedName('report.pdf')).toBe('report.pdf');
    expect(suggestedName('  spaced name.txt ')).toBe('spaced name.txt');
  });

  it('drops folders written with / or \\', () => {
    expect(suggestedName('photos/2026/beach.jpg')).toBe('beach.jpg');
    expect(suggestedName('C:\\Users\\example\\notes.txt')).toBe('notes.txt');
    expect(suggestedName('../../etc/passwd')).toBe('passwd');
  });

  it('falls back to "download" for names that are empty or only folders', () => {
    for (const name of ['', '   ', '.', '..', 'folder/', 'a/..', '/', '\\']) {
      expect(suggestedName(name)).toBe('download');
    }
  });
});

describe('gridfsHandlers', () => {
  it('serves exactly gridfs.buckets/files/download/upload/delete', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([
      'gridfs.buckets',
      'gridfs.delete',
      'gridfs.download',
      'gridfs.files',
      'gridfs.upload',
    ]);
  });

  it('every method answers NOT_CONNECTED without an open connection, before any dialog', async () => {
    const { call, dialogs } = await setup({ connected: false });
    const codes = await Promise.all([
      rejection(call('gridfs.buckets', { profileId: 'p1', db: 'shop' })),
      rejection(call('gridfs.files', target)),
      rejection(call('gridfs.download', { ...target, id: OID })),
      rejection(call('gridfs.upload', target)),
      rejection(call('gridfs.delete', { ...target, id: OID })),
    ]);
    expect(codes.map((e) => e.code)).toEqual(Array(5).fill('NOT_CONNECTED'));
    expect(dialogs.saveFile).not.toHaveBeenCalled();
    expect(dialogs.openFile).not.toHaveBeenCalled();
  });

  it('a client without a driver Db fails as INTERNAL (buckets, files, delete)', async () => {
    const { call } = await setup();
    const errors = await Promise.all([
      rejection(call('gridfs.buckets', { profileId: 'p1', db: 'shop' })),
      rejection(call('gridfs.files', { ...target, nameContains: 'x', skip: 0, limit: 5 })),
      rejection(call('gridfs.delete', { ...target, id: OID })),
    ]);
    for (const error of errors) {
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toBe('GridFS needs a driver connection');
    }
  });

  it('a cancelled request is CANCELLED', async () => {
    const { call } = await setup();
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(
      call('gridfs.buckets', { profileId: 'p1', db: 'shop' }, { signal: controller.signal }),
    );
    expect(error.code).toBe('CANCELLED');
  });

  describe('gridfs.download', () => {
    it('needs a streaming server', async () => {
      const { call, dialogs } = await setup();
      const error = await rejection(
        call('gridfs.download', { ...target, id: OID }, { streaming: false }),
      );
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toContain('gridfs.download needs a streaming server');
      expect(dialogs.saveFile).not.toHaveBeenCalled();
    });

    it('rejects an id that is not EJSON as INVALID_PARAMS, before any dialog', async () => {
      const { call, dialogs } = await setup();
      const error = await rejection(call('gridfs.download', { ...target, id: '{"$oid":' }));
      expect(error.code).toBe('INVALID_PARAMS');
      expect(dialogs.saveFile).not.toHaveBeenCalled();
    });

    it('looks the file up before the save dialog opens (a failure opens no dialog)', async () => {
      const { call, dialogs, producers } = await setup();
      const error = await rejection(call('gridfs.download', { ...target, id: OID }));
      expect(error.code).toBe('INTERNAL');
      expect(dialogs.saveFile).not.toHaveBeenCalled();
      expect(producers).toHaveLength(0);
    });
  });

  describe('gridfs.upload', () => {
    it('needs a streaming server', async () => {
      const { call, dialogs } = await setup();
      const error = await rejection(call('gridfs.upload', target, { streaming: false }));
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toContain('gridfs.upload needs a streaming server');
      expect(dialogs.openFile).not.toHaveBeenCalled();
    });

    it('a cancelled open dialog answers nulls and opens no stream', async () => {
      const { call, dialogs, answers, producers } = await setup();
      answers.push(null);
      const signal = new AbortController().signal;
      const result = await call('gridfs.upload', target, { signal });
      expect(result).toEqual({ streamId: null, fileName: null, sizeBytes: null });
      expect(parseResult('gridfs.upload', result).ok).toBe(true);
      expect(dialogs.openFile).toHaveBeenCalledWith({ title: 'Upload file to GridFS' }, signal);
      expect(producers).toHaveLength(0);
    });

    it('opens a stream named after the chosen file, with its size', async () => {
      const { call, answers, producers } = await setup();
      const file = path.join(dir, 'invoice-2026.pdf');
      await writeFile(file, 'x'.repeat(1234));
      answers.push(file);
      const result = await call('gridfs.upload', target);
      expect(result).toEqual({
        streamId: 'stream-1',
        fileName: 'invoice-2026.pdf',
        sizeBytes: 1234,
      });
      expect(parseResult('gridfs.upload', result).ok).toBe(true);
      expect(producers).toHaveLength(1);
    });

    it('stores an explicit filename instead of the base name', async () => {
      const { call, answers } = await setup();
      const file = path.join(dir, 'local.bin');
      await writeFile(file, '');
      answers.push(file);
      expect(await call('gridfs.upload', { ...target, filename: 'stored/as.bin' })).toEqual({
        streamId: 'stream-1',
        fileName: 'stored/as.bin',
        sizeBytes: 0,
      });
    });

    it('a chosen file that cannot be read is INTERNAL "Could not read …" with no stream', async () => {
      const { call, answers, producers } = await setup();
      const file = path.join(dir, 'vanished.bin');
      answers.push(file);
      const error = await rejection(call('gridfs.upload', target));
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toContain(`Could not read ${file}`);
      expect(producers).toHaveLength(0);
    });

    it('the stream fails without sending progress when the client has no driver Db', async () => {
      const { call, answers, producers } = await setup();
      const file = path.join(dir, 'a.txt');
      await writeFile(file, 'abc');
      answers.push(file);
      await call('gridfs.upload', target);
      const out = sink();
      const error = await rejection((producers[0] as StreamProducer)(out));
      expect(error.code).toBe('INTERNAL');
      expect(out.batches).toEqual([]);
    });
  });

  describe('gridfs.delete', () => {
    it('rejects an id that is not EJSON as INVALID_PARAMS', async () => {
      const { call } = await setup();
      const error = await rejection(call('gridfs.delete', { ...target, id: 'not ejson' }));
      expect(error.code).toBe('INVALID_PARAMS');
    });
  });
});
