import { TestBed } from '@angular/core/testing';
import type { CollectionInfo, Profile, ResultOf } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { WorkspaceService } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { formatBytes, formatDocs } from './sidebar-format';
import {
  SidebarTreeService,
  collKey,
  collNameProblem,
  collectionTabId,
  dbKey,
  dbNameProblem,
} from './sidebar-tree.service';

const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name: `Profile ${id}`,
  connectionString: 'mongodb://localhost:27017',
  readOnly: false,
  production: false,
  ...extra,
});

const coll = (name: string, type: CollectionInfo['type'] = 'collection'): CollectionInfo => ({
  name,
  type,
  raw: '{}',
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A handler answering the n-th call with the n-th deferred (explicit response order). */
function inOrder<T>(...answers: Deferred<T>[]): () => Promise<T> {
  let call = 0;
  return () => {
    const answer = answers[call++];
    if (!answer) throw new Error('unexpected extra call');
    return answer.promise;
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r));
};

describe('dbNameProblem', () => {
  it('accepts an ordinary name', () => {
    expect(dbNameProblem('shop_2024-eu')).toBeNull();
  });

  it('asks for a name when empty', () => {
    expect(dbNameProblem('')).toBe('Enter a name.');
  });

  it.each([
    'a/b',
    'a\\b',
    'a.b',
    'a"b',
    'a$b',
    'a*b',
    'a<b',
    'a>b',
    'a:b',
    'a|b',
    'a?b',
    'a b',
    ' ',
  ])('refuses the forbidden character in %j', (name) => {
    expect(dbNameProblem(name)).toContain('cannot contain');
  });

  it('allows exactly 63 bytes and refuses 64', () => {
    expect(dbNameProblem('a'.repeat(63))).toBeNull();
    expect(dbNameProblem('a'.repeat(64))).toBe('A database name has at most 63 bytes.');
  });

  it('counts bytes, not characters (multi-byte names)', () => {
    // "é" is 2 bytes in UTF-8: 32 characters = 64 bytes.
    expect(dbNameProblem('é'.repeat(31))).toBeNull();
    expect(dbNameProblem('é'.repeat(32))).toBe('A database name has at most 63 bytes.');
  });
});

describe('collNameProblem', () => {
  it('accepts ordinary and dotted names', () => {
    expect(collNameProblem('orders')).toBeNull();
    expect(collNameProblem('orders.archive')).toBeNull();
  });

  it('asks for a name when empty', () => {
    expect(collNameProblem('')).toBe('Enter a name.');
  });

  it('refuses $', () => {
    expect(collNameProblem('ord$ers')).toBe('A collection name cannot contain $.');
  });

  it('refuses the null character', () => {
    expect(collNameProblem('a\u0000b')).toBe(
      'A collection name cannot contain the null character.',
    );
  });

  it('refuses the reserved system. prefix but not a name merely containing it', () => {
    expect(collNameProblem('system.users')).toBe('Names starting with "system." are reserved.');
    expect(collNameProblem('mysystem.users')).toBeNull();
  });

  it('refuses a leading or trailing dot', () => {
    expect(collNameProblem('.orders')).toContain('start or end with a dot');
    expect(collNameProblem('orders.')).toContain('start or end with a dot');
  });
});

describe('formatBytes / formatDocs', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [2 * 1024 ** 4, '2.0 TB'],
    [1024 ** 5, '1.0 PB'],
  ])('formatBytes(%d) is %j', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('stays at PB for values beyond the last unit', () => {
    expect(formatBytes(2048 * 1024 ** 5)).toBe('2048 PB');
  });

  it('uses the singular for one document and groups thousands', () => {
    expect(formatDocs(1, 10)).toBe('1 doc, 10 B');
    expect(formatDocs(0, 0)).toBe('0 docs, 0 B');
    expect(formatDocs(12431, 2048)).toBe('12 431 docs, 2.0 KB');
  });
});

describe('keys', () => {
  it('builds the collection tab id and distinct map keys', () => {
    expect(collectionTabId('p1', 'shop', 'orders')).toBe('collection:p1:shop.orders');
    expect(dbKey('p1', 'shop')).not.toBe(dbKey('p1s', 'hop'));
    expect(collKey('p1', 'shop', 'orders')).not.toBe(collKey('p1', 'shop.orders', ''));
  });
});

