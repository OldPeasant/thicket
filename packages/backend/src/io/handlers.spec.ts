import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseResult, type Profile } from '@thicket/contract';
import type { Document } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ClientLike } from '../connections/manager';
import {
  RpcError,
  type Handler,
  type HandlerContext,
  type StreamProducer,
  type StreamSink,
} from '../server/rpc';
import { MAX_FILE_TOKENS, dialogsOverLink, ioHandlers, type FileDialogs } from './handlers';

const profile: Profile = {
  id: 'p1',
  name: 'Local',
  connectionString: 'mongodb://db.example.test:27017',
  readOnly: false,
  production: false,
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thicket-io-handlers-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const sent: Document[] = [];
  const client: ClientLike = {
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    db: () => ({
      command: (command) => {
        sent.push(command);
        if ('hello' in command) return Promise.resolve({ isWritablePrimary: true, ok: 1 });
        if ('buildInfo' in command) return Promise.resolve({ version: '8.2.0', ok: 1 });
        if ('find' in command || 'aggregate' in command) {
          return Promise.resolve({
            cursor: { id: 0, ns: 'shop.orders', firstBatch: [{ _id: 1 }, { _id: 2 }] },
            ok: 1,
          });
        }
        if ('insert' in command) {
          return Promise.resolve({ n: (command['documents'] as unknown[]).length, ok: 1 });
        }
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
  await manager.open('p1', undefined);
  sent.length = 0;
  const answers: (string | null)[] = [];
  const dialogs = {
    saveFile: vi.fn<FileDialogs['saveFile']>(() => Promise.resolve(answers.shift() ?? null)),
    openFile: vi.fn<FileDialogs['openFile']>(() => Promise.resolve(answers.shift() ?? null)),
  };
  const handlers = ioHandlers(manager, dialogs);
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
  return { handlers, call, sent, producers, dialogs, answers };
}

/** A sink that records what a producer sends. */
function sink(): StreamSink & { batches: unknown[] } {
  const batches: unknown[] = [];
  return {
    streamId: 'stream-1',
    signal: new AbortController().signal,
    batches,
    send: (payload) => batches.push(payload),
  };
}

const target = { profileId: 'p1', db: 'shop', coll: 'orders' };
const exportParams = (p: Record<string, unknown> = {}) => ({
  ...target,
  source: { kind: 'find', filter: '{}' },
  format: 'jsonl',
  ...p,
});

describe('ioHandlers', () => {
  it('serves exactly io.export, io.previewImport and io.import', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(['io.export', 'io.import', 'io.previewImport']);
  });

  describe('io.export', () => {
    it('asks for a file named after the collection, then streams the export into it', async () => {
      const { call, dialogs, answers, producers, sent } = await setup();
      const file = path.join(dir, 'chosen.json');
      answers.push(file);
      const signal = new AbortController().signal;
      const result = await call('io.export', exportParams({ format: 'json' }), { signal });
      expect(result).toEqual({ streamId: 'stream-1', path: file });
      expect(parseResult('io.export', result).ok).toBe(true);
      expect(dialogs.saveFile).toHaveBeenCalledWith(
        {
          title: 'Export documents',
          defaultName: 'orders.json',
          filters: [
            { name: 'JSON', extensions: ['json'] },
            { name: 'All files', extensions: ['*'] },
          ],
        },
        signal,
      );
      // Nothing runs before the stream's producer starts.
      expect(sent).toEqual([]);
      const out = sink();
      await expect(producers[0]?.(out)).resolves.toBe(2);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ _id: 1 }, { _id: 2 }]);
      expect(out.batches).toEqual([{ processed: 2, failed: 0, errors: [] }]);
    });

    it('offers JSON Lines files for a jsonl export', async () => {
      const { call, dialogs } = await setup();
      await call('io.export', exportParams());
      expect(dialogs.saveFile.mock.calls[0]?.[0]).toMatchObject({
        defaultName: 'orders.jsonl',
        filters: [
          { name: 'JSON Lines', extensions: ['jsonl', 'ndjson', 'json'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
    });

    it('a cancelled save dialog answers streamId null and starts nothing', async () => {
      const { call, producers, sent } = await setup();
      const result = await call('io.export', exportParams());
      expect(result).toEqual({ streamId: null, path: null });
      expect(parseResult('io.export', result).ok).toBe(true);
      expect(producers).toEqual([]);
      expect(sent).toEqual([]);
    });

    it.each(['csv', 'bson'])('answers UNSUPPORTED for %s without a dialog', async (format) => {
      const { call, dialogs } = await setup();
      await expect(call('io.export', exportParams({ format }))).rejects.toMatchObject({
        code: 'UNSUPPORTED',
      });
      expect(dialogs.saveFile).not.toHaveBeenCalled();
    });

    it('answers NOT_CONNECTED and INVALID_PARAMS before the dialog opens', async () => {
      const { call, dialogs } = await setup();
      await expect(call('io.export', exportParams({ profileId: 'p2' }))).rejects.toMatchObject({
        code: 'NOT_CONNECTED',
      });
      await expect(
        call('io.export', exportParams({ source: { kind: 'find', filter: '{"a":' } })),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      await expect(
        call('io.export', exportParams({ source: { kind: 'aggregate', pipeline: '{}' } })),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      expect(dialogs.saveFile).not.toHaveBeenCalled();
    });

    it('needs a streaming server', async () => {
      const { call, dialogs } = await setup();
      await expect(call('io.export', exportParams(), { streaming: false })).rejects.toMatchObject({
        code: 'INTERNAL',
      });
      expect(dialogs.saveFile).not.toHaveBeenCalled();
    });
  });

  describe('io.previewImport and io.import', () => {
    async function choose(name: string, text: string, format = 'jsonl') {
      const s = await setup();
      const file = path.join(dir, name);
      await writeFile(file, text);
      s.answers.push(file);
      const preview = (await s.call('io.previewImport', { format })) as {
        fileToken: string;
      } | null;
      return { ...s, file, preview };
    }

    it('previews the chosen file and hands out an opaque token, not the path', async () => {
      const text = '{"a":1}\n{"b":2}\n{"c":3}\n';
      const { preview, dialogs, file } = await choose('data.jsonl', text);
      expect(preview).toEqual({
        fileToken: expect.stringMatching(/^file-/) as string,
        fileName: 'data.jsonl',
        sizeBytes: Buffer.byteLength(text),
        sample: [
          '{"a":{"$numberInt":"1"}}',
          '{"b":{"$numberInt":"2"}}',
          '{"c":{"$numberInt":"3"}}',
        ],
      });
      expect(parseResult('io.previewImport', preview).ok).toBe(true);
      expect(preview?.fileToken).not.toContain(dir);
      expect(JSON.stringify(preview)).not.toContain(file);
      expect(dialogs.openFile.mock.calls[0]?.[0]).toEqual({
        title: 'Import documents',
        filters: [
          { name: 'JSON Lines', extensions: ['jsonl', 'ndjson', 'json'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
    });

    it('passes sampleSize to the preview', async () => {
      const s = await setup();
      const file = path.join(dir, 'a.json');
      await writeFile(file, '[{"a":1},{"a":2},{"a":3}]');
      s.answers.push(file);
      const preview = (await s.call('io.previewImport', { format: 'json', sampleSize: 2 })) as {
        sample: string[];
      };
      expect(preview.sample).toHaveLength(2);
      expect(s.dialogs.openFile.mock.calls[0]?.[0].filters?.[0]).toEqual({
        name: 'JSON',
        extensions: ['json'],
      });
    });

    it('a cancelled open dialog answers null', async () => {
      const { call } = await setup();
      const result = await call('io.previewImport', { format: 'json' });
      expect(result).toBeNull();
      expect(parseResult('io.previewImport', result).ok).toBe(true);
    });

    it.each(['csv', 'bson'])('previewImport answers UNSUPPORTED for %s', async (format) => {
      const { call, dialogs } = await setup();
      await expect(call('io.previewImport', { format })).rejects.toMatchObject({
        code: 'UNSUPPORTED',
      });
      expect(dialogs.openFile).not.toHaveBeenCalled();
    });

    it('imports the file of a token with the format it was previewed with', async () => {
      // The file is named .json but was previewed as JSON Lines: it is read as JSON Lines.
      const { preview, call, producers, sent } = await choose(
        'lines.json',
        '{"_id":1}\n{"_id":2}\n',
      );
      const result = await call('io.import', {
        ...target,
        fileToken: preview?.fileToken,
        ordered: false,
        stopOnError: false,
      });
      expect(result).toEqual({ streamId: 'stream-1' });
      expect(parseResult('io.import', result).ok).toBe(true);
      const out = sink();
      await expect(producers[0]?.(out)).resolves.toBe(2);
      const insert = sent.find((c) => 'insert' in c);
      expect(insert).toMatchObject({ insert: 'orders', ordered: false });
      expect(out.batches.at(-1)).toEqual({ processed: 2, failed: 0, errors: [] });
    });

    it('uses the stop-on-error default when the options are not given', async () => {
      const { preview, call, producers, sent } = await choose('bad.jsonl', '{"_id":1}\n{"x": }\n');
      await call('io.import', { ...target, fileToken: preview?.fileToken });
      await expect(producers[0]?.(sink())).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      expect(sent.find((c) => 'insert' in c)).toMatchObject({ ordered: true });
    });

    it('a token can be imported more than once', async () => {
      const { preview, call, producers } = await choose('twice.jsonl', '{"a":1}\n');
      await call('io.import', { ...target, fileToken: preview?.fileToken });
      await call('io.import', { ...target, fileToken: preview?.fileToken });
      expect(producers).toHaveLength(2);
    });

    it('answers NOT_FOUND for an unknown token', async () => {
      const { call, producers } = await setup();
      await expect(
        call('io.import', { ...target, fileToken: `file-${'0'.repeat(8)}` }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // A path is not a token either.
      await expect(
        call('io.import', { ...target, fileToken: path.join(dir, 'x.json') }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(producers).toEqual([]);
    });

    it('refuses a csvMapping for a JSON file', async () => {
      const { preview, call, producers } = await choose('m.jsonl', '{"a":1}\n');
      await expect(
        call('io.import', {
          ...target,
          fileToken: preview?.fileToken,
          csvMapping: [{ column: 'a', path: 'a', bsonType: 'int' }],
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
        message: 'csvMapping is only for CSV files',
      });
      expect(producers).toEqual([]);
    });

    it('answers NOT_CONNECTED for a profile without an open connection', async () => {
      const { preview, call } = await choose('n.jsonl', '{"a":1}\n');
      await expect(
        call('io.import', { ...target, profileId: 'p2', fileToken: preview?.fileToken }),
      ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });

    it('needs a streaming server', async () => {
      const { preview, call } = await choose('s.jsonl', '{"a":1}\n');
      await expect(
        call('io.import', { ...target, fileToken: preview?.fileToken }, { streaming: false }),
      ).rejects.toMatchObject({ code: 'INTERNAL' });
    });

    it(`forgets the oldest token after ${String(MAX_FILE_TOKENS)} newer ones`, async () => {
      const s = await setup();
      const file = path.join(dir, 'many.jsonl');
      await writeFile(file, '{"a":1}\n');
      const tokens: string[] = [];
      for (let i = 0; i <= MAX_FILE_TOKENS; i++) {
        s.answers.push(file);
        tokens.push(
          ((await s.call('io.previewImport', { format: 'jsonl' })) as { fileToken: string })
            .fileToken,
        );
      }
      expect(new Set(tokens).size).toBe(MAX_FILE_TOKENS + 1);
      await expect(s.call('io.import', { ...target, fileToken: tokens[0] })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      for (const token of [tokens[1], tokens.at(-1)]) {
        await expect(s.call('io.import', { ...target, fileToken: token })).resolves.toMatchObject({
          streamId: expect.any(String) as string,
        });
      }
    });

    it('a failed preview hands out no token', async () => {
      const s = await setup();
      s.answers.push(path.join(dir, 'gone.jsonl'));
      await expect(s.call('io.previewImport', { format: 'jsonl' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

describe('ioHandlers and conn.close', () => {
  /**
   * A connection whose `hang` command waits until a `killOp` interrupts it; `order` records the
   * commands and the client's close (with whether `file` still existed at that moment).
   */
  async function closing(hang: string, file: string) {
    const order: string[] = [];
    let interrupt: (error: Error) => void = () => undefined;
    const client: ClientLike = {
      connect: () => Promise.resolve(),
      close: () => {
        order.push(`client.close (file ${existsSync(file) ? 'exists' : 'removed'})`);
        return Promise.resolve();
      },
      db: () => ({
        command: (command: Document) => {
          const name = Object.keys(command)[0] ?? '';
          order.push(name);
          if (name === hang) {
            return new Promise<Document>((_resolve, reject) => (interrupt = reject));
          }
          if ('hello' in command) return Promise.resolve({ isWritablePrimary: true, ok: 1 });
          if ('buildInfo' in command) return Promise.resolve({ version: '8.2.0', ok: 1 });
          if ('find' in command) {
            return Promise.resolve({
              cursor: { id: 77, ns: 'shop.orders', firstBatch: [{ _id: 1 }] },
              ok: 1,
            });
          }
          if ('currentOp' in command) return Promise.resolve({ inprog: [{ opid: 42 }], ok: 1 });
          if ('killOp' in command) {
            interrupt(new Error('operation was interrupted'));
            return Promise.resolve({ ok: 1 });
          }
          return Promise.resolve({ ok: 1 });
        },
      }),
    };
    const manager = new ConnectionManager({
      loadProfile: () => Promise.resolve(profile),
      loadSecrets: () => Promise.resolve(null),
      createClient: () => client,
    });
    await manager.open('p1', undefined);
    order.length = 0;
    const answers: (string | null)[] = [];
    const dialogs: FileDialogs = {
      saveFile: () => Promise.resolve(answers.shift() ?? null),
      openFile: () => Promise.resolve(answers.shift() ?? null),
    };
    const handlers = ioHandlers(manager, dialogs);
    const producers: StreamProducer[] = [];
    const call = (method: string, params: unknown) =>
      (handlers[method] as Handler)(params as never, {
        signal: new AbortController().signal,
        requestId: 'r1',
        openStream: (producer) => {
          producers.push(producer);
          return `stream-${String(producers.length)}`;
        },
      });
    return { manager, order, answers, producers, call };
  }

  it('io.export ends CANCELLED; the server operation, cursor and partial file go first', async () => {
    const file = path.join(dir, 'partial.jsonl');
    const { manager, order, answers, producers, call } = await closing('getMore', file);
    answers.push(file);
    await call('io.export', exportParams());
    const out = sink();
    const running = producers[0]?.(out);
    running?.catch(() => undefined);
    // The first batch is written, the next one is still running on the server.
    await vi.waitFor(() => expect(order).toEqual(['find', 'getMore']));
    expect(existsSync(file)).toBe(true);
    await manager.close('p1');
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
    expect(order).toEqual([
      'find',
      'getMore',
      'currentOp',
      'killOp',
      'killCursors',
      'client.close (file removed)',
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it('io.import ends CANCELLED; its running insert is killed before the client closes', async () => {
    const file = path.join(dir, 'in.jsonl');
    await writeFile(file, '{"_id":1}\n{"_id":2}\n');
    const { manager, order, answers, producers, call } = await closing('insert', file);
    answers.push(file);
    const preview = (await call('io.previewImport', { format: 'jsonl' })) as {
      fileToken: string;
    };
    await call('io.import', { ...target, fileToken: preview.fileToken });
    const out = sink();
    const running = producers[0]?.(out);
    running?.catch(() => undefined);
    await vi.waitFor(() => expect(order).toEqual(['insert']));
    await manager.close('p1');
    await expect(running).rejects.toMatchObject({
      code: 'CANCELLED',
      message: 'The connection was closed',
    });
    // The chosen file itself is the user's: an import never removes it.
    expect(order).toEqual(['insert', 'currentOp', 'killOp', 'client.close (file exists)']);
    expect(out.batches).toEqual([]);
  });
});

describe('dialogsOverLink', () => {
  it('calls the privileged dialog methods and answers the chosen path or null', async () => {
    const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>((method) =>
      Promise.resolve({ path: method === 'dialog.saveFile' ? '/home/alice/out.json' : null }),
    );
    const dialogs = dialogsOverLink(call);
    const signal = new AbortController().signal;
    await expect(
      dialogs.saveFile({ title: 'Export', defaultName: 'a.json' }, signal),
    ).resolves.toBe('/home/alice/out.json');
    await expect(dialogs.openFile({ title: 'Import' }, signal)).resolves.toBeNull();
    expect(call.mock.calls).toEqual([
      ['dialog.saveFile', { title: 'Export', defaultName: 'a.json' }],
      ['dialog.openFile', { title: 'Import' }],
    ]);
  });

  it('passes a failed call on', async () => {
    const dialogs = dialogsOverLink(() => Promise.reject(new RpcError('INTERNAL', 'main is gone')));
    await expect(dialogs.openFile({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'main is gone',
    });
  });
});
