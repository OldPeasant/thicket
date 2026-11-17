import { RpcError } from '@thicket/backend';
import { parseParams, parseResult, type SavedStage } from '@thicket/contract';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mainHandlers } from '../main/handlers';
import { SecretsStore } from '../secrets';
import { FakeSafeStorage } from '../secrets/testing';
import { pipelinesHandlers } from './handlers';
import {
  PIPELINES_VERSION,
  PipelineNameTakenError,
  PipelineNotFoundError,
  PipelinesReadOnlyError,
  PipelinesStore,
  type PipelinesFs,
} from './store';

const NS = { profileId: 'p1', db: 'shop', coll: 'orders' };
const OTHER_COLL = { ...NS, coll: 'customers' };
const OTHER_PROFILE = { ...NS, profileId: 'p2' };
const STAGES: SavedStage[] = [
  { stage: '{"$match":{"total":{"$gt":{"$numberInt":"100"}}}}', enabled: true },
  { stage: '{"$limit":{"$numberInt":"5"}}', enabled: false },
];
const NOW = '2026-11-17T04:00:00.000Z';
const BACKUP_STAMP = '2026-11-17T04-00-00-000Z';
const ctx = { signal: new AbortController().signal, requestId: '1' };

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'thicket-pipelines-'));
  file = path.join(dir, 'pipelines.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function setup(options: { fs?: PipelinesFs } = {}) {
  let n = 0;
  const logs: string[] = [];
  const store = new PipelinesStore({
    file,
    ...(options.fs ? { fs: options.fs } : {}),
    log: (message) => logs.push(message),
    now: () => new Date(NOW),
    newId: () => `pl-${++n}`,
  });
  return { store, logs };
}

const readJson = async (): Promise<unknown> => JSON.parse(await fs.readFile(file, 'utf8'));

