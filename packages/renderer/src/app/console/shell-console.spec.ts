import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { ShellConsole, shellTabId, showOutput, TRANSCRIPT_LIMIT } from './shell-console';

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
      // ArrowDown above the last line moves the caret as well.
      await type('x = {\n  y: 1\n}', 2);
      expect((await key('ArrowDown')).defaultPrevented).toBe(false);
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
    // The way back sits outside the scrolling transcript, so it stays in view.
    expect(get('shell-transcript').contains(get('shell-failed'))).toBe(false);
    expect(get('shell-announce').textContent).toMatch(/Run failed: .*No shell session s1/s);
  });

  it('announces a short summary of each run instead of making the transcript live', async () => {
    await create();
    expect(get('shell-transcript').hasAttribute('aria-live')).toBe(false);
    expect(get('shell-announce').getAttribute('aria-live')).toBe('polite');
    expect(input().hasAttribute('aria-controls')).toBe(false);
    await type('db.orders.find()');
    await key('Enter');
    fake.data('shell.eval', 'st1', { kind: 'result', type: 'Cursor', text: '[ { a: 1 } ]' });
    fake.end('st1');
    await settle();
    expect(get('shell-announce').textContent?.trim()).toBe('Run finished: Cursor');
    await type('while (true) {}');
    await key('Enter');
    get('shell-stop').click();
    await settle();
    expect(get('shell-announce').textContent?.trim()).toBe('Run stopped');
  });

  it('closes the session when the tab goes away', async () => {
    await create();
    fixture.destroy();
    await settle();
    expect(fake.requestsFor('shell.close')[0]?.params).toEqual({ sessionId: 's1' });
  });

  describe('stop, clear and the transcript', () => {
    it('Ctrl+C stops a running input; with a selection it leaves the copy alone', async () => {
      await create();
      await type('while (true) {}');
      await key('Enter');
      // A selection inside the input: Ctrl+C copies, the run goes on.
      const area = input();
      area.value = 'abc';
      area.setSelectionRange(0, 2);
      const copy = await key('c', { ctrlKey: true });
      expect(copy.defaultPrevented).toBe(false);
      expect(fake.cancels).toEqual([]);
      expect(q('shell-running')).not.toBeNull();
      // Without a selection Ctrl+C interrupts.
      area.setSelectionRange(1, 1);
      const stop = await key('c', { ctrlKey: true });
      expect(stop.defaultPrevented).toBe(true);
      expect(fake.cancels).toContain('st1');
      expect(q('shell-stopped')).not.toBeNull();
      expect(q('shell-running')).toBeNull();
    });

    it('Ctrl+C does nothing while no input runs', async () => {
      await create();
      await type('x');
      const event = await key('c', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(fake.cancels).toEqual([]);
    });

    it('ignores output of a stopped run and runs the next input', async () => {
      await create();
      await type('sleep(100000)');
      await key('Enter');
      get('shell-stop').click();
      await settle();
      fake.data('shell.eval', 'st1', { kind: 'print', text: 'late print' });
      fake.end('st1');
      await settle();
      expect(q('shell-print')).toBeNull();
      expect(all('shell-run')[0]?.getAttribute('data-state')).toBe('stopped');
      await type('1');
      await key('Enter');
      expect(evals().map((e) => e.code)).toEqual(['sleep(100000)', '1']);
      fake.data('shell.eval', 'st2', { kind: 'result', text: '1' });
      fake.end('st2');
      await settle();
      expect(get('shell-result').textContent).toBe('1');
    });

    it('does not start a second run while one is running', async () => {
      await create();
      await type('a = 1');
      await key('Enter');
      await type('b = 2');
      await key('Enter', { ctrlKey: true });
      expect(evals()).toHaveLength(1);
      expect(q('shell-run-btn')).toBeNull();
      expect(input().value).toBe('b = 2');
    });

    it('Clear empties the transcript but keeps the session and a running input', async () => {
      await create();
      await type('a = 1');
      await key('Enter');
      fake.end('st1');
      await settle();
      await type('b = 2');
      await key('Enter');
      expect(all('shell-run')).toHaveLength(2);
      get('shell-clear').click();
      await settle();
      expect(all('shell-run')).toHaveLength(1);
      expect(all('shell-run')[0]?.textContent).toContain('b = 2');
      fake.end('st2');
      await settle();
      get('shell-clear').click();
      await settle();
      expect(all('shell-run')).toHaveLength(0);
      expect(fake.requestsFor('shell.close')).toHaveLength(0);
      expect(fake.requestsFor('shell.open')).toHaveLength(1);
      expect(get('shell-prompt').textContent?.trim()).toBe('shop>');
    });

    it('keeps only the newest TRANSCRIPT_LIMIT runs', async () => {
      await create();
      const total = TRANSCRIPT_LIMIT + 2;
      for (let i = 1; i <= total; i++) {
        view.code.set(`x = ${i}`);
        view.run();
        // Let the stream request reach the fake, then end it.
        for (let j = 0; j < 3; j++) await new Promise((resolve) => setTimeout(resolve, 0));
        fake.end(`st${streamNo}`);
      }
      await settle();
      expect(streamNo).toBe(total);
      expect(view.runs()).toHaveLength(TRANSCRIPT_LIMIT);
      expect(view.runs()[0]?.code).toBe('x = 3');
      expect(view.runs().at(-1)?.code).toBe(`x = ${total}`);
      expect(all('shell-run')).toHaveLength(TRANSCRIPT_LIMIT);
    });

    it('runs from the Run button, which is disabled for a blank input', async () => {
      await create();
      expect(get<HTMLButtonElement>('shell-run-btn').disabled).toBe(true);
      await type('   ');
      expect(get<HTMLButtonElement>('shell-run-btn').disabled).toBe(true);
      await type('db.orders.countDocuments()');
      get<HTMLButtonElement>('shell-run-btn').click();
      await settle();
      expect(evals()).toEqual([{ sessionId: 's1', code: 'db.orders.countDocuments()' }]);
    });

    it('shows a stream error in the run and keeps the session for other errors', async () => {
      await create();
      await type('db.orders.drop()');
      await key('Enter');
      fake.failStream('st1', { code: 'SERVER_ERROR', message: 'not authorized on shop' });
      await settle();
      expect(get('shell-error').textContent).toContain('not authorized on shop');
      expect(q('shell-reopen')).toBeNull();
      expect(input().disabled).toBe(false);
    });

    it('notes "Type it for more" under a cursor batch in the viewer', async () => {
      await create();
      await type('db.orders.find()');
      await key('Enter');
      fake.data('shell.eval', 'st1', {
        kind: 'result',
        type: 'Cursor',
        value: '[{"_id":{"$numberInt":"1"}}]',
        text: '[ { _id: 1 } ]\nType "it" for more',
      });
      fake.end('st1');
      await settle();
      expect(get('shell-result-viewer').textContent).toContain('for more');
    });
  });

  describe('completion races and keys', () => {
    function deferredComplete(): (completions: string[]) => void {
      let release!: (completions: string[]) => void;
      fake.handle(
        'shell.complete',
        () =>
          new Promise((resolve) => {
            release = (completions) => resolve({ completions });
          }),
      );
      return (completions) => release(completions);
    }

    it('drops a completion answer that arrives after the input changed', async () => {
      const release = deferredComplete();
      await create();
      await type('db.ord');
      await key('Tab');
      await type('db.orders.find()');
      release(['db.orders', 'db.ordersArchive']);
      await settle();
      expect(q('shell-completions')).toBeNull();
      expect(input().value).toBe('db.orders.find()');
    });

    it('drops a single completion that arrives after the input ran', async () => {
      const release = deferredComplete();
      await create();
      await type('db.ord');
      await key('Tab');
      await key('Enter', { ctrlKey: true });
      release(['db.orders']);
      await settle();
      expect(input().value).toBe('');
      expect(evals()).toHaveLength(1);
    });

    it('shows why completion failed', async () => {
      fake.fail('shell.complete', { code: 'INTERNAL', message: 'completer crashed' });
      await create();
      await type('db.');
      await key('Tab');
      expect(get('shell-completion-note').textContent).toContain('completer crashed');
    });

    it('Ctrl+Space asks for completions too; ArrowUp wraps and Tab applies', async () => {
      fake.respond('shell.complete', {
        completions: ['db.orders', 'db.ordersArchive', 'db.other'],
      });
      await create();
      await type('db.o');
      const space = await key(' ', { ctrlKey: true });
      expect(space.defaultPrevented).toBe(true);
      expect(fake.requestsFor('shell.complete')).toHaveLength(1);
      await key('ArrowUp');
      expect(all('shell-completion')[2]?.getAttribute('aria-selected')).toBe('true');
      expect(input().getAttribute('aria-activedescendant')).toMatch(/-completion-2$/);
      await key('Tab');
      expect(input().value).toBe('db.other');
      expect(q('shell-completions')).toBeNull();
    });

    it('a second Tab replaces the pending request; the cancelled one shows no error', async () => {
      const releases: ((completions: string[]) => void)[] = [];
      fake.handle(
        'shell.complete',
        () =>
          new Promise((resolve) => {
            releases.push((completions) => resolve({ completions }));
          }),
      );
      await create();
      await type('db.ord');
      await key('Tab');
      await key('Tab');
      expect(releases).toHaveLength(2);
      expect(fake.cancels.length).toBeGreaterThan(0);
      releases[1]?.(['db.orders']);
      await settle();
      releases[0]?.(['db.ordersArchive', 'db.ordersOld']);
      await settle();
      expect(input().value).toBe('db.orders');
      expect(q('shell-completions')).toBeNull();
      expect(q('shell-completion-note')).toBeNull();
    });

    it('other keys pass through to the input while the popup is open', async () => {
      fake.respond('shell.complete', { completions: ['db.orders', 'db.ordersArchive'] });
      await create();
      await type('db.ord');
      await key('Tab');
      const other = await key('e');
      expect(other.defaultPrevented).toBe(false);
      expect(q('shell-completions')).not.toBeNull();
    });

    it('closes the popup when the caret moves, and never applies at a moved caret', async () => {
      fake.respond('shell.complete', { completions: ['db.orders', 'db.orgs'] });
      await create();
      await type('db.or');
      await key('Tab');
      expect(q('shell-completions')).not.toBeNull();
      expect(input().getAttribute('aria-controls')).toMatch(/-completions$/);
      // ArrowLeft: the caret moves, keyup closes the list.
      input().setSelectionRange(4, 4);
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
      await settle();
      expect(q('shell-completions')).toBeNull();
      expect(input().getAttribute('aria-controls')).toBeNull();
      const enter = await key('Enter');
      expect(enter.defaultPrevented).toBe(true); // complete input: it runs, nothing is completed
      expect(evals().map((e) => e.code)).toEqual(['db.or']);
      expect(input().value).toBe('');

      // A click moving the caret closes it too.
      await type('db.or');
      await key('Tab');
      input().setSelectionRange(2, 2);
      input().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
      expect(q('shell-completions')).toBeNull();
    });

    it('applies at the caret the completions were asked for even if no caret event came', async () => {
      fake.respond('shell.complete', { completions: ['db.orders', 'db.orgs'] });
      await create();
      await type('db.or');
      await key('Tab');
      input().setSelectionRange(4, 4); // moved without keyup/click/select
      await key('Enter');
      expect(input().value).toBe('db.orders');
      expect(evals()).toEqual([]);
    });

    it('keyup that leaves the caret in place keeps the popup open', async () => {
      fake.respond('shell.complete', { completions: ['db.orders', 'db.orgs'] });
      await create();
      await type('db.or');
      await key('Tab');
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
      await key('ArrowDown');
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
      await settle();
      expect(q('shell-completions')).not.toBeNull();
      await key('Enter');
      expect(input().value).toBe('db.orgs');
    });

    it('closes the popup when the input loses focus', async () => {
      fake.respond('shell.complete', { completions: ['db.orders', 'db.ordersArchive'] });
      await create();
      await type('db.ord');
      await key('Tab');
      expect(q('shell-completions')).not.toBeNull();
      input().dispatchEvent(new FocusEvent('blur'));
      await settle();
      expect(q('shell-completions')).toBeNull();
    });
  });

  describe('session lifecycle', () => {
    it('closes a session whose open answer arrives after the tab went away', async () => {
      let release!: () => void;
      fake.handle(
        'shell.open',
        () =>
          new Promise((resolve) => {
            release = () => resolve({ sessionId: 'late', db: 'shop' });
          }),
      );
      await create();
      fixture.destroy();
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fake.requestsFor('shell.close').map((r) => r.params)).toEqual([{ sessionId: 'late' }]);
      expect(view.session().state).not.toBe('open');
    });

    it('closes the older session when a newer open overtakes it', async () => {
      const releases: (() => void)[] = [];
      let n = 0;
      fake.handle('shell.open', () => {
        const id = `s${++n}`;
        return new Promise((resolve) => {
          releases.push(() => resolve({ sessionId: id, db: id === 's1' ? 'old' : 'new' }));
        });
      });
      await create();
      void view.open();
      await settle();
      expect(releases).toHaveLength(2);
      releases[1]?.();
      await settle();
      releases[0]?.();
      await settle();
      expect(view.session()).toEqual({ state: 'open', sessionId: 's2' });
      expect(get('shell-prompt').textContent?.trim()).toBe('new>');
      expect(fake.requestsFor('shell.close').map((r) => r.params)).toEqual([{ sessionId: 's1' }]);
    });

    it('ignores the failure of an older open once a newer one succeeded', async () => {
      let n = 0;
      let failFirst!: () => void;
      fake.handle('shell.open', () => {
        if (++n === 1) {
          return new Promise((_resolve, reject) => {
            failFirst = () => reject(new Error('connection reset'));
          });
        }
        return { sessionId: 's2', db: 'shop' };
      });
      await create();
      await view.open();
      await settle();
      failFirst();
      await settle();
      expect(view.session()).toEqual({ state: 'open', sessionId: 's2' });
      expect(q('shell-failed')).toBeNull();
    });

    it('reopening closes the current session first', async () => {
      await create();
      fake.respond('shell.open', { sessionId: 's2', db: 'shop' });
      await view.open();
      await settle();
      expect(fake.requestsFor('shell.close').map((r) => r.params)).toEqual([{ sessionId: 's1' }]);
      expect(view.session()).toEqual({ state: 'open', sessionId: 's2' });
    });

    it('cancels a running input and closes the session when the tab goes away', async () => {
      await create();
      await type('sleep(100000)');
      await key('Enter');
      fixture.destroy();
      await settle();
      expect(fake.cancels).toContain('st1');
      expect(fake.requestsFor('shell.close')[0]?.params).toEqual({ sessionId: 's1' });
    });

    it('does not open a session after the tab went away', async () => {
      await create();
      fixture.destroy();
      await view.open();
      expect(fake.requestsFor('shell.open')).toHaveLength(1);
    });

    it('opens without a database when the tab names none', async () => {
      await create({ ...TAB, data: { profileId: 'p1' } });
      expect(fake.requestsFor('shell.open')[0]?.params).toEqual({ profileId: 'p1' });
    });

    it('takes the production accent from the tab as well', async () => {
      await create({ ...TAB, production: true });
      expect(el().classList.contains('production')).toBe(true);
      expect(q('shell-production')).not.toBeNull();
    });
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
