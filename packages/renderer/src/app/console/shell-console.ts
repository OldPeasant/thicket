import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ShellOutput } from '@thicket/contract';
import { parseEJson } from '@thicket/core/bson';
import type { Subscription } from 'rxjs';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { toExplorerValue } from '../explorer/bson-value.util';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import {
  applyCompletion,
  completionLabel,
  ConsoleHistory,
  isInputComplete,
  onFirstLine,
  onLastLine,
} from './console-input';
import { readScriptFile, SCRIPT_ACCEPT } from './scripts/script-file';
import { ShellResult } from './shell-result';

/** `data` of a shell tab. */
export interface ShellTabData {
  profileId: string;
  /** Database the session starts in (default: the connection's). */
  db?: string;
}

/** Stable id of a connection's shell tab (one console per connection). */
export function shellTabId(profileId: string): string {
  return `shell:${profileId}`;
}

/** Runs kept in the transcript; older ones are dropped. */
export const TRANSCRIPT_LIMIT = 200;

/** One output item as the transcript shows it. */
export interface ShownOutput {
  readonly kind: 'print' | 'result' | 'error';
  readonly text: string;
  /** mongosh result type (`Cursor`, `Document`, ...). */
  readonly type?: string;
  /** Explorer tree of a result that is a document or an array (shown in the viewer). */
  readonly tree?: unknown;
}

/** One run: the input, the prompt it ran at, and what came out. */
export interface Run {
  readonly id: number;
  readonly prompt: string;
  readonly code: string;
  readonly outputs: readonly ShownOutput[];
  readonly state: 'running' | 'done' | 'stopped';
  /**
   * Set when the run is a script file: its name and length. `code` is then empty: the script's
   * text is sent to the session but not kept in the transcript.
   */
  readonly script?: { readonly name: string; readonly lines: number };
}

type Session =
  | { readonly state: 'opening' }
  | { readonly state: 'open'; readonly sessionId: string }
  | { readonly state: 'failed'; readonly message: string };

/** What the transcript shows for one output item of `shell.eval` (`db` changes show nothing). */
export function showOutput(output: ShellOutput): ShownOutput | null {
  if (output.kind === 'db') return null;
  if (output.kind !== 'result') return { kind: output.kind, text: output.text };
  let tree: unknown;
  if (output.value !== undefined) {
    try {
      const value = parseEJson(output.value);
      if (value.type === 'object' || value.type === 'array') tree = toExplorerValue(value);
    } catch {
      tree = undefined; // not readable as BSON: the text stays
    }
  }
  return {
    kind: 'result',
    text: output.text,
    ...(output.type !== undefined ? { type: output.type } : {}),
    ...(tree !== undefined ? { tree } : {}),
  };
}

/** Longest error text the live region reads out. */
const ANNOUNCE_LIMIT = 200;

/**
 * What the live region says when a run ends: a short summary instead of the whole output (results
 * can be large document grids), plus the first error, which a user must not miss.
 */
export function announce(run: Run): string {
  if (run.state === 'stopped')
    return run.script ? `Script ${run.script.name} stopped` : 'Run stopped';
  const error = run.outputs.find((o) => o.kind === 'error');
  if (error) {
    const text =
      error.text.length > ANNOUNCE_LIMIT ? `${error.text.slice(0, ANNOUNCE_LIMIT)}…` : error.text;
    return `Run failed: ${text}`;
  }
  const result = run.outputs.find((o) => o.kind === 'result');
  if (run.script) return `Script ${run.script.name} finished`;
  return result?.type ? `Run finished: ${result.type}` : 'Run finished';
}

let nextUid = 0;

/**
 * The mongosh console of a connection (SPEC M4). The session runs in the backend (`shell.*`);
 * this view is the transcript and the input. Enter runs a finished input and continues an
 * unfinished one on a new line (Shift+Enter always adds a line, Ctrl/Cmd+Enter always runs);
 * ArrowUp/ArrowDown on the first/last line step through the history; Tab (or Ctrl+Space) asks
 * for completions. Results that are documents show in the Thicket viewer, or as mongosh's text
 * with the plain-text toggle. Read-only profiles show a warning: the shell runs whatever is typed,
 * only the server's permissions guard it. Production profiles get the red accent.
 */
@Component({
  selector: 'app-shell-console',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ShellResult],
  templateUrl: './shell-console.html',
  styleUrl: './shell-console.css',
  host: { '[class.production]': 'production()' },
})
export class ShellConsole {
  readonly tab = input.required<WorkspaceTab>();