describe('PipelinesStore: missing file', () => {
  it('lists nothing and writes no file', async () => {
    const { store } = setup();
    expect(await store.list(NS)).toEqual([]);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('the first save creates the file', async () => {
    const { store } = setup();
    const saved = await store.save(NS, 'Big orders', STAGES);
    expect(saved).toEqual({
      pipelineId: 'pl-1',
      name: 'Big orders',
      ...NS,
      stages: STAGES,
      updatedAt: NOW,
    });
    expect(await readJson()).toEqual({ version: PIPELINES_VERSION, pipelines: [saved] });
  });
});

describe('PipelinesStore: save, list, rename, delete', () => {
  it('keeps disabled stages and their order; a new store reads them back', async () => {
    const { store } = setup();
    await store.save(NS, 'Big orders', STAGES);
    const reopened = setup().store;
    const [saved] = await reopened.list(NS);
    expect(saved?.stages).toEqual(STAGES);
  });

  it('lists only the pipelines of the collection, sorted by name ignoring case', async () => {
    const { store } = setup();
    await store.save(NS, 'zeta', STAGES);
    await store.save(NS, 'Alpha', STAGES);
    await store.save(NS, 'beta', STAGES);
    await store.save(OTHER_COLL, 'other coll', STAGES);
    await store.save(OTHER_PROFILE, 'other profile', STAGES);
    expect((await store.list(NS)).map((p) => p.name)).toEqual(['Alpha', 'beta', 'zeta']);
    expect((await store.list(OTHER_COLL)).map((p) => p.name)).toEqual(['other coll']);
    expect((await store.list(OTHER_PROFILE)).map((p) => p.name)).toEqual(['other profile']);
  });

  it('saving under a taken name (ignoring case) replaces that pipeline and keeps its id', async () => {
    const { store } = setup();
    await store.save(NS, 'Big orders', STAGES);
    const replaced = await store.save(NS, '  BIG ORDERS ', [STAGES[0] as SavedStage]);
    expect(replaced).toMatchObject({ pipelineId: 'pl-1', name: 'BIG ORDERS', stages: [STAGES[0]] });
    expect(await store.list(NS)).toEqual([replaced]);
  });

  it('the same name in another collection is another pipeline', async () => {
    const { store } = setup();
    const a = await store.save(NS, 'Same', STAGES);
    const b = await store.save(OTHER_COLL, 'Same', STAGES);
    expect(a.pipelineId).not.toBe(b.pipelineId);
  });

  it('saves an empty pipeline', async () => {
    const { store } = setup();
    expect((await store.save(NS, 'Empty', [])).stages).toEqual([]);
  });

  it('refuses an empty name and writes nothing', async () => {
    const { store } = setup();
    await expect(store.save(NS, '   ', STAGES)).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('renames; a change of case only is allowed', async () => {
    const { store } = setup();
    const saved = await store.save(NS, 'Big orders', STAGES);
    expect(await store.rename(saved.pipelineId, ' Large orders ')).toMatchObject({
      pipelineId: saved.pipelineId,
      name: 'Large orders',
      stages: STAGES,
    });
    expect((await store.rename(saved.pipelineId, 'LARGE orders')).name).toBe('LARGE orders');
    expect((await setup().store.list(NS)).map((p) => p.name)).toEqual(['LARGE orders']);
  });

  it('refuses to rename to the name of another pipeline of the collection', async () => {
    const { store } = setup();
    const a = await store.save(NS, 'A', STAGES);
    await store.save(NS, 'B', STAGES);
    await store.save(OTHER_COLL, 'C', STAGES);
    await expect(store.rename(a.pipelineId, 'b')).rejects.toBeInstanceOf(PipelineNameTakenError);
    expect((await store.rename(a.pipelineId, 'C')).name).toBe('C');
  });

  it('rename and delete of an unknown id throw PipelineNotFoundError', async () => {
    const { store } = setup();
    await expect(store.rename('nope', 'x')).rejects.toBeInstanceOf(PipelineNotFoundError);
    await expect(store.delete('nope')).rejects.toBeInstanceOf(PipelineNotFoundError);
  });

  it('deletes one pipeline and keeps the others', async () => {
    const { store } = setup();
    const a = await store.save(NS, 'A', STAGES);
    const b = await store.save(NS, 'B', STAGES);
    await store.delete(a.pipelineId);
    expect(await store.list(NS)).toEqual([b]);
    expect(await setup().store.list(NS)).toEqual([b]);
  });

  it('returns copies: changing a result does not change the store', async () => {
    const { store } = setup();
    const saved = await store.save(NS, 'A', STAGES);
    saved.stages.push({ stage: '{}', enabled: true });
    const [listed] = await store.list(NS);
    expect(listed?.stages).toEqual(STAGES);
  });

  it('concurrent saves are serialized: none is lost', async () => {
    const { store } = setup();
    await Promise.all(['A', 'B', 'C', 'D'].map((name) => store.save(NS, name, STAGES)));
    expect((await setup().store.list(NS)).map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('PipelinesStore: corrupt file', () => {
  const backup = () => `${file}.corrupt-${BACKUP_STAMP}`;
  const valid = {
    pipelineId: 'pl-x',
    name: 'Kept',
    ...NS,
    stages: STAGES,
    updatedAt: NOW,
  };

  it.each([
    ['not JSON', '{"version": 1, "pipelines": ['],
    ['empty', ''],
    ['JSON null', 'null'],
    ['an array', '[]'],
    ['no version', JSON.stringify({ pipelines: [] })],
    ['version 0', JSON.stringify({ version: 0, pipelines: [] })],
    ['pipelines not an array', JSON.stringify({ version: 1, pipelines: {} })],
    ['an invalid entry', JSON.stringify({ version: 1, pipelines: [{ ...valid, stages: 'x' }] })],
    [
      'a stage that is not EJSON document text',
      JSON.stringify({
        version: 1,
        pipelines: [{ ...valid, stages: [{ stage: '[]', enabled: true }] }],
      }),
    ],
    ['a duplicate id', JSON.stringify({ version: 1, pipelines: [valid, valid] })],
  ])('%s: moved aside, the store starts empty', async (_name, content) => {
    await fs.writeFile(file, content);
    const { store, logs } = setup();
    expect(await store.list(NS)).toEqual([]);
    expect(await fs.readFile(backup(), 'utf8')).toBe(content);
    await expect(fs.access(file)).rejects.toThrow();
    expect(logs.join('\n')).toContain('corrupt-');
    // The next save writes a fresh file; the backup stays.
    await store.save(NS, 'New', STAGES);
    expect(await readJson()).toMatchObject({ version: 1, pipelines: [{ name: 'New' }] });
    expect(await fs.readFile(backup(), 'utf8')).toBe(content);
  });

  it('a valid file is read as is', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1, pipelines: [valid] }));
    expect(await setup().store.list(NS)).toEqual([valid]);
  });

  it('an unreadable file (EACCES) makes every operation fail and is never overwritten', async () => {
    await fs.writeFile(file, 'keep me');
    const locked: PipelinesFs = {
      readFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: (a, b) => fs.rename(a, b),
      unlink: (p) => fs.unlink(p),
    };
    const { store } = setup({ fs: locked });
    await expect(store.list(NS)).rejects.toThrow('EACCES');
    await expect(store.save(NS, 'A', STAGES)).rejects.toThrow('EACCES');
    expect(await fs.readFile(file, 'utf8')).toBe('keep me');
  });

  it('a file from a newer version is read but never written', async () => {
    const content = JSON.stringify({
      version: 9,
      pipelines: [valid, { ...valid, pipelineId: 'pl-y', stages: 'future layout' }],
    });
    await fs.writeFile(file, content);
    const { store, logs } = setup();
    expect(await store.list(NS)).toEqual([valid]);
    await expect(store.save(NS, 'A', STAGES)).rejects.toBeInstanceOf(PipelinesReadOnlyError);
    await expect(store.rename('pl-x', 'B')).rejects.toBeInstanceOf(PipelinesReadOnlyError);
    await expect(store.delete('pl-x')).rejects.toBeInstanceOf(PipelinesReadOnlyError);
    expect(await fs.readFile(file, 'utf8')).toBe(content);
    expect(logs.join('\n')).toContain('version 9');
  });
});

describe('PipelinesStore: atomic writes', () => {
  /** Real fs, but the rename of the temp file over pipelines.json fails (a crash in between). */
  function failingRename(): PipelinesFs {
    return {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => fs.writeFile(p, d, o),
      rename: () => Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' })),
      unlink: (p) => fs.unlink(p),
    };
  }

  it('writes through a flushed temp file renamed over pipelines.json', async () => {
    const calls: string[] = [];
    const spy: PipelinesFs = {
      readFile: (p, e) => fs.readFile(p, e),
      writeFile: (p, d, o) => {
        calls.push(`write ${path.basename(p)} flush=${String(o.flush)}`);
        return fs.writeFile(p, d, o);
      },
      rename: (a, b) => {
        calls.push(`rename ${path.basename(a)} -> ${path.basename(b)}`);
        return fs.rename(a, b);
      },
      unlink: (p) => fs.unlink(p),
    };
    const { store } = setup({ fs: spy });
    await store.save(NS, 'A', STAGES);
    expect(calls).toEqual([
      'write pipelines.json.tmp flush=true',
      'rename pipelines.json.tmp -> pipelines.json',
    ]);
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
  });

  it('a failed write keeps the previous file and the previous state; the temp file is removed', async () => {
    await setup().store.save(NS, 'Before', STAGES);
    const before = await fs.readFile(file, 'utf8');
    const { store } = setup({ fs: failingRename() });
    await expect(store.save(NS, 'After', STAGES)).rejects.toThrow('EIO');
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    expect((await store.list(NS)).map((p) => p.name)).toEqual(['Before']);
  });

  it('a stale temp file from a crash is removed on load; pipelines.json is what counts', async () => {
    await setup().store.save(NS, 'Committed', STAGES);
    await fs.writeFile(`${file}.tmp`, '{"version":1,"pipelines":[half');
    const { store, logs } = setup();
    expect((await store.list(NS)).map((p) => p.name)).toEqual(['Committed']);
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    expect(logs.join('\n')).toContain('unfinished write');
  });
});

describe('pipelines handlers', () => {
  function handlers() {
    const { store } = setup();
    const table = pipelinesHandlers(store);
    return (method: string, params: unknown) => {
      const parsed = parseParams(method, params);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return Promise.resolve(table[method]?.(parsed.data as never, ctx));
    };
  }

  it('save, list, rename and delete answer with valid contract results', async () => {
    const call = handlers();
    const saved = await call('pipelines.save', { ...NS, name: 'A', stages: STAGES });
    expect(parseResult('pipelines.save', saved).ok).toBe(true);
    const id = (saved as { saved: { pipelineId: string } }).saved.pipelineId;
    const listed = await call('pipelines.list', NS);
    expect(parseResult('pipelines.list', listed).ok).toBe(true);
    expect(listed).toEqual({ pipelines: [(saved as { saved: unknown }).saved] });
    const renamed = await call('pipelines.rename', { pipelineId: id, name: 'B' });
    expect(parseResult('pipelines.rename', renamed).ok).toBe(true);
    expect(await call('pipelines.delete', { pipelineId: id })).toEqual({});
    expect(await call('pipelines.list', NS)).toEqual({ pipelines: [] });
  });

  it('maps not found to NOT_FOUND and a taken name to CONFLICT', async () => {
    const call = handlers();
    await expect(call('pipelines.delete', { pipelineId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      call('pipelines.rename', { pipelineId: 'nope', name: 'x' }),
    ).rejects.toBeInstanceOf(RpcError);
    await call('pipelines.save', { ...NS, name: 'A', stages: [] });
    const b = (await call('pipelines.save', { ...NS, name: 'B', stages: [] })) as {
      saved: { pipelineId: string };
    };
    await expect(
      call('pipelines.rename', { pipelineId: b.saved.pipelineId, name: 'a' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a newer file answers UNSUPPORTED on changes', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 2, pipelines: [] }));
    const call = handlers();
    await expect(call('pipelines.save', { ...NS, name: 'A', stages: [] })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('mainHandlers serves pipelines.* only when given the store', () => {
    const secrets = new SecretsStore({
      file: path.join(dir, 'secrets.bin'),
      safeStorage: new FakeSafeStorage(),
      platform: 'linux',
    });
    expect(Object.keys(mainHandlers({ version: '1', secrets }))).not.toContain('pipelines.list');
    const { store } = setup();
    expect(Object.keys(mainHandlers({ version: '1', secrets, pipelines: store }))).toEqual(
      expect.arrayContaining([
        'pipelines.list',
        'pipelines.save',
        'pipelines.rename',
        'pipelines.delete',
      ]),
    );
  });
});
