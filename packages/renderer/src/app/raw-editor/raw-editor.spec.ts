import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { forEachDiagnostic } from '@codemirror/lint';
import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { ALL_TYPES_EJSON } from '@thicket/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DocumentEdits } from '../document/edit-session';
import { RawEditor } from './raw-editor';
import { installJsdomLayoutStubs } from './testing';

installJsdomLayoutStubs();

const ID = '{"$oid":"65a1b2c3d4e5f60718293a4b"}';
const DOC = parseEJsonDocument(
  `{"_id":${ID},"name":"Ada","n":{"$numberLong":"9007199254740993"},` +
    `"at":{"$date":{"$numberLong":"1700000000000"}},"tags":["a","b"]}`,
);

@Component({
  imports: [RawEditor],
  providers: [DocumentEdits],
  template: `<app-raw-editor
    [doc]="doc()"
    [partial]="partial()"
    [readOnly]="readOnly()"
    (applied)="applied.push($event)"
  />`,
})
class Host {
  readonly doc = signal<BsonDocument>(DOC);
  readonly partial = signal(false);
  readonly readOnly = signal(false);
  readonly applied: BsonDocument[] = [];
  readonly editor = viewChild.required(RawEditor);
}

describe('RawEditor', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let edits: DocumentEdits;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const button = (id: string) => {
    const found = q(id);
    if (found === null) throw new Error(`no ${id}`);
    return found as HTMLButtonElement;
  };
  const editor = () => host.editor();
  const view = () => editor().editorView;
  /** Replaces the text as typing would (a user transaction, not one of the component's own). */
  const type = async (text: string) => {
    view().dispatch({
      changes: { from: 0, to: view().state.doc.length, insert: text },
      userEvent: 'input.type',
    });
    await fixture.whenStable();
  };
  const click = async (id: string) => {
    button(id).click();
    await fixture.whenStable();
  };
  const diagnostics = () => {
    const found: { from: number; to: number; message: string }[] = [];
    forEachDiagnostic(view().state, (d, from, to) => found.push({ from, to, message: d.message }));
    return found;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    edits = fixture.debugElement
      .query((node) => node.name === 'app-raw-editor')
      .injector.get(DocumentEdits);
  });

  it('shows the document in shell syntax inside a CodeMirror editor', () => {
    expect(editor().value).toBe(
      [
        '{',
        '  _id: ObjectId("65a1b2c3d4e5f60718293a4b"),',
        '  name: "Ada",',
        '  n: NumberLong("9007199254740993"),',
        '  at: ISODate("2023-11-14T22:13:20.000Z"),',
        '  tags: [',
        '    "a",',
        '    "b"',
        '  ]',
        '}',
      ].join('\n'),
    );
    expect(q('raw-editor-text')?.querySelector('.cm-editor')).not.toBeNull();
    expect(q('raw-editor-text')?.querySelector('.cm-content')?.textContent).toContain(
      'ObjectId("65a1b2c3d4e5f60718293a4b")',
    );
    expect(button('raw-format-shell').getAttribute('aria-pressed')).toBe('true');
    expect(button('raw-apply').disabled).toBe(true);
    expect(q('raw-dirty')).toBeNull();
  });

  describe('format toggle', () => {
    it('switches to canonical EJSON and back without changing the document', async () => {
      const shell = editor().value;
      await click('raw-format-ejson');
      expect(button('raw-format-ejson').getAttribute('aria-pressed')).toBe('true');
      expect(editor().value).toBe(stringifyEJson(DOC, 2));
      expect(parseEJsonDocument(editor().value)).toEqual(DOC);
      await click('raw-format-shell');
      expect(editor().value).toBe(shell);
      expect(q('raw-dirty')).toBeNull();
    });

    it('keeps unapplied changes when switching', async () => {
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), name: "Grace", n: NumberLong(5) }');
      expect(q('raw-dirty')).not.toBeNull();
      await click('raw-format-ejson');
      expect(parseEJsonDocument(editor().value)).toEqual(
        parseEJsonDocument(`{"_id":${ID},"name":"Grace","n":{"$numberLong":"5"}}`),
      );
      expect(q('raw-dirty')).not.toBeNull();
      await click('raw-format-shell');
      expect(editor().value).toContain('name: "Grace"');
      expect(editor().value).toContain('n: NumberLong(5)');
      // Nothing was applied by switching.
      expect(edits.modified()).toBe(false);
    });

    it('round-trips every BSON type through the toggle', async () => {
      const all = parseEJsonDocument(ALL_TYPES_EJSON);
      host.doc.set(all);
      await fixture.whenStable();
      await click('raw-format-ejson');
      expect(editor().value).toBe(stringifyEJson(all, 2));
      await click('raw-format-shell');
      await click('raw-format-ejson');
      expect(parseEJsonDocument(editor().value)).toEqual(all);
    });

    it('does not switch text that cannot be read, and marks the error', async () => {
      await type('{\n  name: "x",\n  n: 1 +\n}');
      await click('raw-format-ejson');
      expect(button('raw-format-shell').getAttribute('aria-pressed')).toBe('true');
      expect(editor().value).toBe('{\n  name: "x",\n  n: 1 +\n}');
      expect(q('raw-error')?.textContent).toMatch(/\(line 3, column 8\)/);
    });

    it('keeps unapplied EJSON changes when switching back to shell syntax', async () => {
      await click('raw-format-ejson');
      await type(`{"_id":${ID},"name":"Grace","n":{"$numberLong":"5"}}`);
      await click('raw-format-shell');
      expect(button('raw-format-shell').getAttribute('aria-pressed')).toBe('true');
      expect(editor().value).toBe(
        '{\n  _id: ObjectId("65a1b2c3d4e5f60718293a4b"),\n  name: "Grace",\n  n: NumberLong(5)\n}',
      );
      expect(q('raw-dirty')).not.toBeNull();
      expect(edits.modified()).toBe(false);
    });

    it('does not switch EJSON text that cannot be read, and marks its place', async () => {
      await click('raw-format-ejson');
      const text = `{\n  "_id": ${ID},\n  "a": 1,,\n}`;
      await type(text);
      await click('raw-format-shell');
      expect(button('raw-format-ejson').getAttribute('aria-pressed')).toBe('true');
      expect(editor().value).toBe(text);
      expect(q('raw-error')?.textContent).toMatch(/\(line 3, column 10\)/);
      expect(diagnostics()[0]).toMatchObject({ from: text.indexOf(',,') + 1 });
    });

    it('clicking the format already shown changes nothing', async () => {
      const text = '{ a: ';
      await type(text);
      await click('raw-apply');
      const error = editor().error();
      await click('raw-format-shell');
      expect(editor().value).toBe(text);
      expect(editor().error()).toBe(error);
      expect(q('raw-dirty')).not.toBeNull();
    });

    it('a successful switch clears an earlier unplaced error', async () => {
      await type('{ _id: ObjectId("000000000000000000000000"), name: "x" }');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toContain('cannot be changed');
      await click('raw-format-ejson');
      expect(q('raw-error')).toBeNull();
      expect(button('raw-format-ejson').getAttribute('aria-pressed')).toBe('true');
      expect(editor().value).toContain('{"$oid":"000000000000000000000000"}');
    });
  });

  describe('syntax errors', () => {
    it('marks a shell syntax error at its line and column', async () => {
      const text = '{\n  a: 1,\n  b: foo(2)\n}';
      await type(text);
      await click('raw-apply');
      const error = q('raw-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent?.trim()).toMatch(/foo.*\(line 3, column 6\)$/);
      expect(editor().error()).toMatchObject({ line: 3, column: 6, offset: text.indexOf('foo') });
      const marks = diagnostics();
      expect(marks).toHaveLength(1);
      expect(marks[0]).toMatchObject({ from: text.indexOf('foo'), to: text.indexOf('foo') + 1 });
      // The mark is drawn in the editor, and the content points to the message.
      await fixture.whenStable();
      expect(el().querySelector('.cm-lintRange-error')).not.toBeNull();
      const content = el().querySelector('.cm-content');
      expect(content?.getAttribute('aria-invalid')).toBe('true');
      expect(content?.getAttribute('aria-describedby')).toBe(error?.id);
      // The cursor moves to the error.
      expect(view().state.selection.main.head).toBe(text.indexOf('foo'));
      expect(edits.modified()).toBe(false);
    });

    it('refuses code (functions) instead of evaluating it', async () => {
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), x: function () { return 1 } }');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toMatch(/\(line 1, column 49\)/);
      expect(edits.modified()).toBe(false);
    });

    it('marks an EJSON syntax error at its line and column', async () => {
      await click('raw-format-ejson');
      const text = `{\n  "_id": ${ID},\n  "a": 1,,\n}`;
      await type(text);
      await click('raw-apply');
      expect(editor().error()).toMatchObject({
        line: 3,
        column: 10,
        offset: text.indexOf(',,') + 1,
      });
      expect(q('raw-error')?.textContent).toMatch(/\(line 3, column 10\)/);
      expect(diagnostics()[0]).toMatchObject({ from: text.indexOf(',,') + 1 });
    });

    it('shows EJSON value errors without a place', async () => {
      await click('raw-format-ejson');
      await type(`{"_id":${ID},"a":{"$oid":"nope"}}`);
      await click('raw-apply');
      expect(editor().error()).toMatchObject({ line: null, offset: null });
      expect(q('raw-error')?.textContent).toMatch(/oid/i);
      expect(diagnostics()).toHaveLength(0);
    });

    it('marks an error at the end of the text', async () => {
      await type('{ a: 1');
      await click('raw-apply');
      expect(editor().error()).toMatchObject({ line: 1, column: 7 });
      expect(diagnostics()[0]).toMatchObject({ from: 5, to: 6 });
    });

    it('marks an error in empty text without a crash', async () => {
      await type('');
      await click('raw-apply');
      expect(editor().error()).toMatchObject({ line: 1, column: 1, offset: 0 });
      expect(q('raw-error')?.textContent).toMatch(/\(line 1, column 1\)/);
      const marks = diagnostics();
      expect(marks.every((m) => m.from >= 0 && m.to <= 0)).toBe(true);
      expect(edits.modified()).toBe(false);
    });

    it('refuses a top level that is not a document', async () => {
      await type('[1, 2]');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toMatch(/Expected a document.*line 1, column 1/);
    });

    it('clears the error when the text is typed again', async () => {
      await type('{ a: ');
      await click('raw-apply');
      expect(q('raw-error')).not.toBeNull();
      await type('{ a: 1 }');
      expect(q('raw-error')).toBeNull();
      expect(diagnostics()).toHaveLength(0);
      expect(el().querySelector('.cm-content')?.getAttribute('aria-invalid')).toBeNull();
    });
  });

  describe('apply', () => {
    it('records the text as an edit of the document', async () => {
      await type(
        '{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), name: "Grace", n: NumberLong("9007199254740993"), extra: NumberDecimal("1.10") }',
      );
      expect(button('raw-apply').disabled).toBe(false);
      await click('raw-apply');
      const expected = parseEJsonDocument(
        `{"_id":${ID},"name":"Grace","n":{"$numberLong":"9007199254740993"},"extra":{"$numberDecimal":"1.10"}}`,
      );
      expect(edits.modified()).toBe(true);
      expect(edits.current(DOC)).toEqual(expected);
      expect(edits.documents()[0]?.original).toBe(DOC);
      expect(edits.changeCount()).toBeGreaterThan(0);
      expect(host.applied).toEqual([expected]);
      // The text is the applied document, printed again.
      expect(editor().value).toContain('extra: NumberDecimal("1.10")');
      expect(q('raw-dirty')).toBeNull();
      expect(button('raw-apply').disabled).toBe(true);
    });

    it('applies EJSON text', async () => {
      await click('raw-format-ejson');
      await type(`{"_id":${ID},"name":"Lin"}`);
      await click('raw-apply');
      expect(edits.current(DOC)).toEqual(parseEJsonDocument(`{"_id":${ID},"name":"Lin"}`));
      expect(editor().value).toBe(stringifyEJson(edits.current(DOC), 2));
    });

    it('applies text that is already in printed form and keeps it as it is', async () => {
      const text = '{\n  _id: ObjectId("65a1b2c3d4e5f60718293a4b"),\n  name: "Grace"\n}';
      await type(text);
      await click('raw-apply');
      expect(edits.current(DOC)).toEqual(parseEJsonDocument(`{"_id":${ID},"name":"Grace"}`));
      expect(editor().value).toBe(text);
      expect(q('raw-dirty')).toBeNull();
      expect(button('raw-apply').disabled).toBe(true);
    });

    it('applies the same text twice as one recorded state', async () => {
      const text = '{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), name: "Grace" }';
      await type(text);
      await click('raw-apply');
      const count = edits.changeCount();
      expect(editor().apply()).toBe(true);
      await fixture.whenStable();
      expect(edits.changeCount()).toBe(count);
      expect(edits.current(DOC)).toEqual(parseEJsonDocument(`{"_id":${ID},"name":"Grace"}`));
    });

    it('applies with Ctrl+Enter', async () => {
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), k: 1 }');
      const content = el().querySelector('.cm-content') as HTMLElement;
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await fixture.whenStable();
      expect(edits.current(DOC)).toEqual(
        parseEJsonDocument(`{"_id":${ID},"k":{"$numberInt":"1"}}`),
      );
    });

    it('passes partial to the edit session', async () => {
      host.partial.set(true);
      await fixture.whenStable();
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b") }');
      await click('raw-apply');
      expect(edits.documents()[0]?.partial).toBe(true);
    });

    it('refuses a changed or missing _id', async () => {
      await type('{ _id: ObjectId("000000000000000000000000"), name: "x" }');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toContain('cannot be changed');
      await type('{ name: "x" }');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toContain('needs its _id');
      expect(edits.modified()).toBe(false);
      expect(host.applied).toEqual([]);
    });

    it('can be undone in the edit session, and the text follows', async () => {
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), name: "Grace" }');
      await click('raw-apply');
      edits.undo();
      await fixture.whenStable();
      expect(editor().value).toContain('name: "Ada"');
      edits.redo();
      await fixture.whenStable();
      expect(editor().value).toContain('name: "Grace"');
    });

    it('keeps unapplied text when the document changes elsewhere', async () => {
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), mine: 1 }');
      edits.edit(DOC, parseEJsonDocument(`{"_id":${ID},"theirs":true}`));
      await fixture.whenStable();
      expect(editor().value).toContain('mine: 1');
      expect(q('raw-dirty')).not.toBeNull();
      await click('raw-reset');
      expect(editor().value).toContain('theirs: true');
      expect(q('raw-dirty')).toBeNull();
    });

    it('shows another document instead of keeping unapplied text of the previous one', async () => {
      await type('{ _id: ObjectId("000000000000000000000000"), mine: 1 }');
      await click('raw-apply');
      expect(q('raw-error')?.textContent).toContain('cannot be changed');
      expect(q('raw-dirty')).not.toBeNull();
      // The same instance gets a different document (a list reusing it after paging).
      const other = parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Lin"}');
      host.doc.set(other);
      await fixture.whenStable();
      expect(editor().value).toBe(
        '{\n  _id: ObjectId("65a1b2c3d4e5f60718293a4c"),\n  name: "Lin"\n}',
      );
      expect(editor().dirty()).toBe(false);
      expect(q('raw-dirty')).toBeNull();
      expect(editor().error()).toBeNull();
      expect(q('raw-error')).toBeNull();
      expect(diagnostics()).toHaveLength(0);
      expect(button('raw-apply').disabled).toBe(true);
      // A new object for the same _id (a re-query) keeps the unapplied text.
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4c"), name: "Kay" }');
      host.doc.set(parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Lin"}'));
      await fixture.whenStable();
      expect(editor().value).toContain('name: "Kay"');
      expect(q('raw-dirty')).not.toBeNull();
      expect(edits.modified()).toBe(false);
    });

    it('keeps the chosen format when another document comes in', async () => {
      await click('raw-format-ejson');
      await type(`{"_id":${ID},"mine":1}`);
      expect(q('raw-dirty')).not.toBeNull();
      const other = parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Lin"}');
      host.doc.set(other);
      await fixture.whenStable();
      expect(button('raw-format-ejson').getAttribute('aria-pressed')).toBe('true');
      expect(editor().format()).toBe('ejson');
      expect(editor().value).toBe(stringifyEJson(other, 2));
      expect(q('raw-dirty')).toBeNull();
      // The new text is applied as the new document.
      await type('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Kay"}');
      await click('raw-apply');
      expect(q('raw-error')).toBeNull();
      expect(edits.current(other)).toEqual(
        parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Kay"}'),
      );
      expect(edits.current(DOC)).toEqual(DOC);
    });

    it('shows the unsaved edits of a document that comes in', async () => {
      const other = parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Lin"}');
      edits.edit(
        other,
        parseEJsonDocument('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Edited"}'),
      );
      await type('{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), mine: 1 }');
      host.doc.set(other);
      await fixture.whenStable();
      expect(editor().value).toBe(
        '{\n  _id: ObjectId("65a1b2c3d4e5f60718293a4c"),\n  name: "Edited"\n}',
      );
      expect(q('raw-dirty')).toBeNull();
    });

    it('shows another document without _id instead of the unapplied text of the previous one', async () => {
      host.doc.set(parseEJsonDocument('{"a":{"$numberInt":"1"}}'));
      await fixture.whenStable();
      await type('{ a: 2 }');
      expect(q('raw-dirty')).not.toBeNull();
      host.doc.set(parseEJsonDocument('{"b":{"$numberInt":"3"}}'));
      await fixture.whenStable();
      expect(editor().value).toBe('{\n  b: 3\n}');
      expect(q('raw-dirty')).toBeNull();
      expect(q('raw-no-id')).not.toBeNull();
      // From a document without _id to one with an _id.
      await type('{ b: 4 }');
      host.doc.set(DOC);
      await fixture.whenStable();
      expect(editor().value).toContain('name: "Ada"');
      expect(q('raw-dirty')).toBeNull();
      expect(q('raw-no-id')).toBeNull();
      expect(edits.modified()).toBe(false);
    });

    it('reset discards unapplied changes', async () => {
      const before = editor().value;
      await type('{ broken');
      await click('raw-apply');
      await click('raw-reset');
      expect(editor().value).toBe(before);
      expect(q('raw-error')).toBeNull();
      expect(button('raw-reset').disabled).toBe(true);
    });

    it('does not apply when read-only, and the text cannot be edited', async () => {
      host.readOnly.set(true);
      await fixture.whenStable();
      expect(view().state.readOnly).toBe(true);
      expect(el().querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
      // The format can still be switched.
      await click('raw-format-ejson');
      expect(editor().value).toBe(stringifyEJson(DOC, 2));
      expect(editor().apply()).toBe(false);
      expect(button('raw-apply').disabled).toBe(true);
      expect(edits.modified()).toBe(false);
    });

    it('cannot apply a document without _id', async () => {
      host.doc.set(parseEJsonDocument('{"a":1}'));
      await fixture.whenStable();
      expect(q('raw-no-id')).not.toBeNull();
      await type('{ a: 2 }');
      expect(button('raw-apply').disabled).toBe(true);
      expect(editor().apply()).toBe(false);
      expect(edits.modified()).toBe(false);
    });
  });
});
