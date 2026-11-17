import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Profile } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../../api/testing';
import { ImportExportPage, importSummary, uriLines } from './import-export-page';

const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name: `Profile ${id}`,
  connectionString: 'mongodb://db1.example.test:27017',
  readOnly: false,
  production: false,
  ...extra,
});

describe('uriLines / importSummary', () => {
  it('keeps the trimmed non-blank lines', () => {
    expect(uriLines(' mongodb://a \r\n\n  \nmongodb://b')).toEqual(['mongodb://a', 'mongodb://b']);
    expect(uriLines('')).toEqual([]);
  });

  it('counts imported and skipped entries', () => {
    const p = profile('a');
    expect(importSummary({ imported: [p], skipped: [] })).toBe('Imported 1 connection.');
    expect(importSummary({ imported: [p, p], skipped: [{ source: 'x', reason: 'y' }] })).toBe(
      'Imported 2 connections, skipped 1.',
    );
    expect(importSummary({ imported: [], skipped: [] })).toMatch(/no connections/);
  });
});

describe('ImportExportPage', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ImportExportPage>;
  let el: HTMLElement;
  let profiles: Profile[];

  beforeEach(() => {
    fake = new FakeThicketBridge();
    profiles = [
      profile('p1', { name: 'Orders', color: '#1f9d8b' }),
      profile('p2', { name: 'Billing' }),
    ];
    fake.handle('profiles.list', () => ({ profiles }));
    fake.handle('conn.status', () => ({ connections: [] }));
    TestBed.configureTestingModule({
      providers: [provideFakeThicket(fake), provideRouter([])],
    });
  });

  async function start(): Promise<void> {
    fixture = TestBed.createComponent(ImportExportPage);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const all = (id: string) => [...el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const one = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = el.querySelector<T>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };

  it('imports a Compass file, shows the ledger and reloads the sidebar profiles', async () => {
    const added = profile('p3', { name: 'Imported', color: '#326fde' });
    fake.handle('profiles.importCompass', () => {
      profiles = [...profiles, added];
      return {
        imported: [added],
        skipped: [{ source: 'Broken', reason: 'it has no connection string' }],
        notices: [{ source: 'Imported', reason: 'credentials are encrypted' }],
      };
    });
    await start();
    expect(fake.requestsFor('profiles.list')).toHaveLength(1);
    one('import-file').click();
    await settle();
    expect(one('import-summary').textContent).toBe('Imported 1 connection, skipped 1.');
    expect(all('import-imported').map((n) => n.dataset['name'])).toEqual(['Imported']);
    expect(one('import-notice').textContent).toContain('credentials are encrypted');
    expect(one('import-skipped').textContent).toContain('Skipped Broken');
    expect(fake.requestsFor('profiles.list')).toHaveLength(2);
    expect(all('export-pick').map((n) => n.dataset['name'])).toEqual([
      'Billing',
      'Imported',
      'Orders',
    ]);
  });

  it('shows nothing when the file dialog is cancelled', async () => {
    fake.respond('profiles.importCompass', null);
    await start();
    one('import-file').click();
    await settle();
    expect(all('transfer-outcome')).toEqual([]);
    expect(all('transfer-error')).toEqual([]);
  });

  it('shows an import error', async () => {
    fake.fail('profiles.importCompass', {
      code: 'INVALID_PARAMS',
      message: 'The file is not JSON',
    });
    await start();
    one('import-file').click();
    await settle();
    expect(one('transfer-error').textContent).toContain('The file is not JSON');
  });

  it('imports the non-blank lines of the connection strings field', async () => {
    fake.handle('profiles.importUris', ({ uris }) => ({
      imported: uris.map((u, i) => profile(`n${String(i)}`, { name: u })),
      skipped: [],
    }));
    await start();
    const submit = one<HTMLButtonElement>('import-uris-submit');
    expect(submit.disabled).toBe(true);
    const area = one<HTMLTextAreaElement>('import-uris');
    area.value = 'mongodb://a.test\n\n mongodb://b.test ';
    area.dispatchEvent(new Event('input'));
    await settle();
    expect(submit.textContent.trim()).toBe('Import 2 connections');
    submit.click();
    await settle();
    expect(fake.requestsFor('profiles.importUris')[0]?.params).toEqual({
      uris: ['mongodb://a.test', 'mongodb://b.test'],
    });
    expect(one('import-summary').textContent).toBe('Imported 2 connections.');
    expect(area.value).toBe('');
  });

  it('keeps the field when some strings were skipped', async () => {
    fake.respond('profiles.importUris', {
      imported: [],
      skipped: [{ source: 'bad', reason: 'x' }],
    });
    await start();
    const area = one<HTMLTextAreaElement>('import-uris');
    area.value = 'bad';
    area.dispatchEvent(new Event('input'));
    await settle();
    one('import-uris-submit').click();
    await settle();
    expect(area.value).toBe('bad');
  });

  it('exports the selected profiles', async () => {
    fake.handle('profiles.export', ({ profileIds }) => ({
      path: '/home/u/thicket-connections.json',
      exported: profileIds?.length ?? 0,
    }));
    await start();
    const submit = one<HTMLButtonElement>('export-submit');
    expect(submit.disabled).toBe(true);
    const orders = all('export-pick').find(
      (n) => n.dataset['name'] === 'Orders',
    ) as HTMLInputElement;
    orders.click();
    await settle();
    expect(submit.textContent.trim()).toBe('Export 1 connection…');
    submit.click();
    await settle();
    expect(fake.requestsFor('profiles.export')[0]?.params).toEqual({ profileIds: ['p1'] });
    expect(one('export-done').textContent).toContain('/home/u/thicket-connections.json');

    one<HTMLInputElement>('export-all').click();
    await settle();
    expect(submit.textContent.trim()).toBe('Export 2 connections…');
    one<HTMLInputElement>('export-all').click();
    await settle();
    expect(submit.disabled).toBe(true);
  });

  it('reports nothing when the save dialog is cancelled', async () => {
    fake.respond('profiles.export', { path: null, exported: 0 });
    await start();
    one<HTMLInputElement>('export-all').click();
    await settle();
    one('export-submit').click();
    await settle();
    expect(fake.requestsFor('profiles.export')[0]?.params).toEqual({ profileIds: ['p2', 'p1'] });
    expect(all('transfer-outcome')).toEqual([]);
  });
});
