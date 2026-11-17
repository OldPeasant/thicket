import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GridfsBucket, GridfsFile, ResultOf } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { READ_ONLY_HINT } from '../safety/write-control.directive';
import { DEFAULT_BUCKET, GridfsView } from './gridfs-view';
import { gridfsTabId } from './gridfs.model';

const TAB: WorkspaceTab = {
  id: gridfsTabId('p1', 'shop'),
  kind: 'gridfs',
  title: 'shop files',
  data: { profileId: 'p1', db: 'shop' },
};

function file(name: string, extra: Partial<GridfsFile> = {}): GridfsFile {
  return {
    id: `{"$oid":"64b7f0c2a1b2c3d4e5f6${String(name.length).padStart(4, '0')}"}`,
    filename: name,
    length: 1536,
    chunkSize: 261120,
    uploadDate: '2026-03-04T05:06:07.000Z',
    ...extra,
  };
}

const REPORT = file('report.pdf', {
  id: '{"$oid":"64b7f0c2a1b2c3d4e5f60001"}',
  length: 20 * 1024 * 1024,
  contentType: 'application/pdf',
});
const NOTES = file('notes.txt', { id: '"notes-id"', length: 5 });

const BUCKETS: GridfsBucket[] = [
  { name: 'fs', files: 2, hasChunks: true },
  { name: 'images', files: 0, hasChunks: false },
];

/** A fictitious path the fake save dialog chose. */
const SAVED = '/home/example/Downloads/report.pdf';

