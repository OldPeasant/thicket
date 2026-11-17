import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { type Diagnostic, setDiagnostics } from '@codemirror/lint';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { BsonDocument } from '@thicket/core/bson';

import { DocumentEdits, documentKey, idOf } from '../document/edit-session';
import {
  describeRawError,
  parseRaw,
  printRaw,
  type RawError,
  type RawFormat,
  unplacedError,
} from './raw-text';

/** Marks text the component put into the editor itself (not typed by the user). */
const External = Annotation.define<boolean>();

let nextId = 0;

/**
 * Text editor for one whole document (SPEC.md M1 "Raw editor"): CodeMirror 6 with the document in
 * mongosh shell syntax or canonical EJSON v2. The text is read by core's parsers, never evaluated.
 * Switching the format converts the text as it is (unapplied changes included); text that can't
 * be read stays as it is and its error is marked. **Apply** records the text as an edit of the
 * document in the collection tab's `DocumentEdits` (undo, change count and Save work as for edits
 * in the explorer). While the text has no unapplied changes it follows the document's edits.
 */
@Component({
  selector: 'app-raw-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="raw-editor" [class.invalid]="error() !== null">
      <div class="toolbar">
        <span class="group" role="group" aria-label="Raw format">
          <button
            type="button"
            class="btn quiet"
            data-testid="raw-format-shell"
            [attr.aria-pressed]="format() === 'shell'"
            (click)="setFormat('shell')"
          >
            Shell syntax
          </button>
          <button
            type="button"
            class="btn quiet"
            data-testid="raw-format-ejson"
            [attr.aria-pressed]="format() === 'ejson'"
            (click)="setFormat('ejson')"
          >
            Canonical EJSON
          </button>
        </span>
        <span class="group end">
          @if (dirty()) {
            <span class="modified" data-testid="raw-dirty">Not applied</span>
          }
          <button
            type="button"
            class="btn"
            data-testid="raw-reset"
            title="Discard the text's changes that were not applied"
            [disabled]="!dirty()"
            (click)="reset()"
          >
            Reset
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="raw-apply"
            title="Apply the text to the document (Ctrl+Enter)"
            [disabled]="readOnly() || !dirty() || noId()"
            (click)="apply()"
          >
            Apply
          </button>
        </span>
      </div>
      <div #host class="host" data-testid="raw-editor-text"></div>
      @if (error(); as error) {
        <p class="message error" role="alert" [id]="errorId" data-testid="raw-error">
          {{ describe(error) }}
        </p>
      } @else if (noId()) {
        <p class="message" data-testid="raw-no-id">
          This document has no _id: its text can't be applied.
        </p>
      }
    </div>
  `,
  styleUrls: ['../document/document-controls.css', './raw-editor.css'],
})
export class RawEditor {
  /** The document as it was loaded (the edit session's key and baseline). */
  readonly doc = input.required<BsonDocument>();
  /** The document was loaded with a projection (see `DocumentEdits.edit`). */
  readonly partial = input(false);
  /** That projection may hide parts of fields (see `DocumentEdits.edit`). */
  readonly hidesSubFields = input(false);
  /** The text can be read and converted, but not changed or applied. */
  readonly readOnly = input(false);
  /** The text was applied as this document. */
  readonly applied = output<BsonDocument>();

  private readonly edits = inject(DocumentEdits);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly errorId = `raw-editor-error-${nextId++}`;
  readonly format = signal<RawFormat>('shell');
  readonly error = signal<RawError | null>(null);
  /** The document as shown: with its unsaved edits. */
  private readonly shown = computed(() => this.edits.current(this.doc()));
  /** The shown document printed in the current format: the text without unapplied changes. */
  private readonly baseline = signal('');
  private readonly text = signal('');
  /** The text has changes that were not applied. */
  readonly dirty = computed(() => this.text() !== this.baseline());
  protected readonly noId = computed(() => documentKey(this.doc()) === null);

  private readonly language = new Compartment();
  private readonly editable = new Compartment();
  private readonly attributes = new Compartment();
  private readonly view: EditorView;

  constructor() {
    this.view = new EditorView({
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(highlightStyle),
          EditorState.tabSize.of(2),
          keymap.of([
            { key: 'Mod-Enter', run: () => (this.apply(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          this.language.of(languageOf('shell')),
          this.editable.of(editableExtensions(false)),
          this.attributes.of(contentAttributes(null, this.errorId)),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.text.set(update.state.doc.toString());
            const typed = update.transactions.some((tr) => !tr.annotation(External));
            if (typed) this.showError(null);
          }),
        ],
      }),
    });

    afterNextRender(() => this.host().nativeElement.appendChild(this.view.dom));
    inject(DestroyRef).onDestroy(() => this.view.destroy());

    // Follow the document's edits (undo, an edit in the explorer, a save) while the text has no
    // unapplied changes; with unapplied changes the text stays and shows as not applied. When the
    // input becomes another document (a reused instance, e.g. in a list after paging), the text,
    // its unapplied changes and its error belong to the old one: show the new document instead.
    let owner: unknown;
    effect(() => {
      const shown = this.shown();
      const doc = this.doc();
      untracked(() => {
        const identity = documentKey(doc) ?? doc;
        const otherDocument = owner !== undefined && identity !== owner;
        owner = identity;
        const next = printRaw(shown, this.format());
        if (otherDocument) {
          this.baseline.set(next);
          this.setText(next);
          this.showError(null);
          return;
        }
        if (next === this.baseline()) return;
        const wasDirty = this.dirty();
        this.baseline.set(next);
        if (!wasDirty) {
          this.setText(next);
          this.showError(null);
        }
      });
    });
    effect(() => {
      const readOnly = this.readOnly();
      this.view.dispatch({ effects: this.editable.reconfigure(editableExtensions(readOnly)) });
    });
  }

  /** The editor's current text. */
  get value(): string {
    return this.view.state.doc.toString();
  }

  /** The CodeMirror view (for tests and keyboard focus). */
  get editorView(): EditorView {
    return this.view;
  }

  /**
   * Shows the text in `format`. Text that can be read is converted, unapplied changes included;
   * text that can't be read stays in its format and its error is marked. Returns whether the
   * format is `format` now.
   */
  setFormat(format: RawFormat): boolean {
    const from = this.format();
    if (format === from) return true;
    const wasDirty = this.dirty();
    let converted: string;
    if (wasDirty) {
      const parsed = parseRaw(this.value, from);
      if (!parsed.ok) {
        this.showError(parsed.error);
        return false;
      }
      converted = printRaw(parsed.doc, format);
    } else {
      converted = printRaw(this.shown(), format);
    }
    this.format.set(format);
    this.baseline.set(printRaw(this.shown(), format));
    this.view.dispatch({ effects: this.language.reconfigure(languageOf(format)) });
    this.setText(converted);
    this.showError(null);
    return true;
  }

  /**
   * Applies the text: records it as an edit of the document in the edit session. Text that
   * can't be read, or that changes or drops the `_id`, is refused with its error shown.
   * Returns whether the text was applied.
   */
  apply(): boolean {
    if (this.readOnly()) return false;
    const original = this.doc();
    const key = documentKey(original);
    if (key === null) return false;
    const parsed = parseRaw(this.value, this.format());
    if (!parsed.ok) {
      this.showError(parsed.error);
      return false;
    }
    const doc = parsed.doc;
    if (documentKey(doc) !== key) {
      this.showError(
        unplacedError(
          idOf(doc) === null
            ? 'The document needs its _id'
            : 'The _id of a document cannot be changed',
        ),
      );
      return false;
    }
    this.edits.edit(original, doc, this.partial(), this.hidesSubFields());
    const next = printRaw(this.shown(), this.format());
    this.baseline.set(next);
    this.setText(next);
    this.showError(null);
    this.applied.emit(doc);
    return true;
  }

  /** Discards the text's unapplied changes. */
  reset(): void {
    this.setText(this.baseline());
    this.showError(null);
  }

  protected describe(error: RawError): string {
    return describeRawError(error);
  }

  private setText(text: string): void {
    const current = this.view.state.doc;
    if (current.toString() === text) {
      this.text.set(text);
      return;
    }
    this.view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      annotations: External.of(true),
    });
  }

  /** Shows `error` under the editor and marks its place in the text; `null` clears both. */
  private showError(error: RawError | null): void {
    if (error === null && this.error() === null) return;
    this.error.set(error);
    const length = this.view.state.doc.length;
    const diagnostics: Diagnostic[] = [];
    if (error?.offset != null) {
      // Mark the character at the error; at the end of the text, the last one.
      const from = Math.max(0, Math.min(error.offset, length - 1));
      const to = Math.min(from + 1, length);
      diagnostics.push({ from, to, severity: 'error', message: error.reason });
    }
    this.view.dispatch(
      setDiagnostics(this.view.state, diagnostics),
      { effects: this.attributes.reconfigure(contentAttributes(error, this.errorId)) },
      ...(diagnostics[0]
        ? [{ selection: { anchor: diagnostics[0].from }, scrollIntoView: true }]
        : []),
    );
  }
}

function languageOf(format: RawFormat): Extension {
  return format === 'shell' ? javascript() : json();
}

function editableExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

function contentAttributes(error: RawError | null, errorId: string): Extension {
  return EditorView.contentAttributes.of({
    'aria-label': 'Document text',
    ...(error === null ? {} : { 'aria-invalid': 'true', 'aria-describedby': errorId }),
  });
}

// Colors from the theme tokens (tokens.css), so the editor follows the theme switcher.
const highlightStyle = HighlightStyle.define([
  { tag: tags.string, color: 'var(--val-str)' },
  { tag: tags.number, color: 'var(--val-num)' },
  { tag: [tags.bool, tags.null], color: 'var(--val-bool)' },
  { tag: tags.regexp, color: 'var(--bson-regex)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--text)' },
  { tag: [tags.variableName, tags.className, tags.keyword], color: 'var(--accent)' },
  { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: 'var(--text-muted)' },
]);

const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--bg-input)',
    fontSize: '0.9em',
  },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '1px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--accent-bg)',
  },
  '.cm-gutters': {
    color: 'var(--text-faint)',
    backgroundColor: 'var(--bg-panel)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-matchingBracket': { outline: '1px solid var(--accent)', backgroundColor: 'transparent' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    backgroundColor: 'var(--danger-bg)',
  },
});
