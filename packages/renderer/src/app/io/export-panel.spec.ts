import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { ParsedQuery } from '../collection/query.util';
import { ExportPanel } from './export-panel';

const TARGET = { profileId: 'p1', db: 'shop', coll: 'orders' };
const QUERY: ParsedQuery = {
  filter: '{"status":"open"}',
  sort: '{"total":{"$numberInt":"-1"}}',
  limit: 100,
  sortSpec: [{ field: 'total', direction: -1 }],
  emptyFilter: false,
};
/** A fictitious path the fake "save dialog" chose. */
const PATH = '/home/example/exports/orders.json';

describe('ExportPanel', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ExportPanel>;
  let closed: number;
  /** What `io.export` answers. */
  let result: { streamId: string | null; path: string | null };

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const click = (id: string) => get<HTMLButtonElement>(id).click();
  const status = () => get('export-status');
  const exports = () => fake.requestsFor('io.export');

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    result = { streamId: 'x1', path: PATH };
    fake.handle('io.export', () => result);
    closed = 0;
    TestBed.configureTestingModule({
      imports: [ExportPanel],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    fixture = TestBed.createComponent(ExportPanel);
    fixture.componentRef.setInput('target', TARGET);
    fixture.componentRef.setInput('query', QUERY);
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle();
  });

  it('shows the exported query as a mongosh call and starts idle', () => {
    expect(q('export-command')?.textContent).toBe(
      'db.orders.find({ status: "open" }).sort({ total: -1 }).limit(100)',
    );
    expect(status().getAttribute('data-phase')).toBe('idle');
    expect(get<HTMLInputElement>('export-format-json').checked).toBe(true);
    expect(get<HTMLInputElement>('export-mode-relaxed').checked).toBe(true);
    expect(exports()).toHaveLength(0);
  });

  it('sends the applied query with the default JSON / relaxed options', async () => {
    click('export-start');
    await settle();
    expect(exports()).toHaveLength(1);
    expect(exports()[0]?.params).toEqual({
      profileId: 'p1',
      db: 'shop',
      coll: 'orders',
      source: {
        kind: 'find',
        filter: '{"status":"open"}',
        sort: '{"total":{"$numberInt":"-1"}}',
        limit: 100,
      },
      format: 'json',
      ejsonMode: 'relaxed',
    });
  });

  it('sends the chosen format and EJSON mode', async () => {
    get<HTMLInputElement>('export-format-jsonl').click();
    get<HTMLInputElement>('export-mode-canonical').click();
    await settle();
    click('export-start');
    await settle();
    expect(exports()[0]?.params).toMatchObject({ format: 'jsonl', ejsonMode: 'canonical' });
  });

  it('a cancelled save dialog (streamId null) returns to the form without an error', async () => {
    result = { streamId: null, path: null };
    click('export-start');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('idle');
    expect(q('export-error')).toBeNull();
    expect(q('export-start')).not.toBeNull();
    expect(fake.cancels).toHaveLength(0);
    // The form still works: a second try sends again.
    result = { streamId: 'x2', path: PATH };
    click('export-start');
    await settle();
    expect(exports()).toHaveLength(2);
    expect(status().getAttribute('data-phase')).toBe('running');
  });

  it('shows the path and progress while running, then the count when done', async () => {
    click('export-start');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('running');
    expect(status().textContent).toContain(PATH);
    expect(q('export-cancel')).not.toBeNull();
    expect(q('export-start')).toBeNull();
    // Options are locked while running.
    expect(get<HTMLInputElement>('export-format-json').closest('fieldset')?.disabled).toBe(true);

    fake.data('io.export', 'x1', { processed: 1500, failed: 0, errors: [] });
    await settle();
    expect(status().textContent).toContain(new Intl.NumberFormat().format(1500));

    fake.data('io.export', 'x1', { processed: 12431, failed: 0, errors: [] });
    fake.end('x1');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('done');
    expect(q('export-count')?.textContent).toBe(new Intl.NumberFormat().format(12431));
    expect(q('export-path')?.textContent).toBe(PATH);
    expect(q('export-start')).not.toBeNull();
    expect(fake.cancels).toHaveLength(0);
  });

  it('Cancel stops the stream (the backend is told) and says how far it got', async () => {
    click('export-start');
    await settle();
    fake.data('io.export', 'x1', { processed: 40, failed: 0, errors: [] });
    await settle();
    click('export-cancel');
    await settle();
    expect(fake.cancels).toEqual(['x1']);
    expect(status().getAttribute('data-phase')).toBe('cancelled');
    expect(status().textContent).toContain('40');
    expect(status().textContent).toContain('removed');
    // Later events of the cancelled stream change nothing.
    fake.data('io.export', 'x1', { processed: 99, failed: 0, errors: [] });
    fake.end('x1');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('cancelled');
    expect(status().textContent).not.toContain('99');
  });

  it('shows a failed request as an error and allows another try', async () => {
    fake.fail('io.export', { code: 'INTERNAL', message: 'Disk full (fictitious)' });
    click('export-start');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('error');
    expect(q('export-error')?.textContent).toContain('Disk full (fictitious)');
    expect(q('export-error')?.getAttribute('role')).toBe('alert');
    expect(q('export-start')).not.toBeNull();

    fake.handle('io.export', () => ({ streamId: 'x2', path: PATH }));
    click('export-start');
    await settle();
    // A new run clears the old error.
    expect(q('export-error')).toBeNull();
    expect(status().getAttribute('data-phase')).toBe('running');
  });

  it('shows a stream that fails midway as an error', async () => {
    click('export-start');
    await settle();
    fake.failStream('x1', { code: 'SERVER_ERROR', message: 'cursor killed (fictitious)' });
    await settle();
    expect(status().getAttribute('data-phase')).toBe('error');
    expect(q('export-error')?.textContent).toContain('cursor killed (fictitious)');
    expect(q('export-cancel')).toBeNull();
  });

  it('Close cancels a running export and emits closed', async () => {
    click('export-start');
    await settle();
    click('export-close');
    await settle();
    expect(fake.cancels).toEqual(['x1']);
    expect(closed).toBe(1);
  });

  it('quotes a collection name that is not a JavaScript identifier', async () => {
    fixture.componentRef.setInput('target', { ...TARGET, coll: 'my-orders' });
    await settle();
    expect(q('export-command')?.textContent).toBe(
      'db.getCollection("my-orders").find({ status: "open" }).sort({ total: -1 }).limit(100)',
    );
  });

  it('describes the exported query while running and done, not one applied later', async () => {
    const sent = 'db.orders.find({ status: "open" }).sort({ total: -1 }).limit(100)';
    const later: ParsedQuery = { filter: '{}', sortSpec: [], emptyFilter: true };
    click('export-start');
    await settle();
    fixture.componentRef.setInput('query', later);
    await settle();
    expect(q('export-command')?.textContent).toBe(sent);
    fake.end('x1');
    await settle();
    expect(status().getAttribute('data-phase')).toBe('done');
    expect(q('export-command')?.textContent).toBe(sent);
    // A new export sends (and then describes) the query applied now.
    click('export-start');
    await settle();
    expect(exports()[1]?.params).toMatchObject({ source: { kind: 'find', filter: '{}' } });
    expect(q('export-command')?.textContent).toBe('db.orders.find({})');
  });

  it('Close while idle emits closed and cancels nothing', async () => {
    click('export-close');
    await settle();
    expect(closed).toBe(1);
    expect(fake.cancels).toHaveLength(0);
  });

  it('destroying the panel stops a running export', async () => {
    click('export-start');
    await settle();
    fixture.destroy();
    expect(fake.cancels).toEqual(['x1']);
    expect(fake.listenerCount).toBe(0);
  });
});
