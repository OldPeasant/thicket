import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { ShellConsole, shellTabId, showOutput } from './shell-console';

const TAB: WorkspaceTab = {
  id: shellTabId('p1'),
  kind: 'shell',
  title: 'Shell',
  detail: 'Local',
  data: { profileId: 'p1', db: 'shop' },
};

describe('ShellConsole', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ShellConsole>;
  let view: ShellConsole;
  let streamNo: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = (id: string) => [...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const input = () => get<HTMLTextAreaElement>('shell-input');
  const evals = () => fake.requestsFor('shell.eval').map((r) => r.params as { code: string });

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  const type = async (text: string, cursor = text.length) => {
    const area = input();
    area.value = text;
    area.setSelectionRange(cursor, cursor);
    area.dispatchEvent(new Event('input'));
    await settle();
  };
  const key = async (k: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: k,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    input().dispatchEvent(event);
    await settle();
    return event;
  };

  async function create(
    tab: WorkspaceTab = TAB,
    safety?: { readOnly?: boolean; production?: boolean },
  ) {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    if (safety) {
      TestBed.inject(ProfileSafetyService).set({
        id: 'p1',
        name: 'Local',
        readOnly: safety.readOnly ?? false,
        production: safety.production ?? false,
      });
    }
    fixture = TestBed.createComponent(ShellConsole);
    fixture.componentRef.setInput('tab', tab);
    view = fixture.componentInstance;
    await settle();
  }

  beforeEach(() => {
    fake = new FakeThicketBridge();
    streamNo = 0;
    fake.respond('shell.open', { sessionId: 's1', db: 'shop' });
    fake.respond('shell.close', {});
    fake.handle('shell.eval', () => ({ streamId: `st${++streamNo}` }));
  });

  it('opens a session in the tab database and shows its prompt', async () => {
    await create();
    expect(fake.requestsFor('shell.open')[0]?.params).toEqual({ profileId: 'p1', db: 'shop' });
    expect(get('shell-prompt').textContent?.trim()).toBe('shop>');
    expect(input().disabled).toBe(false);
  });

  it('shows why the session could not open and opens a new one on request', async () => {
    fake.fail('shell.open', { code: 'NOT_CONNECTED', message: 'not connected' });
    await create();
    expect(get('shell-failed').textContent).toBeTruthy();
    expect(input().disabled).toBe(true);
    fake.respond('shell.open', { sessionId: 's2', db: 'test' });
    get('shell-reopen').click();
    await settle();
    expect(q('shell-failed')).toBeNull();
    expect(get('shell-prompt').textContent?.trim()).toBe('test>');
  });

  it('runs a finished input on Enter and shows a scalar result as text', async () => {
    await create();
    await type('db.orders.countDocuments()');
    const enter = await key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(evals()).toEqual([{ sessionId: 's1', code: 'db.orders.countDocuments()' }]);
    expect(input().value).toBe('');
    expect(q('shell-running')).not.toBeNull();
    fake.data('shell.eval', 'st1', { kind: 'result', value: '{"$numberInt":"400"}', text: '400' });
    fake.end('st1');
    await settle();
    expect(get('shell-result').textContent).toBe('400');
    expect(q('shell-running')).toBeNull();
    expect(all('shell-run')[0]?.textContent).toContain('shop>');
  });

  it('continues an unfinished input on a new line instead of running it', async () => {
    await create();
    await type('function f(a) {');
    const enter = await key('Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(evals()).toEqual([]);
    // Shift+Enter never runs, Ctrl+Enter always does.
    await type('1 + 1');
    expect((await key('Enter', { shiftKey: true })).defaultPrevented).toBe(false);
    expect(evals()).toEqual([]);
    await type('function f(a) {');
    await key('Enter', { ctrlKey: true });
    expect(evals()).toHaveLength(1);
  });

  it('shows documents in the viewer, or as text with the plain-text toggle', async () => {
    await create();
    await type('db.orders.find()');
    await key('Enter');
    fake.data('shell.eval', 'st1', {
      kind: 'result',
      type: 'Cursor',
      value: '[{"_id":{"$numberInt":"1"},"status":"open"}]',
      text: "[ { _id: 1, status: 'open' } ]",
    });
    fake.end('st1');
    await settle();
    expect(q('shell-result-viewer')?.querySelector('app-json-explorer')).not.toBeNull();
    expect(q('shell-result-viewer')?.textContent).toContain('open');
    get('shell-view-text').click();
    await settle();
    expect(q('shell-result-viewer')).toBeNull();
    expect(get('shell-result').textContent).toContain("status: 'open'");
  });

  it('shows prints and errors, and follows `use db` in the prompt', async () => {
    await create();
    await type('use other');
    await key('Enter');
    fake.data('shell.eval', 'st1', { kind: 'print', text: 'switched to db other' });
    fake.data('shell.eval', 'st1', { kind: 'db', db: 'other' });
    fake.data('shell.eval', 'st1', { kind: 'error', text: 'MongoServerError: boom' });
    fake.end('st1');
    await settle();
    expect(get('shell-print').textContent).toBe('switched to db other');
    expect(get('shell-error').textContent).toBe('MongoServerError: boom');
    expect(get('shell-prompt').textContent?.trim()).toBe('other>');
  });

  it('stops a running input by cancelling its stream', async () => {
    await create();
    await type('while (true) { db.runCommand({ ping: 1 }) }');
    await key('Enter');
    get('shell-stop').click();
    await settle();
    expect(fake.cancels).toContain('st1');
    expect(q('shell-stopped')).not.toBeNull();
    expect(q('shell-run-btn')).not.toBeNull();
  });

  describe('history', () => {
    async function runAll(...codes: string[]) {
      for (const code of codes) {
        await type(code);
        await key('Enter');
        fake.end(`st${streamNo}`);
        await settle();
      }
    }

    it('steps back and forth with the arrow keys and keeps the typed draft', async () => {
      await create();
      await runAll('a = 1', 'b = 2');
      await type('draft');
      expect((await key('ArrowUp')).defaultPrevented).toBe(true);
      expect(input().value).toBe('b = 2');
      await key('ArrowUp');
      expect(input().value).toBe('a = 1');
      // At the oldest entry ArrowUp does nothing.
      expect((await key('ArrowUp')).defaultPrevented).toBe(false);
      expect(input().value).toBe('a = 1');
      await key('ArrowDown');
      expect(input().value).toBe('b = 2');
      await key('ArrowDown');
      expect(input().value).toBe('draft');
      expect((await key('ArrowDown')).defaultPrevented).toBe(false);
    });

    it('moves the caret inside a multi-line input instead of stepping', async () => {
      await create();
      await runAll('a = 1');
      await type('x = {\n  y: 1\n}', 10);
      expect((await key('ArrowUp')).defaultPrevented).toBe(false);
      expect(input().value).toBe('x = {\n  y: 1\n}');
    });

    it('does not record the same input twice in a row', async () => {
      await create();
      await runAll('a = 1', 'a = 1');
      expect(view.history.entries).toEqual(['a = 1']);
    });
  });

  describe('completion', () => {
    it('applies a single completion directly', async () => {
      fake.respond('shell.complete', { completions: ['db.orders'] });
      await create();
      await type('db.ord');
      expect((await key('Tab')).defaultPrevented).toBe(true);
      expect(fake.requestsFor('shell.complete')[0]?.params).toEqual({
        sessionId: 's1',
        code: 'db.ord',
        cursor: 6,
      });
      expect(input().value).toBe('db.orders');
      expect(q('shell-completions')).toBeNull();
    });

    it('opens a popup for several completions; arrows select, Enter applies', async () => {
      fake.respond('shell.complete', {
        completions: ['db.orders.find', 'db.orders.findOne', 'db.orders.findOneAndDelete'],
      });
      await create();
      await type('db.orders.fin');
      await key('Tab');
      const options = all('shell-completion');
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        'find',
        'findOne',
        'findOneAndDelete',
      ]);
      expect(input().getAttribute('aria-expanded')).toBe('true');
      expect(options[0]?.getAttribute('aria-selected')).toBe('true');
      await key('ArrowDown');
      expect(all('shell-completion')[1]?.getAttribute('aria-selected')).toBe('true');
      // Enter takes the completion and does not run the input.
      const enter = await key('Enter');
      expect(enter.defaultPrevented).toBe(true);
      expect(evals()).toEqual([]);
      expect(input().value).toBe('db.orders.findOne');
      expect(q('shell-completions')).toBeNull();
    });

    it('keeps the text after the caret and closes on Escape or typing', async () => {
      fake.respond('shell.complete', { completions: ['db.orders.find', 'db.orders.findOne'] });
      await create();
      await type('db.orders.fin()', 13);
      await key('Tab');
      expect(q('shell-completions')).not.toBeNull();
      await key('Escape');
      expect(q('shell-completions')).toBeNull();
      await key('Tab');
      await type('db.orders.fi()', 12);
      expect(q('shell-completions')).toBeNull();
      await type('db.orders.fin()', 13);
      await key('Tab');
      all('shell-completion')[0]?.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
      await settle();
      expect(input().value).toBe('db.orders.find()');
    });

    it('says so when there is nothing to complete; Tab after a space indents', async () => {
      fake.respond('shell.complete', { completions: [] });
      await create();
      await type('zzz');
      await key('Tab');
      expect(get('shell-completion-note').textContent).toContain('No completions');
      await type('x = ');
      await key('Tab');
      expect(input().value).toBe('x =   ');
      expect(fake.requestsFor('shell.complete')).toHaveLength(1);
    });
  });

  describe('safety', () => {
    it('warns on read-only profiles that only the server guards the shell', async () => {
      await create(TAB, { readOnly: true });
      expect(get('shell-readonly-banner').textContent).toContain('Read-only connection');
      expect(get('shell-readonly-banner').getAttribute('role')).toBe('status');
    });

    it('shows no warning on writable profiles', async () => {
      await create(TAB, { readOnly: false });
      expect(q('shell-readonly-banner')).toBeNull();
      expect(el().classList.contains('production')).toBe(false);
    });

    it('marks production profiles with the production accent', async () => {
      await create(TAB, { production: true });
      expect(el().classList.contains('production')).toBe(true);
      expect(q('shell-production')).not.toBeNull();
    });
  });

  it('offers a new session when the backend lost this one', async () => {
    await create();
    await type('1');
    await key('Enter');
    fake.failStream('st1', { code: 'NOT_FOUND', message: 'No shell session s1' });
    await settle();
    expect(q('shell-error')).not.toBeNull();
    expect(q('shell-reopen')).not.toBeNull();
  });

  it('closes the session when the tab goes away', async () => {
    await create();
    fixture.destroy();
    await settle();
    expect(fake.requestsFor('shell.close')[0]?.params).toEqual({ sessionId: 's1' });
  });
});

describe('showOutput', () => {
  it('hides db changes and keeps unreadable values as text', () => {
    expect(showOutput({ kind: 'db', db: 'x' })).toBeNull();
    expect(showOutput({ kind: 'result', text: 'f', value: '{bad' })).toEqual({
      kind: 'result',
      text: 'f',
    });
    expect(showOutput({ kind: 'result', text: '1', value: '{"$numberInt":"1"}' })).toEqual({
      kind: 'result',
      text: '1',
    });
  });
});