  private readonly api = inject(ApiService);
  private readonly safety = inject(ProfileSafetyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private readonly transcriptEl = viewChild<ElementRef<HTMLElement>>('transcript');
  private readonly scriptInputEl = viewChild<ElementRef<HTMLInputElement>>('scriptInput');

  protected readonly scriptAccept = SCRIPT_ACCEPT;
  /** Why the last chosen script file was not run (cleared by the next choice or run). */
  readonly scriptProblem = signal('');

  protected readonly uid = `shell-console-${++nextUid}`;

  protected readonly target = computed(
    () => {
      const data = this.tab().data as Partial<ShellTabData> | undefined;
      return { profileId: data?.profileId ?? '', db: data?.db };
    },
    { equal: (a, b) => a.profileId === b.profileId && a.db === b.db },
  );
  protected readonly readOnly = computed(() => this.safety.readOnly(this.target().profileId)());
  protected readonly production = computed(
    () => this.tab().production === true || this.safety.production(this.target().profileId)(),
  );

  readonly session = signal<Session>({ state: 'opening' });
  /** The session's current database (the prompt). */
  readonly db = signal('');
  readonly runs = signal<readonly Run[]>([]);
  readonly code = signal('');
  /** Results as mongosh's text instead of the viewer. */
  readonly plain = signal(false);
  readonly completions = signal<readonly string[]>([]);
  readonly selected = signal(0);
  protected readonly completionNote = signal('');
  /** Short screen-reader summary of the newest run (the transcript itself is not live). */
  protected readonly announcement = signal('');

  protected readonly failure = computed(() => {
    const session = this.session();
    return session.state === 'failed' ? session.message : null;
  });
  readonly running = computed(() => this.runs().some((r) => r.state === 'running'));
  protected readonly prompt = computed(() => `${this.db() || '…'}>`);
  protected readonly canRun = computed(
    () => this.session().state === 'open' && !this.running() && this.code().trim() !== '',
  );
  protected readonly canRunScript = computed(
    () => this.session().state === 'open' && !this.running(),
  );

  readonly history = new ConsoleHistory();
  private nextRunId = 1;
  private evalSub: Subscription | undefined;
  private completeAbort: AbortController | undefined;
  /** Input and caret the open completion list was requested for (mongosh completes up to it). */
  private completionAt: { code: string; cursor: number } | undefined;
  /** Bumped per open: an answer of an older open is closed instead of used. */
  private openSeq = 0;
  private closed = false;

  constructor() {
    // Open once the tab is known; the profile of a tab never changes.
    queueMicrotask(() => void this.open());
    this.destroyRef.onDestroy(() => {
      this.closed = true;
      this.evalSub?.unsubscribe();
      this.completeAbort?.abort();
      this.closeSession();
    });
    // Keep the newest output in view.
    afterRenderEffect(() => {
      this.runs();
      const el = this.transcriptEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** Opens (or reopens) the session. */
  async open(): Promise<void> {
    if (this.closed) return;
    this.closeSession();
    const seq = ++this.openSeq;
    this.session.set({ state: 'opening' });
    const { profileId, db } = untracked(() => this.target());
    try {
      const result = await this.api.request('shell.open', {
        profileId,
        ...(db ? { db } : {}),
      });
      if (this.closed || seq !== this.openSeq) {
        void this.api
          .request('shell.close', { sessionId: result.sessionId })
          .catch(() => undefined);
        return;
      }
      this.session.set({ state: 'open', sessionId: result.sessionId });
      this.db.set(result.db);
      this.focusInput();
    } catch (error) {
      if (seq !== this.openSeq) return;
      this.session.set({ state: 'failed', message: describeError(error) });
    }
  }

  private closeSession(): void {
    const session = this.session();
    if (session.state !== 'open') return;
    this.session.set({ state: 'opening' });
    void this.api.request('shell.close', { sessionId: session.sessionId }).catch(() => undefined);
  }

  /** Runs the input. */
  run(): void {
    const session = this.session();
    const code = this.code();
    if (session.state !== 'open' || this.running() || code.trim() === '') return;
    this.closeCompletions();
    this.history.add(code);
    this.code.set('');
    this.scriptProblem.set('');
    this.evaluate(session.sessionId, code);
  }

  /** Opens the file chooser for a script file. */
  chooseScript(): void {
    if (!this.canRunScript()) return;
    this.scriptInputEl()?.nativeElement.click();
  }

  protected onScriptChosen(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    // The same file can be chosen again (and run again) next time.
    el.value = '';
    if (file) void this.runScript(file);
  }

  /**
   * Runs a script file in the session, like typed input: in the current database, with the
   * session's variables. The transcript shows the file's name and length instead of its text;
   * its output streams in as it runs. Not added to the input history.
   */
  async runScript(file: { name: string; size: number; text(): Promise<string> }): Promise<void> {
    this.scriptProblem.set('');
    let script;
    try {
      script = await readScriptFile(file);
    } catch (error) {
      this.scriptProblem.set(error instanceof Error ? error.message : String(error));
      return;
    }
    // The session or the running input may have changed while the file was read.
    if (this.closed) return;
    const session = this.session();
    if (session.state !== 'open') {
      this.scriptProblem.set(`${script.name} was not run: the session is not open`);
      return;
    }
    if (this.running()) {
      this.scriptProblem.set(`${script.name} was not run: the shell is busy`);
      return;
    }
    this.closeCompletions();
    this.evaluate(session.sessionId, script.code, { name: script.name, lines: script.lines });
    this.focusInput();
  }

  private evaluate(sessionId: string, code: string, script?: Run['script']): void {
    const id = this.nextRunId++;
    const run: Run = {
      id,
      prompt: this.prompt(),
      // A script's text is sent but not kept: the transcript shows only its name and lines.
      code: script ? '' : code,
      outputs: [],
      state: 'running',
      ...(script ? { script } : {}),
    };
    this.runs.update((runs) => [...runs, run].slice(-TRANSCRIPT_LIMIT));
    this.evalSub = this.api.stream('shell.eval', { sessionId, code }).subscribe({
      next: (output) => {
        if (output.kind === 'db') this.db.set(output.db);
        const shown = showOutput(output);
        if (shown) this.patchRun(id, (run) => ({ ...run, outputs: [...run.outputs, shown] }));
      },
      error: (error: unknown) => {
        const apiError = ApiError.from(error);
        if (apiError.code === 'NOT_FOUND') {
          // The backend lost the session (e.g. it restarted): offer to open a new one.
          this.session.set({
            state: 'failed',
            message: 'The shell session ended. Open a new session to go on.',
          });
        }
        this.finishRun(id, 'done', { kind: 'error', text: describeError(error) });
      },
      complete: () => this.finishRun(id, 'done'),
    });
  }

  /** Stops the running input (the backend interrupts it). */
  stop(): void {
    const running = this.runs().find((r) => r.state === 'running');
    this.evalSub?.unsubscribe();
    this.evalSub = undefined;
    if (running) this.finishRun(running.id, 'stopped');
    this.focusInput();
  }

  /** Empties the transcript (the session and its variables stay). */
  clear(): void {
    this.runs.update((runs) => runs.filter((r) => r.state === 'running'));
    this.focusInput();
  }

  private finishRun(id: number, state: 'done' | 'stopped', extra?: ShownOutput): void {
    let finished: Run | undefined;
    this.patchRun(id, (run) => {
      if (run.state !== 'running') return run;
      finished = { ...run, state, outputs: extra ? [...run.outputs, extra] : run.outputs };
      return finished;
    });
    if (state === 'done') this.evalSub = undefined;
    if (finished) this.announcement.set(announce(finished));
  }

  private patchRun(id: number, fn: (run: Run) => Run): void {
    this.runs.update((runs) => runs.map((r) => (r.id === id ? fn(r) : r)));
  }

  // ---- input ---------------------------------------------------------------------------

  protected onInput(event: Event): void {
    this.code.set((event.target as HTMLTextAreaElement).value);
    this.closeCompletions();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const el = event.target as HTMLTextAreaElement;
    if (this.completions().length > 0 && this.completionKey(event)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      if (mod || isInputComplete(el.value)) {
        event.preventDefault();
        this.run();
      }
      return;
    }
    if ((event.key === 'Tab' && !event.shiftKey && !mod) || (event.key === ' ' && event.ctrlKey)) {
      // Tab completes; in a blank line or after spaces it indents.
      const before = el.value.slice(0, el.selectionStart);
      if (event.key === 'Tab' && /(^|\s)$/.test(before)) {
        event.preventDefault();
        this.insert(el, '  ');
        return;
      }
      event.preventDefault();
      void this.complete();
      return;
    }
    if (event.key === 'ArrowUp' && !mod && !event.shiftKey && !event.altKey) {
      if (el.selectionStart === el.selectionEnd && onFirstLine(el.value, el.selectionStart)) {
        const previous = this.history.previous(el.value);
        if (previous !== null) {
          event.preventDefault();
          this.setInput(previous, 'end');
        }
      }
      return;
    }
    if (event.key === 'ArrowDown' && !mod && !event.shiftKey && !event.altKey) {
      if (el.selectionStart === el.selectionEnd && onLastLine(el.value, el.selectionEnd)) {
        const next = this.history.next();
        if (next !== null) {
          event.preventDefault();
          this.setInput(next, 'end');
        }
      }
      return;
    }
    if (
      event.key === 'c' &&
      event.ctrlKey &&
      this.running() &&
      el.selectionStart === el.selectionEnd
    ) {
      event.preventDefault();
      this.stop();
    }
  }

  /** Keys of the open completion list; returns whether the key was used. */
  private completionKey(event: KeyboardEvent): boolean {
    const count = this.completions().length;
    switch (event.key) {
      case 'ArrowDown':
        this.selected.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        this.selected.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter':
      case 'Tab':
        this.choose(this.selected());
        break;
      case 'Escape':
        this.closeCompletions();
        break;
      default:
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  /** Asks the session for completions at the caret. */
  async complete(): Promise<void> {
    const session = this.session();
    const el = this.inputEl()?.nativeElement;
    if (session.state !== 'open' || !el) return;
    this.completeAbort?.abort();
    const abort = new AbortController();
    this.completeAbort = abort;
    const code = el.value;
    const cursor = el.selectionStart;
    this.completionNote.set('');
    try {
      const { completions } = await this.api.request(
        'shell.complete',
        { sessionId: session.sessionId, code, cursor },
        { signal: abort.signal },
      );
      // The input changed while the answer was on its way: it no longer applies.
      if (abort.signal.aborted || this.code() !== code) return;
      if (completions.length === 1) {
        this.applyAt(code, cursor, completions[0] as string);
      } else if (completions.length === 0) {
        this.completionNote.set('No completions');
      } else {
        this.completionAt = { code, cursor };
        this.completions.set(completions);
        this.selected.set(0);
      }
    } catch (error) {
      if (ApiError.from(error).code !== 'CANCELLED') {
        this.completionNote.set(describeError(error));
      }
    } finally {
      if (this.completeAbort === abort) this.completeAbort = undefined;
    }
  }

  /**
   * Takes completion `index` of the open list, at the input and caret it was requested for. If the
   * input changed since, the list no longer applies and just closes.
   */
  choose(index: number): void {
    const completion = this.completions()[index];
    const at = this.completionAt;
    const el = this.inputEl()?.nativeElement;
    if (completion === undefined || !at || !el) return;
    if (el.value !== at.code) {
      this.closeCompletions();
      return;
    }
    this.applyAt(at.code, at.cursor, completion);
  }

  /**
   * The caret may have moved (keyup, click, select): an open list belongs to the caret it was
   * requested for, so it closes once the caret or the input differs.
   */
  protected onCaret(event: Event): void {
    const at = this.completionAt;
    if (!at || this.completions().length === 0) return;
    const el = event.target as HTMLTextAreaElement;
    if (el.value !== at.code || el.selectionStart !== at.cursor || el.selectionEnd !== at.cursor) {
      this.closeCompletions();
    }
  }

  private applyAt(code: string, cursor: number, completion: string): void {
    const next = applyCompletion(code, cursor, completion);
    this.closeCompletions();
    this.setInput(next.code, next.cursor);
  }

  protected closeCompletions(): void {
    this.completionAt = undefined;
    if (this.completions().length > 0) this.completions.set([]);
    this.completionNote.set('');
  }

  protected label(completion: string): string {
    return completionLabel(completion);
  }

  private insert(el: HTMLTextAreaElement, text: string): void {
    const start = el.selectionStart;
    this.setInput(
      el.value.slice(0, start) + text + el.value.slice(el.selectionEnd),
      start + text.length,
    );
  }

  private setInput(code: string, cursor: number | 'end'): void {
    this.code.set(code);
    const el = this.inputEl()?.nativeElement;
    if (!el) return;
    el.value = code;
    const at = cursor === 'end' ? code.length : cursor;
    el.setSelectionRange(at, at);
    el.focus();
  }

  private focusInput(): void {
    queueMicrotask(() => this.inputEl()?.nativeElement.focus({ preventScroll: true }));
  }

  /** Lines of the input (rows of the textarea, 1…12). */
  protected readonly rows = computed(() => Math.min(12, this.code().split('\n').length));
}