/** A promise with its resolve function, to answer requests in a chosen order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('GridfsView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<GridfsView>;
  let view: GridfsView;
  let buckets: GridfsBucket[];
  let files: GridfsFile[];
  let confirm: ConfirmService;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) => [
    ...root.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const q = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()) =>
    root.querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = el()): T => {
    const found = q<T>(id, root);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const row = (name: string): HTMLElement => {
    const found = el().querySelector<HTMLElement>(
      `[data-testid="gridfs-row"][data-name="${name}"]`,
    );
    if (found === null) throw new Error(`no row ${name}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const click = async (button: HTMLElement) => {
    button.click();
    await settle();
  };
  const sent = (
    method:
      'gridfs.buckets' | 'gridfs.files' | 'gridfs.upload' | 'gridfs.download' | 'gridfs.delete',
  ) => fake.requestsFor(method).map((r) => r.params as Record<string, unknown>);
  const select = async (name: string) => {
    const element = get<HTMLSelectElement>('gridfs-bucket');
    element.value = name;
    element.dispatchEvent(new Event('change'));
    await settle();
  };
  const typeFilter = async (value: string) => {
    const input = get<HTMLInputElement>('gridfs-filter');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  const setProfile = (readOnly: boolean, production = false) =>
    TestBed.inject(ProfileSafetyService).set({ id: 'p1', name: 'Local', readOnly, production });

  const create = async (tab: WorkspaceTab = TAB) => {
    fixture = TestBed.createComponent(GridfsView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', tab);
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    buckets = BUCKETS;
    files = [REPORT, NOTES];
    fake.handle('gridfs.buckets', () => ({ buckets }));
    fake.handle('gridfs.files', (p) => ({
      files: p.bucket === 'fs' ? files : [],
      total: p.bucket === 'fs' ? files.length : 0,
    }));
    fake.respond('gridfs.upload', { streamId: 'up1', fileName: 'photo.png', sizeBytes: 4096 });
    fake.respond('gridfs.download', { streamId: 'down1', path: SAVED });
    fake.respond('gridfs.delete', { deleted: true });
    TestBed.configureTestingModule({
      imports: [GridfsView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    setProfile(false);
    confirm = TestBed.inject(ConfirmService);
  });

  describe('listing', () => {
    beforeEach(() => create());

    it('reads the buckets of the tab database, then the files of the first bucket', () => {
      expect(sent('gridfs.buckets')).toEqual([{ profileId: 'p1', db: 'shop' }]);
      expect(sent('gridfs.files')).toEqual([{ profileId: 'p1', db: 'shop', bucket: 'fs' }]);
      expect(view.bucket()).toBe('fs');
    });

    it('shows the mongosh call of the bucket and the buckets to pick from', () => {
      expect(text(get('gridfs-call'))).toBe('db.getGridFSBucket({ bucketName: "fs" }).find()');
      const options = [...get<HTMLSelectElement>('gridfs-bucket').options];
      expect(options.map((o) => o.value)).toEqual(['fs', 'images']);
      expect(get<HTMLSelectElement>('gridfs-bucket').value).toBe('fs');
    });

    it('shows one row per file in server order with name, type, size and upload date', () => {
      expect(all('gridfs-row').map((r) => r.dataset['name'])).toEqual(['report.pdf', 'notes.txt']);
      const cells = [...row('report.pdf').querySelectorAll('th, td')].map(text);
      expect(cells[0]).toBe('report.pdf');
      expect(cells[1]).toBe('application/pdf');
      expect(cells[2]).toBe('20 MB');
      expect(cells[3]).toMatch(/^2026-03-0[34] \d\d:\d\d$/);
      // No content type → empty cell; the exact byte count is in the title.
      const notes = [...row('notes.txt').querySelectorAll('th, td')];
      expect(text(notes[1] ?? null)).toBe('');
      expect(text(notes[2] ?? null)).toBe('5 B');
      expect(notes[2]?.getAttribute('title')).toBe('5 bytes');
      expect(notes[0]?.getAttribute('title')).toBe('"notes-id"');
      expect(text(get('gridfs-count'))).toBe('2 files');
    });

    it('says "1 file" for a single file and "Newest n of total" when the list is cut', async () => {
      files = [NOTES];
      await click(get('gridfs-refresh'));
      expect(text(get('gridfs-count'))).toBe('1 file');
      fake.handle('gridfs.files', () => ({ files: [REPORT, NOTES], total: 1500 }));
      await click(get('gridfs-refresh'));
      expect(text(get('gridfs-count'))).toBe('Newest 2 of 1500 files');
    });

    it('selecting another bucket lists its files and shows its empty state', async () => {
      await select('images');
      expect(sent('gridfs.files').at(-1)).toEqual({
        profileId: 'p1',
        db: 'shop',
        bucket: 'images',
      });
      expect(text(get('gridfs-call'))).toContain('"images"');
      expect(all('gridfs-row')).toHaveLength(0);
      expect(text(get('gridfs-empty'))).toBe(
        'images has no files yet. Upload one to start the bucket.',
      );
    });

    it('selecting the bucket already shown sends nothing', () => {
      view.selectBucket('fs');
      expect(sent('gridfs.files')).toHaveLength(1);
    });

    it('filters by name (trimmed); an empty filter sends no nameContains', async () => {
      files = [];
      await typeFilter('  report ');
      expect(sent('gridfs.files').at(-1)).toEqual({
        profileId: 'p1',
        db: 'shop',
        bucket: 'fs',
        nameContains: 'report',
      });
      expect(text(get('gridfs-empty'))).toBe('No file in fs has “report” in its name.');
      await typeFilter('   ');
      expect(sent('gridfs.files').at(-1)).not.toHaveProperty('nameContains');
    });

    it('Refresh reads buckets and files again and keeps the chosen bucket', async () => {
      await select('images');
      await click(get('gridfs-refresh'));
      expect(sent('gridfs.buckets')).toHaveLength(2);
      expect(sent('gridfs.files').at(-1)?.['bucket']).toBe('images');
    });

    it('falls back to the first bucket when the chosen one is gone', async () => {
      await select('images');
      buckets = [{ name: 'fs', files: 2, hasChunks: true }];
      await click(get('gridfs-refresh'));
      expect(view.bucket()).toBe('fs');
      expect(sent('gridfs.files').at(-1)?.['bucket']).toBe('fs');
    });
  });

  it('offers the default bucket "fs" for a database without buckets', async () => {
    buckets = [];
    await create();
    expect(DEFAULT_BUCKET).toBe('fs');
    expect([...get<HTMLSelectElement>('gridfs-bucket').options].map((o) => o.value)).toEqual([
      'fs',
    ]);
    expect(sent('gridfs.files')).toEqual([{ profileId: 'p1', db: 'shop', bucket: 'fs' }]);
  });

  it('a database without buckets starts on "fs" even when another one was chosen', async () => {
    await create();
    await select('images');
    buckets = [];
    await click(get('gridfs-refresh'));
    expect(view.bucket()).toBe('fs');
  });

  it('shows "Loading files…" until the files arrive', async () => {
    const pending = deferred<ResultOf<'gridfs.files'>>();
    fake.handle('gridfs.files', () => pending.promise);
    await create();
    expect(el().textContent).toContain('Loading files…');
    expect(q('gridfs-files')).toBeNull();
    pending.resolve({ files: [NOTES], total: 1 });
    await settle();
    expect(el().textContent).not.toContain('Loading files…');
    expect(all('gridfs-row')).toHaveLength(1);
  });

  it('a tab without profile or database reads nothing', async () => {
    await create({ ...TAB, data: undefined });
    expect(sent('gridfs.buckets')).toEqual([]);
  });

  it('a new tab object for the same database does not read again', async () => {
    await create();
    fixture.componentRef.setInput('tab', { ...TAB, title: 'renamed' });
    await settle();
    expect(sent('gridfs.buckets')).toHaveLength(1);
  });

  it('another database in the tab reads its buckets', async () => {
    await create();
    fixture.componentRef.setInput('tab', { ...TAB, data: { profileId: 'p1', db: 'media' } });
    await settle();
    expect(sent('gridfs.buckets').at(-1)).toEqual({ profileId: 'p1', db: 'media' });
  });

  describe('load errors', () => {
    it('shows a failed bucket list as an alert and lists no files', async () => {
      fake.fail('gridfs.buckets', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
      await create();
      expect(text(get('gridfs-load-error'))).toContain('not authorized on shop');
      expect(get('gridfs-load-error').getAttribute('role')).toBe('alert');
      expect(sent('gridfs.files')).toEqual([]);
      expect(el().textContent).not.toContain('Loading files…');
    });

    it('shows a failed file list as an alert; Refresh recovers', async () => {
      fake.fail('gridfs.files', { code: 'SERVER_ERROR', message: 'files read failed' });
      await create();
      expect(text(get('gridfs-load-error'))).toContain('files read failed');
      fake.handle('gridfs.files', () => ({ files: [NOTES], total: 1 }));
      await click(get('gridfs-refresh'));
      expect(q('gridfs-load-error')).toBeNull();
      expect(all('gridfs-row')).toHaveLength(1);
    });

    it('a CANCELLED answer is not shown as an error', async () => {
      fake.fail('gridfs.buckets', { code: 'CANCELLED', message: 'cancelled' });
      await create();
      expect(q('gridfs-load-error')).toBeNull();
    });
  });

  describe('ordering', () => {
    it('an older file list answering last does not replace the newer one', async () => {
      await create();
      const slow = deferred<ResultOf<'gridfs.files'>>();
      const fast = deferred<ResultOf<'gridfs.files'>>();
      const answers = [slow, fast];
      fake.handle('gridfs.files', () => (answers.shift() ?? fast).promise);
      await typeFilter('r');
      await typeFilter('re');
      fast.resolve({ files: [REPORT], total: 1 });
      await settle();
      slow.resolve({ files: [NOTES], total: 1 });
      await settle();
      expect(all('gridfs-row').map((r) => r.dataset['name'])).toEqual(['report.pdf']);
      // The superseded request was cancelled at the bridge.
      expect(fake.cancels.length).toBeGreaterThanOrEqual(1);
    });

    it('an older file list failing last shows no error', async () => {
      await create();
      const slow = deferred<ResultOf<'gridfs.files'>>();
      let calls = 0;
      fake.handle('gridfs.files', () => {
        calls++;
        return calls === 1
          ? slow.promise.then(() => ({ error: { code: 'SERVER_ERROR', message: 'late failure' } }))
          : { files: [REPORT], total: 1 };
      });
      await typeFilter('r');
      await typeFilter('re');
      slow.resolve({ files: [], total: 0 });
      await settle();
      expect(q('gridfs-load-error')).toBeNull();
      expect(all('gridfs-row')).toHaveLength(1);
    });

    it('an older bucket list answering last is ignored', async () => {
      const first = deferred<ResultOf<'gridfs.buckets'>>();
      let calls = 0;
      fake.handle('gridfs.buckets', () => {
        calls++;
        return calls === 1
          ? first.promise
          : { buckets: [{ name: 'docs', files: 1, hasChunks: true }] };
      });
      await create();
      await click(get('gridfs-refresh'));
      first.resolve({ buckets: [{ name: 'old', files: 1, hasChunks: true }] });
      await settle();
      expect([...get<HTMLSelectElement>('gridfs-bucket').options].map((o) => o.value)).toEqual([
        'docs',
      ]);
      expect(view.bucket()).toBe('docs');
    });
  });

  describe('upload', () => {
    beforeEach(() => create());

    it('sends gridfs.upload for the chosen bucket without confirming on a normal profile', async () => {
      await select('images');
      await click(get('gridfs-upload'));
      expect(confirm.current()).toBeNull();
      expect(sent('gridfs.upload')).toEqual([{ profileId: 'p1', db: 'shop', bucket: 'images' }]);
    });

    it('shows progress while running, then a message and the reloaded list', async () => {
      await click(get('gridfs-upload'));
      const transfer = get('gridfs-transfer');
      expect(transfer.dataset['kind']).toBe('upload');
      expect(text(transfer)).toContain('Uploading photo.png');
      expect(text(get('gridfs-transfer-bytes'))).toBe('0 B of 4 KB');
      expect(get<HTMLButtonElement>('gridfs-upload').disabled).toBe(true);
      // Downloads wait for the running transfer.
      expect(get<HTMLButtonElement>('gridfs-download', row('notes.txt')).disabled).toBe(true);

      fake.data('gridfs.upload', 'up1', { bytes: 1024, totalBytes: 4096 });
      await settle();
      const bar = transfer.querySelector('[role="progressbar"]');
      expect(bar?.getAttribute('aria-valuenow')).toBe('25');
      expect(bar?.getAttribute('aria-label')).toBe('Upload of photo.png');
      expect(text(get('gridfs-transfer-bytes'))).toBe('1 KB of 4 KB');

      files = [file('photo.png', { length: 4096 }), REPORT, NOTES];
      fake.data('gridfs.upload', 'up1', {
        bytes: 4096,
        totalBytes: 4096,
        fileId: '{"$oid":"64b7f0c2a1b2c3d4e5f60999"}',
      });
      fake.end('up1', { delivered: 4096 });
      await settle();
      expect(q('gridfs-transfer')).toBeNull();
      expect(text(get('gridfs-message'))).toBe('Uploaded photo.png to fs.');
      expect(get('gridfs-message').getAttribute('role')).toBe('status');
      expect(sent('gridfs.buckets')).toHaveLength(2);
      expect(all('gridfs-row').map((r) => r.dataset['name'])).toContain('photo.png');
      expect(get<HTMLButtonElement>('gridfs-upload').disabled).toBe(false);
    });

    it('a cancelled open dialog (streamId null) shows nothing and allows another upload', async () => {
      fake.respond('gridfs.upload', { streamId: null, fileName: null, sizeBytes: null });
      await click(get('gridfs-upload'));
      expect(q('gridfs-transfer')).toBeNull();
      expect(q('gridfs-message')).toBeNull();
      expect(sent('gridfs.buckets')).toHaveLength(1);
      await click(get('gridfs-upload'));
      expect(sent('gridfs.upload')).toHaveLength(2);
    });

    it('Cancel stops the stream at the backend and reloads the list (it may have committed)', async () => {
      await click(get('gridfs-upload'));
      fake.data('gridfs.upload', 'up1', { bytes: 1024, totalBytes: 4096 });
      await settle();
      expect(sent('gridfs.buckets')).toHaveLength(1);
      await click(get('gridfs-transfer-cancel'));
      expect(fake.cancels).toContain('up1');
      expect(q('gridfs-transfer')).toBeNull();
      expect(text(get('gridfs-message'))).toBe('Cancelled the upload of photo.png.');
      expect(sent('gridfs.buckets')).toHaveLength(2);
      // Later events of the cancelled stream change nothing.
      fake.data('gridfs.upload', 'up1', { bytes: 4096, totalBytes: 4096 });
      fake.end('up1');
      await settle();
      expect(q('gridfs-transfer')).toBeNull();
      expect(text(get('gridfs-message'))).toContain('Cancelled');
      // A new upload can start.
      await click(get('gridfs-upload'));
      expect(sent('gridfs.upload')).toHaveLength(2);
    });

    it('a stream failing midway shows an alert and ends the transfer', async () => {
      await click(get('gridfs-upload'));
      fake.failStream('up1', { code: 'SERVER_ERROR', message: 'disk quota exceeded (fictitious)' });
      await settle();
      expect(q('gridfs-transfer')).toBeNull();
      expect(text(get('gridfs-message'))).toContain('disk quota exceeded (fictitious)');
      expect(get('gridfs-message').getAttribute('role')).toBe('alert');
      expect(get<HTMLButtonElement>('gridfs-upload').disabled).toBe(false);
    });

    it('a failed request shows an alert', async () => {
      fake.fail('gridfs.upload', { code: 'INTERNAL', message: 'Could not read the file' });
      await click(get('gridfs-upload'));
      expect(text(get('gridfs-message'))).toContain('Could not read the file');
      expect(q('gridfs-transfer')).toBeNull();
    });

    it('ignores a second upload while one is starting or running', async () => {
      const pending = deferred<ResultOf<'gridfs.upload'>>();
      fake.handle('gridfs.upload', () => pending.promise);
      await click(get('gridfs-upload'));
      // The open dialog is still up (request pending): a second click sends nothing.
      await click(get('gridfs-upload'));
      expect(sent('gridfs.upload')).toHaveLength(1);
      pending.resolve({ streamId: 'up1', fileName: 'a.bin', sizeBytes: 1 });
      await settle();
      await view.upload();
      expect(sent('gridfs.upload')).toHaveLength(1);
    });
  });

  it('asks before an upload on a production profile; cancel sends nothing', async () => {
    setProfile(false, true);
    await create();
    await click(get('gridfs-upload'));
    expect(confirm.current()).not.toBeNull();
    expect(confirm.current()?.operation).toContain('openUploadStream');
    confirm.answer(false);
    await settle();
    expect(sent('gridfs.upload')).toEqual([]);
    expect(q('gridfs-message')).toBeNull();

    await click(get('gridfs-upload'));
    confirm.answer(true);
    await settle();
    expect(sent('gridfs.upload')).toEqual([
      { profileId: 'p1', db: 'shop', bucket: 'fs', confirmed: true },
    ]);
  });

  it('titles the production upload confirm dialog in words, not with the method name', async () => {
    setProfile(false, true);
    await create();
    await click(get('gridfs-upload'));
    expect(confirm.current()?.title).not.toBe('gridfs.upload');
    confirm.answer(false);
    await settle();
  });

  describe('download', () => {
    beforeEach(() => create());

    it('sends the file id of the row and shows progress, then where it was saved', async () => {
      await click(get('gridfs-download', row('report.pdf')));
      expect(sent('gridfs.download')).toEqual([
        { profileId: 'p1', db: 'shop', bucket: 'fs', id: REPORT.id },
      ]);
      const transfer = get('gridfs-transfer');
      expect(transfer.dataset['kind']).toBe('download');
      expect(text(transfer)).toContain('Downloading report.pdf');
      expect(text(get('gridfs-transfer-bytes'))).toBe('0 B of 20 MB');

      fake.data('gridfs.download', 'down1', {
        bytes: 10 * 1024 * 1024,
        totalBytes: 20 * 1024 * 1024,
      });
      await settle();
      expect(transfer.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
        '50',
      );

      fake.end('down1', { delivered: 20 * 1024 * 1024 });
      await settle();
      expect(q('gridfs-transfer')).toBeNull();
      expect(text(get('gridfs-message'))).toBe(`Downloaded report.pdf to ${SAVED}.`);
      // A download changes nothing in the bucket: no reload.
      expect(sent('gridfs.buckets')).toHaveLength(1);
    });

    it('a cancelled save dialog shows nothing', async () => {
      fake.respond('gridfs.download', { streamId: null, path: null });
      await click(get('gridfs-download', row('notes.txt')));
      expect(q('gridfs-transfer')).toBeNull();
      expect(q('gridfs-message')).toBeNull();
    });

    it('Cancel stops the download at the backend', async () => {
      await click(get('gridfs-download', row('report.pdf')));
      await click(get('gridfs-transfer-cancel'));
      expect(fake.cancels).toContain('down1');
      expect(text(get('gridfs-message'))).toBe('Cancelled the download of report.pdf.');
      // A download changes nothing in the bucket: no reload.
      expect(sent('gridfs.buckets')).toHaveLength(1);
    });

    it('a missing file shows the NOT_FOUND message', async () => {
      fake.fail('gridfs.download', { code: 'NOT_FOUND', message: 'No file with this id' });
      await click(get('gridfs-download', row('notes.txt')));
      expect(text(get('gridfs-message'))).toContain('No file with this id');
      expect(get('gridfs-message').getAttribute('role')).toBe('alert');
    });

    it('is allowed on a read-only profile', async () => {
      setProfile(true);
      await settle();
      expect(get<HTMLButtonElement>('gridfs-download', row('notes.txt')).disabled).toBe(false);
    });

    it('closing the tab cancels a running download', async () => {
      await click(get('gridfs-download', row('report.pdf')));
      fixture.destroy();
      expect(fake.cancels).toContain('down1');
    });

    it('runs one transfer at a time: no download or upload while one runs', async () => {
      await click(get('gridfs-download', row('report.pdf')));
      view.download(NOTES);
      await view.upload();
      await settle();
      expect(sent('gridfs.download')).toHaveLength(1);
      expect(sent('gridfs.upload')).toEqual([]);
      expect(text(get('gridfs-transfer'))).toContain('report.pdf');
    });
  });

  describe('delete', () => {
    beforeEach(() => create());

    it('always asks first, describing the file; cancel sends nothing', async () => {
      await click(get('gridfs-delete', row('report.pdf')));
      const request = confirm.current();
      expect(request).not.toBeNull();
      expect(request?.confirmLabel).toBe('Delete file');
      expect(request?.detail).toBe('Deletes report.pdf (20 MB) and its chunks from fs.');
      expect(request?.operation).toBe(
        'db.getSiblingDB("shop").getGridFSBucket({ bucketName: "fs" }).delete(ObjectId("64b7f0c2a1b2c3d4e5f60001"))',
      );
      expect(request?.namespace).toBe('shop');
      // While the dialog is open the other delete buttons wait.
      expect(get<HTMLButtonElement>('gridfs-delete', row('notes.txt')).disabled).toBe(true);
      confirm.answer(false);
      await settle();
      expect(sent('gridfs.delete')).toEqual([]);
      expect(q('gridfs-message')).toBeNull();
      expect(view.deleting()).toBeNull();
      expect(get<HTMLButtonElement>('gridfs-delete', row('notes.txt')).disabled).toBe(false);
    });

    it('marks the delete as destructive, so Enter does not confirm it by accident', async () => {
      await click(get('gridfs-delete', row('report.pdf')));
      expect(confirm.current()?.destructive).toBe(true);
      confirm.answer(false);
      await settle();
    });

    it('titles the confirm dialog in words, not with the method name', async () => {
      await click(get('gridfs-delete', row('report.pdf')));
      expect(confirm.current()?.title).not.toBe('gridfs.delete');
      confirm.answer(false);
      await settle();
    });

    it('sends gridfs.delete with confirmed after the user confirms, then reloads', async () => {
      await click(get('gridfs-delete', row('notes.txt')));
      files = [REPORT];
      confirm.answer(true);
      await settle();
      expect(sent('gridfs.delete')).toEqual([
        { profileId: 'p1', db: 'shop', bucket: 'fs', id: '"notes-id"', confirmed: true },
      ]);
      expect(text(get('gridfs-message'))).toBe('Deleted notes.txt.');
      expect(sent('gridfs.buckets')).toHaveLength(2);
      expect(all('gridfs-row').map((r) => r.dataset['name'])).toEqual(['report.pdf']);
    });

    it('says when the file was already gone', async () => {
      fake.respond('gridfs.delete', { deleted: false });
      await click(get('gridfs-delete', row('notes.txt')));
      confirm.answer(true);
      await settle();
      expect(text(get('gridfs-message'))).toBe('notes.txt was already gone.');
    });

    it('shows a server error as an alert and keeps the list', async () => {
      fake.fail('gridfs.delete', { code: 'SERVER_ERROR', message: 'not authorized to remove' });
      await click(get('gridfs-delete', row('notes.txt')));
      confirm.answer(true);
      await settle();
      expect(text(get('gridfs-message'))).toContain('not authorized to remove');
      expect(get('gridfs-message').getAttribute('role')).toBe('alert');
      expect(all('gridfs-row')).toHaveLength(2);
      expect(view.deleting()).toBeNull();
    });

    it('ignores a second delete while one is pending', async () => {
      await click(get('gridfs-delete', row('notes.txt')));
      await view.remove(REPORT);
      confirm.answer(true);
      await settle();
      expect(sent('gridfs.delete').map((p) => p['id'])).toEqual(['"notes-id"']);
    });
  });

  describe('read-only profile', () => {
    beforeEach(async () => {
      setProfile(true);
      await create();
    });

    it('disables upload and delete with the read-only hint but still lists and downloads', () => {
      expect(all('gridfs-row')).toHaveLength(2);
      for (const button of [
        get<HTMLButtonElement>('gridfs-upload'),
        ...all<HTMLButtonElement>('gridfs-delete'),
      ]) {
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('title')).toBe(READ_ONLY_HINT);
      }
      expect(get<HTMLButtonElement>('gridfs-refresh').disabled).toBe(false);
    });

    it('refuses an upload or delete called directly before anything is sent or asked', async () => {
      await view.upload();
      await settle();
      expect(sent('gridfs.upload')).toEqual([]);
      expect(text(get('gridfs-message'))).toContain('Local is read-only.');
      await view.remove(NOTES);
      await settle();
      expect(confirm.current()).toBeNull();
      expect(sent('gridfs.delete')).toEqual([]);
      expect(text(get('gridfs-message'))).toContain('Local is read-only.');
    });
  });
});