describe('SidebarTreeService', () => {
  let fake: FakeThicketBridge;
  let tree: SidebarTreeService;
  let profiles: Profile[];

  beforeEach(() => {
    fake = new FakeThicketBridge();
    profiles = [profile('p1'), profile('p2')];
    fake.handle('profiles.list', () => ({ profiles }));
    fake.respond('conn.status', { connections: [] });
    fake.handle('conn.open', ({ profileId }) => ({ profileId, state: 'connected' }));
    fake.respond('conn.close', {});
    fake.handle('db.listDatabases', () => ({ databases: [{ name: 'shop' }] }));
    fake.handle('coll.list', () => ({ collections: [coll('orders')] }));
    TestBed.configureTestingModule({ providers: [provideFakeThicket(fake)] });
    tree = TestBed.inject(SidebarTreeService);
  });

  describe('profiles', () => {
    it('registers the safety flags of every loaded profile', async () => {
      profiles = [profile('ro', { readOnly: true }), profile('prod', { production: true })];
      await tree.reloadProfiles();
      const safety = TestBed.inject(ProfileSafetyService);
      expect(safety.readOnly('ro')()).toBe(true);
      expect(safety.production('ro')()).toBe(false);
      expect(safety.production('prod')()).toBe(true);
      expect(tree.profileList().map((p) => p.id)).toEqual(['ro', 'prod']);
    });

    it('applies the connection states from conn.status after loading the profiles', async () => {
      fake.respond('conn.status', { connections: [{ profileId: 'p1', state: 'connected' }] });
      await tree.reloadProfiles();
      expect(tree.conn('p1').state).toBe('connected');
      expect(tree.conn('p2').state).toBe('disconnected');
    });

    it('keeps the profiles when conn.status fails', async () => {
      fake.fail('conn.status', { code: 'INTERNAL', message: 'status down' });
      await tree.reloadProfiles();
      expect(tree.profiles().status).toBe('loaded');
    });

    it('start() loads the profiles only once', async () => {
      tree.start();
      tree.start();
      await flush();
      expect(fake.requestsFor('profiles.list')).toHaveLength(1);
    });

    it('keeps the loaded list visible (no loading state) while reloading', async () => {
      await tree.reloadProfiles();
      const slow = deferred<ResultOf<'profiles.list'>>();
      fake.handle('profiles.list', () => slow.promise);
      const reload = tree.reloadProfiles();
      expect(tree.profiles().status).toBe('loaded');
      slow.resolve({ profiles: [profile('p3')] });
      await reload;
      expect(tree.profileList().map((p) => p.id)).toEqual(['p3']);
    });

    it('ignores an older profiles.list answer that arrives after a newer one', async () => {
      const first = deferred<ResultOf<'profiles.list'>>();
      const second = deferred<ResultOf<'profiles.list'>>();
      fake.handle('profiles.list', inOrder(first, second));
      const a = tree.reloadProfiles();
      const b = tree.reloadProfiles();
      second.resolve({ profiles: [profile('new')] });
      await b;
      first.resolve({ profiles: [profile('old')] });
      await a;
      expect(tree.profileList().map((p) => p.id)).toEqual(['new']);
    });

    it('ignores an older profiles.list failure that arrives after a newer success', async () => {
      const first = deferred<
        ResultOf<'profiles.list'> | { error: { code: string; message: string } }
      >();
      let call = 0;
      fake.handle('profiles.list', () =>
        ++call === 1 ? (first.promise as never) : { profiles: [profile('new')] },
      );
      const a = tree.reloadProfiles();
      await tree.reloadProfiles();
      first.resolve({ error: { code: 'INTERNAL', message: 'late failure' } });
      await a;
      expect(tree.profiles()).toMatchObject({ status: 'loaded' });
      expect(tree.profileList().map((p) => p.id)).toEqual(['new']);
    });
  });

  describe('lists', () => {
    beforeEach(async () => {
      await tree.reloadProfiles();
    });

    it('sorts databases and collections case-insensitively and numerically', async () => {
      fake.handle('db.listDatabases', () => ({
        databases: [{ name: 'db10' }, { name: 'Beta' }, { name: 'db2' }, { name: 'alpha' }],
      }));
      fake.handle('coll.list', () => ({
        collections: [coll('Zeta'), coll('item10'), coll('item9'), coll('apple')],
      }));
      await tree.loadDatabases('p1');
      await tree.loadCollections('p1', 'shop');
      const dbs = tree.databases('p1');
      const colls = tree.collections('p1', 'shop');
      expect(dbs?.status === 'loaded' && dbs.value.map((d) => d.name)).toEqual([
        'alpha',
        'Beta',
        'db2',
        'db10',
      ]);
      expect(colls?.status === 'loaded' && colls.value.map((c) => c.name)).toEqual([
        'apple',
        'item9',
        'item10',
        'Zeta',
      ]);
    });

    it('ignores an older database list that answers after a newer one', async () => {
      const first = deferred<ResultOf<'db.listDatabases'>>();
      const second = deferred<ResultOf<'db.listDatabases'>>();
      fake.handle('db.listDatabases', inOrder(first, second));
      const a = tree.loadDatabases('p1');
      const b = tree.loadDatabases('p1', true);
      second.resolve({ databases: [{ name: 'newer', sizeOnDisk: 4096 }] });
      await b;
      first.resolve({ databases: [{ name: 'older' }] });
      await a;
      expect(tree.databases('p1')).toEqual({
        status: 'loaded',
        value: [{ name: 'newer', sizeOnDisk: 4096 }],
      });
    });

    it('ignores an older collection list failure that answers after a newer success', async () => {
      const first = deferred<{ error: { code: string; message: string } }>();
      let call = 0;
      fake.handle('coll.list', () =>
        ++call === 1 ? (first.promise as never) : { collections: [coll('fresh')] },
      );
      const a = tree.loadCollections('p1', 'shop');
      await tree.loadCollections('p1', 'shop');
      first.resolve({ error: { code: 'SERVER_ERROR', message: 'stale failure' } });
      await a;
      expect(tree.collections('p1', 'shop')).toMatchObject({
        status: 'loaded',
        value: [{ name: 'fresh' }],
      });
    });

    it('ignores an older NOT_CONNECTED database list failure after a newer success', async () => {
      await tree.connect('p1');
      const first = deferred<{ error: { code: string; message: string } }>();
      let call = 0;
      fake.handle('db.listDatabases', () =>
        ++call === 1 ? (first.promise as never) : { databases: [{ name: 'fresh' }] },
      );
      const a = tree.loadDatabases('p1');
      await tree.loadDatabases('p1');
      first.resolve({ error: { code: 'NOT_CONNECTED', message: 'old connection gone' } });
      await a;
      expect(tree.databases('p1')).toEqual({ status: 'loaded', value: [{ name: 'fresh' }] });
      expect(tree.conn('p1').state).toBe('connected');
    });

    it('ignores an older collection list that answers after a newer one', async () => {
      const first = deferred<ResultOf<'coll.list'>>();
      const second = deferred<ResultOf<'coll.list'>>();
      fake.handle('coll.list', inOrder(first, second));
      const a = tree.loadCollections('p1', 'shop');
      const b = tree.loadCollections('p1', 'shop');
      second.resolve({ collections: [coll('newer')] });
      await b;
      first.resolve({ collections: [coll('older')] });
      await a;
      expect(tree.collections('p1', 'shop')).toMatchObject({
        status: 'loaded',
        value: [{ name: 'newer' }],
      });
    });

    it('lists of different databases do not share a generation', async () => {
      const slow = deferred<ResultOf<'coll.list'>>();
      fake.handle('coll.list', ({ db }) =>
        db === 'a' ? slow.promise : { collections: [coll('in-b')] },
      );
      const a = tree.loadCollections('p1', 'a');
      await tree.loadCollections('p1', 'b');
      slow.resolve({ collections: [coll('in-a')] });
      await a;
      expect(tree.collections('p1', 'a')).toMatchObject({ status: 'loaded' });
      expect(tree.collections('p1', 'b')).toMatchObject({ status: 'loaded' });
    });

    it('shows loading on the first load and keeps the old list on reload', async () => {
      const slow = deferred<ResultOf<'coll.list'>>();
      fake.handle('coll.list', () => slow.promise);
      const first = tree.loadCollections('p1', 'shop');
      expect(tree.collections('p1', 'shop')).toEqual({ status: 'loading' });
      slow.resolve({ collections: [coll('orders')] });
      await first;
      const again = deferred<ResultOf<'coll.list'>>();
      fake.handle('coll.list', () => again.promise);
      const reload = tree.loadCollections('p1', 'shop');
      expect(tree.collections('p1', 'shop')?.status).toBe('loaded');
      again.resolve({ collections: [] });
      await reload;
      expect(tree.collections('p1', 'shop')).toEqual({ status: 'loaded', value: [] });
    });

    it('a list failure other than NOT_CONNECTED keeps the connection state', async () => {
      await tree.connect('p1');
      fake.fail('db.listDatabases', { code: 'SERVER_ERROR', message: 'not authorized' });
      await tree.loadDatabases('p1');
      expect(tree.conn('p1').state).toBe('connected');
      expect(tree.databases('p1')).toMatchObject({ status: 'error' });
    });

    it('db.listDatabases answering NOT_CONNECTED marks the connection disconnected', async () => {
      await tree.connect('p1');
      fake.fail('db.listDatabases', { code: 'NOT_CONNECTED', message: 'gone' });
      await tree.loadDatabases('p1');
      expect(tree.conn('p1').state).toBe('disconnected');
    });
  });

  describe('stats', () => {
    beforeEach(async () => {
      await tree.reloadProfiles();
    });

    it('loads db.stats without the raw document', async () => {
      fake.respond('db.stats', {
        collections: 2,
        views: 1,
        objects: 10,
        dataSize: 100,
        storageSize: 2048,
        indexSize: 512,
        raw: '{"big":"raw"}',
      });
      await tree.loadDbStats('p1', 'shop');
      expect(tree.dbStats('p1', 'shop')).toEqual({
        status: 'loaded',
        value: {
          collections: 2,
          views: 1,
          objects: 10,
          dataSize: 100,
          storageSize: 2048,
          indexSize: 512,
        },
      });
    });

    it('records the error of a failed db.stats', async () => {
      fake.fail('db.stats', { code: 'SERVER_ERROR', message: 'dbStats refused' });
      await tree.loadDbStats('p1', 'shop');
      expect(tree.dbStats('p1', 'shop')).toMatchObject({
        status: 'error',
        message: expect.stringContaining('dbStats refused'),
      });
    });

    it('shows loading, then the error of a failed coll.stats', async () => {
      const slow = deferred<{ error: { code: string; message: string } }>();
      fake.handle('coll.stats', () => slow.promise as never);
      const done = tree.loadCollStats('p1', 'shop', 'orders');
      expect(tree.collStats('p1', 'shop', 'orders')).toEqual({ status: 'loading' });
      slow.resolve({ error: { code: 'SERVER_ERROR', message: 'stats refused' } });
      await done;
      expect(tree.collStats('p1', 'shop', 'orders')).toMatchObject({
        status: 'error',
        message: expect.stringContaining('stats refused'),
      });
    });

    it('ignores an older coll.stats answer that arrives after a newer one', async () => {
      const first = deferred<ResultOf<'coll.stats'>>();
      const second = deferred<ResultOf<'coll.stats'>>();
      fake.handle('coll.stats', inOrder(first, second));
      const stats = (count: number): ResultOf<'coll.stats'> => ({
        count,
        size: 1,
        storageSize: 1,
        totalIndexSize: 1,
        nindexes: 1,
        raw: '{}',
      });
      const a = tree.loadCollStats('p1', 'shop', 'orders');
      const b = tree.loadCollStats('p1', 'shop', 'orders');
      second.resolve(stats(2));
      await b;
      first.resolve(stats(1));
      await a;
      expect(tree.collStats('p1', 'shop', 'orders')).toMatchObject({
        status: 'loaded',
        value: { count: 2 },
      });
    });
  });

  describe('connections', () => {
    beforeEach(async () => {
      await tree.reloadProfiles();
    });

    it('drops lists still loading when the connection is closed', async () => {
      await tree.connect('p1');
      const dbs = deferred<ResultOf<'db.listDatabases'>>();
      const colls = deferred<ResultOf<'coll.list'>>();
      fake.handle('db.listDatabases', () => dbs.promise);
      fake.handle('coll.list', () => colls.promise);
      const a = tree.loadDatabases('p1');
      const b = tree.loadCollections('p1', 'shop');
      await tree.disconnect('p1');
      dbs.resolve({ databases: [{ name: 'late' }] });
      colls.resolve({ collections: [coll('late')] });
      await Promise.all([a, b]);
      expect(tree.databases('p1')).toBeUndefined();
      expect(tree.collections('p1', 'shop')).toBeUndefined();
    });

    it('a late NOT_CONNECTED of the old connection does not mark a reopened one disconnected', async () => {
      await tree.connect('p1');
      const stale = deferred<{ error: { code: string; message: string } }>();
      fake.handle('coll.list', () => stale.promise as never);
      const late = tree.loadCollections('p1', 'shop');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await flush();
      await tree.connect('p1');
      stale.resolve({ error: { code: 'NOT_CONNECTED', message: 'old connection gone' } });
      await late;
      expect(tree.conn('p1').state).toBe('connected');
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
      expect(tree.collections('p1', 'shop')).toBeUndefined();
    });

    it('closing one connection keeps the requests of another one current', async () => {
      await tree.connect('p1');
      await tree.connect('p2');
      const slow = deferred<ResultOf<'coll.list'>>();
      fake.handle('coll.list', () => slow.promise);
      const p2 = tree.loadCollections('p2', 'shop');
      await tree.disconnect('p1');
      slow.resolve({ collections: [coll('kept')] });
      await p2;
      expect(tree.collections('p2', 'shop')).toMatchObject({ value: [{ name: 'kept' }] });
    });

    it('drops answers still running when the backend restarts', async () => {
      await tree.connect('p1');
      const slow = deferred<ResultOf<'db.stats'>>();
      fake.handle('db.stats', () => slow.promise);
      const stats = tree.loadDbStats('p1', 'shop');
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await flush();
      slow.resolve({
        collections: 1,
        views: 0,
        objects: 1,
        dataSize: 1,
        storageSize: 1,
        indexSize: 1,
        raw: '{}',
      });
      await stats;
      expect(tree.dbStats('p1', 'shop')).toBeUndefined();
    });

    it('promptOpen follows setPromptOpen', () => {
      expect(tree.promptOpen()).toBe(false);
      tree.setPromptOpen(true);
      expect(tree.promptOpen()).toBe(true);
      tree.setPromptOpen(false);
      expect(tree.promptOpen()).toBe(false);
    });

    it('connect loads the databases and resolves with the connected state', async () => {
      const view = await tree.connect('p1');
      expect(view).toEqual({ state: 'connected' });
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
    });

    it('connect shows connecting while conn.open is pending', async () => {
      const slow = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', () => slow.promise);
      const done = tree.connect('p1');
      expect(tree.conn('p1').state).toBe('connecting');
      slow.resolve({ profileId: 'p1', state: 'connected' });
      await done;
      expect(tree.conn('p1').state).toBe('connected');
    });

    it('a conn.open cancelled by Disconnect while connecting leaves the profile not connected', async () => {
      const pending = deferred<{ error: { code: string; message: string } }>();
      fake.handle('conn.open', () => pending.promise as never);
      const attempt = tree.connect('p1');
      expect(tree.conn('p1').state).toBe('connecting');
      await tree.disconnect('p1');
      pending.resolve({ error: { code: 'CANCELLED', message: 'The operation was cancelled.' } });
      const view = await attempt;
      expect(view).toEqual({ state: 'disconnected' });
      expect(tree.conn('p1')).toEqual({ state: 'disconnected' });
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('a late success of a conn.open made stale by Disconnect is ignored', async () => {
      const pending = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', () => pending.promise);
      const attempt = tree.connect('p1');
      await tree.disconnect('p1');
      pending.resolve({ profileId: 'p1', state: 'connected' });
      await attempt;
      expect(tree.conn('p1').state).toBe('disconnected');
      expect(tree.databases('p1')).toBeUndefined();
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('a late failure of an older conn.open does not mark a reconnected profile failed', async () => {
      const old = deferred<{ error: { code: string; message: string } }>();
      const fresh = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', inOrder<never>(old as never, fresh as never));
      const first = tree.connect('p1');
      await tree.disconnect('p1');
      const second = tree.connect('p1');
      fresh.resolve({ profileId: 'p1', state: 'connected' });
      expect(await second).toEqual({ state: 'connected' });
      old.resolve({ error: { code: 'CANCELLED', message: 'The operation was cancelled.' } });
      await first;
      expect(tree.conn('p1')).toEqual({ state: 'connected' });
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
    });

    it('a newer connect makes the older attempt stale without a disconnect', async () => {
      const old = deferred<{ error: { code: string; message: string } }>();
      const fresh = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', inOrder<never>(old as never, fresh as never));
      const first = tree.connect('p1');
      const second = tree.connect('p1');
      fresh.resolve({ profileId: 'p1', state: 'connected' });
      await second;
      old.resolve({ error: { code: 'CONNECT_FAILED', message: 'old attempt failed' } });
      await first;
      expect(tree.conn('p1')).toEqual({ state: 'connected' });
    });

    it('a conn.open answering after backend.restarted is ignored (success and failure)', async () => {
      const ok = deferred<ResultOf<'conn.open'>>();
      const failed = deferred<{ error: { code: string; message: string } }>();
      fake.handle('conn.open', inOrder<never>(ok as never, failed as never));
      const first = tree.connect('p1');
      const second = tree.connect('p2');
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await flush();
      ok.resolve({ profileId: 'p1', state: 'connected' });
      failed.resolve({ error: { code: 'INTERNAL', message: 'backend gone' } });
      expect(await first).toEqual({ state: 'disconnected' });
      expect(await second).toEqual({ state: 'disconnected' });
      expect(tree.conn('p1')).toEqual({ state: 'disconnected' });
      expect(tree.conn('p2')).toEqual({ state: 'disconnected' });
      expect(tree.databases('p1')).toBeUndefined();
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('a connect started after backend.restarted is current again', async () => {
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await flush();
      expect(await tree.connect('p1')).toEqual({ state: 'connected' });
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
    });

    it('a disconnected broadcast while connecting keeps a late CANCELLED from showing an error', async () => {
      const pending = deferred<{ error: { code: string; message: string } }>();
      fake.handle('conn.open', () => pending.promise as never);
      const attempt = tree.connect('p1');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'disconnected' },
      });
      await flush();
      pending.resolve({ error: { code: 'CANCELLED', message: 'The operation was cancelled.' } });
      expect(await attempt).toEqual({ state: 'disconnected' });
      expect(tree.conn('p1')).toEqual({ state: 'disconnected' });
    });

    it('an error broadcast while connecting wins over the late conn.open rejection', async () => {
      const pending = deferred<{ error: { code: string; message: string } }>();
      fake.handle('conn.open', () => pending.promise as never);
      const attempt = tree.connect('p1');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: {
          profileId: 'p1',
          state: 'error',
          error: { code: 'NETWORK', message: 'connection reset (broadcast)' },
        },
      });
      await flush();
      pending.resolve({ error: { code: 'NETWORK', message: 'connection reset (answer)' } });
      const view = await attempt;
      // The caller (the password prompt) still sees the error state.
      expect(view.state).toBe('error');
      expect(view.message).toContain('(broadcast)');
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('a connected broadcast while connecting does not make the attempt stale', async () => {
      const pending = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', () => pending.promise);
      const attempt = tree.connect('p1');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'connected' },
      });
      await flush();
      pending.resolve({ profileId: 'p1', state: 'connected' });
      expect(await attempt).toEqual({ state: 'connected' });
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
    });

    it('disconnecting a profile whose id is a prefix keeps another profile connect current', async () => {
      const pending = deferred<ResultOf<'conn.open'>>();
      fake.handle('conn.open', () => pending.promise);
      const attempt = tree.connect('p10');
      await tree.disconnect('p1');
      pending.resolve({ profileId: 'p10', state: 'connected' });
      expect(await attempt).toEqual({ state: 'connected' });
      expect(tree.databases('p10')).toMatchObject({ status: 'loaded' });
    });

    it('a failed conn.open becomes an error state, not a rejection, and loads nothing', async () => {
      fake.fail('conn.open', { code: 'AUTH_FAILED', message: 'Authentication failed' });
      const view = await tree.connect('p1');
      expect(view.state).toBe('error');
      expect(view.message).toContain('Authentication failed');
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(0);
    });

    it('passes the password only when given', async () => {
      await tree.connect('p1');
      await tree.connect('p2', 'pw-fictitious');
      expect(fake.requestsFor('conn.open').map((r) => r.params)).toEqual([
        { profileId: 'p1' },
        { profileId: 'p2', password: 'pw-fictitious' },
      ]);
    });

    it('asksPassword is true only for secretMode ask', async () => {
      profiles = [
        profile('ask', { auth: { mechanism: 'SCRAM-SHA-256', username: 'u', secretMode: 'ask' } }),
        profile('plain'),
      ];
      await tree.reloadProfiles();
      expect(tree.asksPassword('ask')).toBe(true);
      expect(tree.asksPassword('plain')).toBe(false);
      expect(tree.asksPassword('unknown')).toBe(false);
    });

    it('disconnect forgets the loaded lists and stats of that profile only', async () => {
      fake.respond('db.stats', {
        collections: 1,
        views: 0,
        objects: 1,
        dataSize: 1,
        storageSize: 1,
        indexSize: 1,
        raw: '{}',
      });
      for (const id of ['p1', 'p2']) {
        await tree.connect(id);
        await tree.loadCollections(id, 'shop');
        await tree.loadDbStats(id, 'shop');
      }
      await tree.disconnect('p1');
      expect(fake.requestsFor('conn.close')[0]?.params).toEqual({ profileId: 'p1' });
      expect(tree.conn('p1').state).toBe('disconnected');
      expect(tree.databases('p1')).toBeUndefined();
      expect(tree.collections('p1', 'shop')).toBeUndefined();
      expect(tree.dbStats('p1', 'shop')).toBeUndefined();
      expect(tree.conn('p2').state).toBe('connected');
      expect(tree.databases('p2')).toMatchObject({ status: 'loaded' });
      expect(tree.collections('p2', 'shop')).toMatchObject({ status: 'loaded' });
      expect(tree.dbStats('p2', 'shop')).toMatchObject({ status: 'loaded' });
    });

    it('disconnect marks the profile disconnected even when conn.close fails, and rejects', async () => {
      await tree.connect('p1');
      fake.fail('conn.close', { code: 'INTERNAL', message: 'close failed' });
      await expect(tree.disconnect('p1')).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(tree.conn('p1').state).toBe('disconnected');
      expect(tree.databases('p1')).toBeUndefined();
    });

    it('a conn.status error broadcast shows the message and forgets the lists', async () => {
      await tree.connect('p1');
      await tree.loadCollections('p1', 'shop');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: {
          profileId: 'p1',
          state: 'error',
          error: { code: 'NETWORK', message: 'connection reset' },
        },
      });
      await flush();
      expect(tree.conn('p1').state).toBe('error');
      expect(tree.conn('p1').message).toContain('connection reset');
      expect(tree.databases('p1')).toBeUndefined();
      expect(tree.collections('p1', 'shop')).toBeUndefined();
    });

    it('a connected broadcast keeps the loaded lists', async () => {
      await tree.connect('p1');
      fake.emit({
        stream: 'conn.status',
        kind: 'data',
        payload: { profileId: 'p1', state: 'connected' },
      });
      await flush();
      expect(tree.databases('p1')).toMatchObject({ status: 'loaded' });
    });

    it('backend.restarted resets every connection state, list and stat', async () => {
      fake.respond('coll.stats', {
        count: 1,
        size: 1,
        storageSize: 1,
        totalIndexSize: 1,
        nindexes: 1,
        raw: '{}',
      });
      await tree.connect('p1');
      await tree.loadCollections('p1', 'shop');
      await tree.loadCollStats('p1', 'shop', 'orders');
      fake.emit({
        stream: 'backend.restarted',
        kind: 'data',
        payload: { restarts: 1, reason: 'exit code 1' },
      });
      await flush();
      expect(tree.conn('p1').state).toBe('disconnected');
      expect(tree.databases('p1')).toBeUndefined();
      expect(tree.collections('p1', 'shop')).toBeUndefined();
      expect(tree.collStats('p1', 'shop', 'orders')).toBeUndefined();
      // The profiles themselves stay.
      expect(tree.profileList()).toHaveLength(2);
    });
  });

  describe('writes and tabs', () => {
    let ws: WorkspaceService;
    let confirm: ConfirmService;

    const openTabs = (): void => {
      tree.openCollection('p1', 'shop', { name: 'orders', type: 'collection' });
      tree.openCollection('p1', 'shop', { name: 'items', type: 'collection' });
      tree.openCollection('p1', 'other', { name: 'orders', type: 'collection' });
      tree.openCollection('p2', 'shop', { name: 'orders', type: 'collection' });
      ws.open({
        id: 'shell:p1',
        kind: 'shell',
        title: 'Shell',
        data: { profileId: 'p1', db: 'shop' },
      });
    };

    /** Answers the open confirm dialog, typing its name first. */
    const answer = async (ok: boolean): Promise<void> => {
      await flush();
      const current = confirm.current();
      if (!current) throw new Error('no confirm dialog');
      if (current.typeToConfirm !== undefined) confirm.setTyped(current.typeToConfirm);
      confirm.answer(ok);
    };

    beforeEach(async () => {
      ws = TestBed.inject(WorkspaceService);
      confirm = TestBed.inject(ConfirmService);
      profiles = [profile('p1'), profile('p2'), profile('prod', { production: true })];
      await tree.reloadProfiles();
      fake.respond('db.drop', {});
      fake.respond('coll.drop', {});
      fake.respond('coll.rename', {});
      fake.respond('coll.create', {});
      fake.respond('db.create', {});
    });

    it('openCollection opens a tab with the collection data and production flag', () => {
      tree.openCollection('prod', 'shop', { name: 'orders', type: 'timeseries' });
      expect(ws.active()).toEqual({
        id: 'collection:prod:shop.orders',
        kind: 'collection',
        title: 'orders',
        detail: 'Profile prod / shop',
        production: true,
        data: { profileId: 'prod', db: 'shop', coll: 'orders', type: 'timeseries' },
      });
    });

    it('openCollection twice selects the existing tab', () => {
      tree.openCollection('p1', 'shop', { name: 'orders', type: 'collection' });
      tree.openCollection('p1', 'shop', { name: 'orders', type: 'collection' });
      expect(ws.tabs()).toHaveLength(1);
    });

    it('openCollection of an unknown profile falls back to its id', () => {
      tree.openCollection('gone', 'shop', { name: 'orders', type: 'collection' });
      expect(ws.active()).toMatchObject({ detail: 'gone / shop', production: false });
    });

    it('openUsers opens the users and roles tab of a database with the production flag', () => {
      tree.openUsers('prod', 'shop');
      expect(ws.active()).toEqual({
        id: 'users:prod:shop',
        kind: 'users',
        title: 'shop users',
        detail: 'Profile prod / shop',
        production: true,
        data: { profileId: 'prod', db: 'shop' },
      });
    });

    it('openUsers twice selects the existing tab; another database gets its own tab', () => {
      tree.openUsers('p1', 'shop');
      tree.openUsers('p1', 'other');
      tree.openUsers('p1', 'shop');
      expect(ws.tabs().map((t) => t.id)).toEqual(['users:p1:shop', 'users:p1:other']);
      expect(ws.active()?.id).toBe('users:p1:shop');
    });

    it('openUsers of an unknown profile falls back to its id', () => {
      tree.openUsers('gone', 'shop');
      expect(ws.active()).toMatchObject({ detail: 'gone / shop', production: false });
    });

    it('dropping a database closes the tabs of its collections only', async () => {
      openTabs();
      const done = tree.dropDatabase('p1', 'shop');
      await answer(true);
      await done;
      expect(ws.tabs().map((t) => t.id)).toEqual([
        'collection:p1:other.orders',
        'collection:p2:shop.orders',
        'shell:p1',
      ]);
      expect(fake.requestsFor('db.drop')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        confirmed: true,
      });
    });

    it('dropping a database forgets its collection list and stats and reloads the databases', async () => {
      await tree.loadCollections('p1', 'shop');
      const before = fake.requestsFor('db.listDatabases').length;
      const done = tree.dropDatabase('p1', 'shop');
      await answer(true);
      await done;
      expect(tree.collections('p1', 'shop')).toBeUndefined();
      expect(fake.requestsFor('db.listDatabases')).toHaveLength(before + 1);
    });

    it('dropping a collection closes only its tab', async () => {
      openTabs();
      const done = tree.dropCollection('p1', 'shop', 'orders');
      await answer(true);
      await done;
      expect(ws.tabs().map((t) => t.id)).toEqual([
        'collection:p1:shop.items',
        'collection:p1:other.orders',
        'collection:p2:shop.orders',
        'shell:p1',
      ]);
    });

    it('a cancelled drop sends nothing, closes no tab and rejects with CANCELLED', async () => {
      openTabs();
      const done = tree.dropCollection('p1', 'shop', 'orders');
      await answer(false);
      await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(fake.requestsFor('coll.drop')).toHaveLength(0);
      expect(ws.tabs()).toHaveLength(5);
    });

    it('a failed drop closes no tab', async () => {
      openTabs();
      fake.fail('db.drop', { code: 'SERVER_ERROR', message: 'not authorized' });
      const done = tree.dropDatabase('p1', 'shop');
      await answer(true);
      await expect(done).rejects.toMatchObject({ code: 'SERVER_ERROR' });
      expect(ws.tabs()).toHaveLength(5);
    });

    it('drops always ask for the typed name, also on a non-production profile', async () => {
      const done = tree.dropDatabase('p1', 'shop');
      await flush();
      expect(confirm.current()).toMatchObject({ typeToConfirm: 'shop', destructive: true });
      // Confirming without typing the name is refused.
      confirm.answer(true);
      await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(fake.requestsFor('db.drop')).toHaveLength(0);
    });

    it('renaming closes the tab of the old name and forgets its stats', async () => {
      fake.respond('coll.stats', {
        count: 1,
        size: 1,
        storageSize: 1,
        totalIndexSize: 1,
        nindexes: 1,
        raw: '{}',
      });
      await tree.loadCollStats('p1', 'shop', 'orders');
      openTabs();
      await tree.renameCollection('p1', 'shop', 'orders', 'orders2');
      expect(fake.requestsFor('coll.rename')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        newName: 'orders2',
      });
      expect(ws.tabs().some((t) => t.id === 'collection:p1:shop.orders')).toBe(false);
      expect(ws.tabs()).toHaveLength(4);
      expect(tree.collStats('p1', 'shop', 'orders')).toBeUndefined();
    });

    describe('aggregation tabs', () => {
      /** The aggregation tab of a collection, as the collection tab's Aggregate… opens it. */
      const openAggregation = (profileId: string, db: string, name: string): void => {
        ws.open({
          id: `aggregation:${profileId}:${db}.${name}`,
          kind: 'aggregation',
          title: `${name} aggregation`,
          data: { profileId, db, coll: name, type: 'collection' },
        });
      };
      const withAggregations = (): void => {
        openTabs();
        openAggregation('p1', 'shop', 'orders');
        openAggregation('p1', 'shop', 'items');
        openAggregation('p1', 'other', 'orders');
        openAggregation('p2', 'shop', 'orders');
      };

      it('dropping a collection closes its aggregation tab too, and only that one', async () => {
        withAggregations();
        const done = tree.dropCollection('p1', 'shop', 'orders');
        await answer(true);
        await done;
        expect(ws.tabs().map((t) => t.id)).toEqual([
          'collection:p1:shop.items',
          'collection:p1:other.orders',
          'collection:p2:shop.orders',
          'shell:p1',
          'aggregation:p1:shop.items',
          'aggregation:p1:other.orders',
          'aggregation:p2:shop.orders',
        ]);
      });

      it('dropping a database closes the aggregation tabs of all its collections', async () => {
        withAggregations();
        const done = tree.dropDatabase('p1', 'shop');
        await answer(true);
        await done;
        expect(ws.tabs().map((t) => t.id)).toEqual([
          'collection:p1:other.orders',
          'collection:p2:shop.orders',
          'shell:p1',
          'aggregation:p1:other.orders',
          'aggregation:p2:shop.orders',
        ]);
      });

      it('renaming a collection closes its aggregation tab', async () => {
        withAggregations();
        await tree.renameCollection('p1', 'shop', 'orders', 'orders2');
        const ids = ws.tabs().map((t) => t.id);
        expect(ids).not.toContain('aggregation:p1:shop.orders');
        expect(ids).toContain('aggregation:p1:shop.items');
        expect(ids).toContain('aggregation:p2:shop.orders');
      });

      it('a cancelled or failed drop keeps the aggregation tab', async () => {
        withAggregations();
        const cancelled = tree.dropCollection('p1', 'shop', 'orders');
        await answer(false);
        await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
        fake.fail('coll.drop', { code: 'SERVER_ERROR', message: 'not authorized' });
        const failed = tree.dropCollection('p1', 'shop', 'orders');
        await answer(true);
        await expect(failed).rejects.toMatchObject({ code: 'SERVER_ERROR' });
        expect(ws.tabs().map((t) => t.id)).toContain('aggregation:p1:shop.orders');
      });
    });

    describe('indexes tabs', () => {
      /** The indexes tab of a collection, as the collection tab's Indexes… opens it. */
      const openIndexes = (profileId: string, db: string, name: string): void => {
        ws.open({
          id: `indexes:${profileId}:${db}.${name}`,
          kind: 'indexes',
          title: `${name} indexes`,
          data: { profileId, db, coll: name, type: 'collection' },
        });
      };
      const withIndexes = (): void => {
        openTabs();
        openIndexes('p1', 'shop', 'orders');
        openIndexes('p1', 'shop', 'items');
        openIndexes('p1', 'other', 'orders');
        openIndexes('p2', 'shop', 'orders');
      };
      const indexTabs = () =>
        ws
          .tabs()
          .filter((t) => t.kind === 'indexes')
          .map((t) => t.id);

      it('dropping a collection closes its indexes tab, and only that one', async () => {
        withIndexes();
        const done = tree.dropCollection('p1', 'shop', 'orders');
        await answer(true);
        await done;
        expect(indexTabs()).toEqual([
          'indexes:p1:shop.items',
          'indexes:p1:other.orders',
          'indexes:p2:shop.orders',
        ]);
      });

      it('dropping a database closes the indexes tabs of all its collections', async () => {
        withIndexes();
        const done = tree.dropDatabase('p1', 'shop');
        await answer(true);
        await done;
        expect(indexTabs()).toEqual(['indexes:p1:other.orders', 'indexes:p2:shop.orders']);
      });

      it('renaming a collection closes its indexes tab', async () => {
        withIndexes();
        await tree.renameCollection('p1', 'shop', 'orders', 'orders2');
        expect(indexTabs()).not.toContain('indexes:p1:shop.orders');
        expect(indexTabs()).toContain('indexes:p1:shop.items');
      });
    });

    it('create and rename on a non-production profile are sent without a dialog', async () => {
      await tree.createCollection('p1', 'shop', 'fresh');
      await tree.createDatabase('p1', 'newdb', 'first');
      expect(confirm.current()).toBeNull();
      expect(fake.requestsFor('coll.create')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'fresh',
      });
      expect(fake.requestsFor('db.create')[0]?.params).toEqual({
        profileId: 'p1',
        db: 'newdb',
        firstCollection: 'first',
      });
      // createDatabase reloads the database list and the new database's collections.
      expect(fake.requestsFor('coll.list').at(-1)?.params).toEqual({
        profileId: 'p1',
        db: 'newdb',
      });
    });

    it('create on a production profile asks first; cancelling sends nothing', async () => {
      const done = tree.createCollection('prod', 'shop', 'fresh');
      await flush();
      expect(confirm.current()?.typeToConfirm).toBeUndefined();
      expect(fake.requestsFor('coll.create')).toHaveLength(0);
      confirm.answer(false);
      await expect(done).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(fake.requestsFor('coll.create')).toHaveLength(0);
    });

    it('rename on a production profile is sent with confirmed after confirming', async () => {
      const done = tree.renameCollection('prod', 'shop', 'orders', 'orders2');
      await answer(true);
      await done;
      expect(fake.requestsFor('coll.rename')[0]?.params).toMatchObject({ confirmed: true });
    });

    it('writes on a read-only profile are refused without a request', async () => {
      profiles = [profile('ro', { readOnly: true })];
      await tree.reloadProfiles();
      await expect(tree.createDatabase('ro', 'x', 'y')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      await expect(tree.createCollection('ro', 'x', 'y')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      await expect(tree.renameCollection('ro', 'x', 'y', 'z')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      await expect(tree.dropCollection('ro', 'x', 'y')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      for (const m of ['db.create', 'coll.create', 'coll.rename', 'coll.drop'] as const) {
        expect(fake.requestsFor(m)).toHaveLength(0);
      }
    });
  });
});
