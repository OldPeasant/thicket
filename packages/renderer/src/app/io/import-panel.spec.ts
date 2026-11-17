import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { Request } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import {
  type ImportPreview,
  ImportPanel,
  PREVIEW_SAMPLE_SIZE,
  PREVIEW_SHOWN,
} from './import-panel';

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };

/** `n` fictitious documents `{_id: Int32(i), name: "item i"}` as canonical EJSON. */
function docs(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `{"_id":{"$numberInt":"${i + 1}"},"name":"item ${i + 1}"}`,
  );
}

const PREVIEW: ImportPreview = {
  fileToken: 'tok-1',
  fileName: 'orders-sample.json',
  sizeBytes: 1536,
  sample: docs(PREVIEW_SAMPLE_SIZE),
};

/** A promise settled from the outside, to hold a request open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ImportPanel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ImportPanel>;
  let safety: ProfileSafetyService;
  let confirm: ConfirmService;
  let closed: number;
  let imported: { coll: string; inserted: number }[];

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const click = (id: string) => get<HTMLButtonElement>(id).click();
  const type = (id: string, value: string) => {
    const input = get<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const phase = () => get('import-status').getAttribute('data-phase');
  const imports = (): Request[] => fake.requestsFor('io.import');
  const collLists = () => fake.requestsFor('coll.list');

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  const create = async () => {
    fixture = TestBed.createComponent(ImportPanel);
    fixture.componentRef.setInput('target', TARGET);
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.componentInstance.imported.subscribe((event) => imported.push(event));
    await settle();
  };

  /** Chooses the file `PREVIEW` (the fake open dialog). */
  const choose = async () => {
    click('import-choose');
    await settle();
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    fake.respond('io.previewImport', PREVIEW);
    fake.handle('io.import', () => ({ streamId: 'i1' }));
    fake.respond('coll.list', { collections: [] });
    closed = 0;
    imported = [];
    TestBed.configureTestingModule({
      imports: [ImportPanel],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    safety = TestBed.inject(ProfileSafetyService);
    confirm = TestBed.inject(ConfirmService);
    safety.set({ id: 'p1', name: 'Local test', readOnly: false, production: false });
    await create();
  });

  describe('preview', () => {
    it('starts idle with no file, no import button and no request', () => {
      expect(phase()).toBe('idle');
      expect(q('import-file')).toBeNull();
      expect(q('import-start')).toBeNull();
      expect(get('import-choose').textContent?.trim()).toBe('Choose file…');
      expect(fake.requests).toHaveLength(0);
    });

    it('asks for a preview of the chosen format and shows the first documents', async () => {
      get<HTMLInputElement>('import-format-jsonl').click();
      await settle();
      await choose();
      expect(fake.requestsFor('io.previewImport')[0]?.params).toEqual({
        format: 'jsonl',
        sampleSize: PREVIEW_SAMPLE_SIZE,
      });
      expect(phase()).toBe('previewed');
      expect(q('import-file')?.textContent).toContain('orders-sample.json');
      expect(q('import-file')?.textContent).toContain('1.5 KB');
      const samples = el().querySelectorAll('[data-testid="import-sample"]');
      expect(samples).toHaveLength(PREVIEW_SHOWN);
      expect(samples[0]?.textContent).toContain('name: "item 1"');
      expect(samples[4]?.textContent).toContain('name: "item 5"');
      expect(q('import-preview')?.textContent).toContain(
        `First ${PREVIEW_SHOWN} of the ${PREVIEW_SAMPLE_SIZE} documents`,
      );
      // The target collection defaults to the tab's.
      expect(get<HTMLInputElement>('import-coll').value).toBe('orders');
      expect(get<HTMLButtonElement>('import-start').disabled).toBe(false);
      expect(get('import-choose').textContent?.trim()).toBe('Choose another file…');
      expect(imports()).toHaveLength(0);
    });

    it('shows an empty file and unreadable sample documents without failing', async () => {
      fake.respond('io.previewImport', { ...PREVIEW, sample: [] });
      await choose();
      expect(q('import-preview')?.textContent).toContain('The file has no documents.');

      fake.respond('io.previewImport', { ...PREVIEW, sample: ['{broken'] });
      await choose();
      expect(q('import-sample')?.textContent).toBe('// unreadable document');
    });

    it('shows "choosing" and blocks a second dialog while the open dialog is up', async () => {
      const answer = deferred<ImportPreview>();
      fake.handle('io.previewImport', () => answer.promise);
      await choose();
      expect(phase()).toBe('choosing');
      expect(get<HTMLButtonElement>('import-choose').disabled).toBe(true);
      await fixture.componentInstance.choose();
      expect(fake.requestsFor('io.previewImport')).toHaveLength(1);
      answer.resolve(PREVIEW);
      await settle();
      expect(phase()).toBe('previewed');
    });

    it('a cancelled open dialog returns to idle without an error', async () => {
      fake.respond('io.previewImport', null);
      await choose();
      expect(phase()).toBe('idle');
      expect(q('import-error')).toBeNull();
      expect(q('import-file')).toBeNull();
    });

    it('a cancelled open dialog keeps the file chosen before', async () => {
      await choose();
      fake.respond('io.previewImport', null);
      await choose();
      expect(phase()).toBe('previewed');
      expect(q('import-file')?.textContent).toContain('orders-sample.json');
    });

    it('shows a failed preview as an error and drops the earlier file', async () => {
      await choose();
      fake.fail('io.previewImport', {
        code: 'INVALID_PARAMS',
        message: 'Not a JSON array (fictitious)',
      });
      await choose();
      expect(phase()).toBe('error');
      expect(q('import-error')?.textContent).toContain('Not a JSON array (fictitious)');
      expect(q('import-file')).toBeNull();
      expect(q('import-start')).toBeNull();
    });

    it('switching the format drops the chosen file (it would parse differently)', async () => {
      await choose();
      get<HTMLInputElement>('import-format-jsonl').click();
      await settle();
      expect(phase()).toBe('idle');
      expect(q('import-file')).toBeNull();
      expect(q('import-start')).toBeNull();
    });

    it('closing while the open dialog is up withdraws the request and emits closed', async () => {
      fake.handle('io.previewImport', () => deferred<ImportPreview>().promise);
      await choose();
      const id = fake.requestsFor('io.previewImport')[0]?.id;
      click('import-close');
      await settle();
      expect(fake.cancels).toContain(id);
      expect(closed).toBe(1);
      expect(q('import-error')).toBeNull();
    });
  });

  describe('import', () => {
    it('non-production: sends io.import with the options at once, without confirmed', async () => {
      await choose();
      get<HTMLInputElement>('import-ordered').click();
      get<HTMLInputElement>('import-stop-on-error').click();
      await settle();
      click('import-start');
      await settle();
      expect(confirm.current()).toBeNull();
      expect(imports()).toHaveLength(1);
      expect(imports()[0]?.params).toEqual({
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        fileToken: 'tok-1',
        ordered: false,
        stopOnError: false,
      });
      expect(phase()).toBe('importing');
      expect(q('import-cancel')).not.toBeNull();
    });

    it('imports into a new, trimmed collection name and shows it in the command', async () => {
      await choose();
      type('import-coll', '  orders_copy ');
      await settle();
      expect(q('import-command')?.textContent).toContain('db.orders_copy.insertMany(');
      expect(q('import-command')?.textContent).toContain('orders-sample.json');
      click('import-start');
      await settle();
      expect(imports()[0]?.params).toMatchObject({ coll: 'orders_copy' });
    });

    it('production: nothing is sent before the confirm dialog; confirmed: true after Import', async () => {
      safety.set({ id: 'p1', name: 'Prod (fictitious)', readOnly: false, production: true });
      await choose();
      click('import-start');
      await settle();
      expect(imports()).toHaveLength(0);
      expect(confirm.current()).toMatchObject({
        title: 'Import documents',
        confirmLabel: 'Import',
        namespace: 'shop.orders',
        connection: { name: 'Prod (fictitious)', production: true },
      });
      expect(confirm.current()?.detail).toContain('orders-sample.json');
      expect(confirm.current()?.detail).toContain('1.5 KB');

      confirm.answer(true);
      await settle();
      expect(imports()).toHaveLength(1);
      expect(imports()[0]?.params).toMatchObject({ coll: 'orders', confirmed: true });
      expect(phase()).toBe('importing');
    });

    it('production: cancelling the confirm dialog sends nothing and shows no error', async () => {
      safety.set({ id: 'p1', name: 'Prod (fictitious)', readOnly: false, production: true });
      await choose();
      click('import-start');
      await settle();
      confirm.answer(false);
      await settle();
      expect(imports()).toHaveLength(0);
      expect(q('import-error')).toBeNull();
      expect(phase()).toBe('previewed');
      expect(get<HTMLButtonElement>('import-start').disabled).toBe(false);
    });

    it('shows progress and the first failures, then the inserted count when done', async () => {
      await choose();
      click('import-start');
      await settle();
      fake.data('io.import', 'i1', {
        processed: 3,
        failed: 1,
        errors: [{ index: 2, error: { code: 'SERVER_ERROR', message: 'E11000 duplicate key' } }],
      });
      await settle();
      expect(get('import-status').textContent).toContain('3');
      expect(get('import-status').textContent).toContain('1 failed');
      const failures = get('import-failures');
      expect(failures.querySelectorAll('li')).toHaveLength(1);
      expect(failures.textContent).toContain('Line 2');
      expect(failures.textContent).toContain('SERVER_ERROR: E11000 duplicate key');

      fake.data('io.import', 'i1', {
        processed: 1200,
        failed: 2,
        errors: [
          { index: 2, error: { code: 'SERVER_ERROR', message: 'E11000 duplicate key' } },
          { index: 7, error: { code: 'INVALID_PARAMS', message: 'Unexpected token' } },
        ],
      });
      fake.end('i1');
      await settle();
      expect(phase()).toBe('done');
      expect(q('import-count')?.textContent).toBe(new Intl.NumberFormat().format(1198));
      expect(q('import-failed')?.textContent).toBe('2');
      expect(get('import-status').textContent).toContain('shop.orders');
      expect(get('import-failures').querySelectorAll('li')).toHaveLength(2);
      expect(imported).toEqual([{ coll: 'orders', inserted: 1198 }]);
      expect(fake.cancels).toHaveLength(0);
    });

    it('reloads the sidebar collections after an import (a new collection appears)', async () => {
      await choose();
      type('import-coll', 'orders_new');
      click('import-start');
      await settle();
      expect(collLists()).toHaveLength(0);
      fake.data('io.import', 'i1', { processed: 4, failed: 0, errors: [] });
      fake.end('i1');
      await settle();
      expect(collLists()).toHaveLength(1);
      expect(collLists()[0]?.params).toEqual({ profileId: 'p1', db: 'shop' });
      expect(imported).toEqual([{ coll: 'orders_new', inserted: 4 }]);
    });

    it('a failed sidebar reload does not turn a finished import into an error', async () => {
      fake.fail('coll.list', { code: 'NOT_CONNECTED', message: 'gone' });
      await choose();
      click('import-start');
      await settle();
      fake.end('i1');
      await settle();
      expect(phase()).toBe('done');
      expect(q('import-error')).toBeNull();
    });

    it('a stream that fails shows the error and still reloads the sidebar', async () => {
      await choose();
      click('import-start');
      await settle();
      fake.failStream('i1', { code: 'SERVER_ERROR', message: 'not primary (fictitious)' });
      await settle();
      expect(phase()).toBe('error');
      expect(q('import-error')?.textContent).toContain('not primary (fictitious)');
      expect(collLists()).toHaveLength(1);
      expect(imported).toHaveLength(0);
      // The file stays chosen: Import can be tried again.
      expect(get<HTMLButtonElement>('import-start').disabled).toBe(false);
    });

    it('a refused import request shows the error', async () => {
      fake.fail('io.import', { code: 'NOT_FOUND', message: 'file token expired (fictitious)' });
      await choose();
      click('import-start');
      await settle();
      expect(phase()).toBe('error');
      expect(q('import-error')?.textContent).toContain('file token expired (fictitious)');
    });

    it('Cancel stops the import stream, keeps what was inserted and reloads the sidebar', async () => {
      await choose();
      click('import-start');
      await settle();
      fake.data('io.import', 'i1', { processed: 50, failed: 0, errors: [] });
      await settle();
      click('import-cancel');
      await settle();
      expect(fake.cancels).toEqual(['i1']);
      expect(phase()).toBe('cancelled');
      expect(get('import-status').textContent).toContain('50');
      expect(collLists()).toHaveLength(1);
      expect(imported).toHaveLength(0);
    });

    it('destroying the panel stops a running import', async () => {
      await choose();
      click('import-start');
      await settle();
      fixture.destroy();
      expect(fake.cancels).toEqual(['i1']);
    });

    it('an invalid collection name blocks the import and shows why', async () => {
      await choose();
      type('import-coll', 'bad$name');
      await settle();
      // No error while typing.
      expect(el().querySelector('[role="alert"]')).toBeNull();
      click('import-start');
      await settle();
      expect(imports()).toHaveLength(0);
      const input = get<HTMLInputElement>('import-coll');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const message = el().querySelector(`#${input.getAttribute('aria-describedby') ?? 'none'}`);
      expect(message?.textContent).toContain('cannot contain $');

      type('import-coll', '   ');
      click('import-start');
      await settle();
      expect(imports()).toHaveLength(0);
      expect(el().querySelector('[role="alert"]')?.textContent).toContain('Enter a name.');

      type('import-coll', 'system.views');
      click('import-start');
      await settle();
      expect(imports()).toHaveLength(0);
      expect(el().querySelector('[role="alert"]')?.textContent).toContain('reserved');

      // Editing hides the error; a valid name imports.
      type('import-coll', 'orders_ok');
      await settle();
      expect(input.getAttribute('aria-invalid')).toBeNull();
      click('import-start');
      await settle();
      expect(imports()).toHaveLength(1);
    });
  });

  describe('read-only profiles', () => {
    it('a read-only profile gets no panel and closes it at once', async () => {
      fixture.destroy();
      closed = 0;
      safety.set({ id: 'p1', name: 'Reporting', readOnly: true, production: false });
      await create();
      expect(q('import-panel')).toBeNull();
      expect(closed).toBe(1);
      await fixture.componentInstance.choose();
      expect(fake.requestsFor('io.previewImport')).toHaveLength(0);
    });

    it('turning read-only during an import stops it and closes the panel', async () => {
      await choose();
      click('import-start');
      await settle();
      safety.set({ id: 'p1', name: 'Reporting', readOnly: true, production: false });
      await settle();
      expect(fake.cancels).toEqual(['i1']);
      expect(q('import-panel')).toBeNull();
      expect(closed).toBe(1);
    });

    it('turning read-only after the preview closes without importing', async () => {
      await choose();
      safety.set({ id: 'p1', name: 'Reporting', readOnly: true, production: false });
      await settle();
      expect(q('import-panel')).toBeNull();
      expect(closed).toBe(1);
      await fixture.componentInstance.start();
      expect(imports()).toHaveLength(0);
    });

    it('a profile turning read-only while the confirm dialog is open sends nothing', async () => {
      safety.set({ id: 'p1', name: 'Prod (fictitious)', readOnly: false, production: true });
      await choose();
      click('import-start');
      await settle();
      safety.set({ id: 'p1', name: 'Prod (fictitious)', readOnly: true, production: true });
      await settle();
      confirm.answer(true);
      await settle();
      expect(imports()).toHaveLength(0);
    });
  });
});
