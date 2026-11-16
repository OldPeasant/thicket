import { describe, expect, it, vi } from 'vitest';

import type { DocumentActions } from './document-actions.service';
import { handleEditKeys, plural } from './edit-bar';
import type { DocumentEdits } from './edit-session';

/** The parts of the edit session and the actions the keys use. */
function setup(state: { modified?: boolean; busy?: boolean } = {}) {
  const edits = { modified: () => state.modified ?? true, undo: vi.fn(), redo: vi.fn() };
  const actions = { busy: () => state.busy ?? false, saveAll: vi.fn(() => Promise.resolve(1)) };
  return {
    edits,
    actions,
    press(
      init: KeyboardEventInit,
      target: HTMLElement = document.createElement('div'),
      canWrite = true,
    ) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'target', { value: target });
      const handled = handleEditKeys(
        event,
        edits as unknown as DocumentEdits,
        actions as unknown as DocumentActions,
        canWrite,
      );
      return { handled, prevented: event.defaultPrevented };
    },
  };
}

// handleEditKeys: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo, Ctrl/Cmd+S save; text fields
// keep their own undo; nothing while a write runs.
describe('handleEditKeys', () => {
  it('undoes with Ctrl+Z and Cmd+Z', () => {
    const s = setup();
    expect(s.press({ key: 'z', ctrlKey: true })).toEqual({ handled: true, prevented: true });
    expect(s.press({ key: 'z', metaKey: true })).toEqual({ handled: true, prevented: true });
    expect(s.edits.undo).toHaveBeenCalledTimes(2);
    expect(s.edits.redo).not.toHaveBeenCalled();
  });

  it('redoes with Ctrl+Shift+Z and Ctrl+Y, not with Ctrl+Shift+Y', () => {
    const s = setup();
    expect(s.press({ key: 'Z', ctrlKey: true, shiftKey: true }).handled).toBe(true);
    expect(s.press({ key: 'y', ctrlKey: true }).handled).toBe(true);
    expect(s.edits.redo).toHaveBeenCalledTimes(2);
    expect(s.press({ key: 'Y', ctrlKey: true, shiftKey: true })).toEqual({
      handled: false,
      prevented: false,
    });
    expect(s.edits.redo).toHaveBeenCalledTimes(2);
  });

  it('ignores keys without Ctrl/Cmd, with Alt, and other letters', () => {
    const s = setup();
    expect(s.press({ key: 'z' }).handled).toBe(false);
    expect(s.press({ key: 'z', ctrlKey: true, altKey: true }).handled).toBe(false);
    expect(s.press({ key: 's', ctrlKey: true, altKey: true }).handled).toBe(false);
    expect(s.press({ key: 'a', ctrlKey: true })).toEqual({ handled: false, prevented: false });
    expect(s.edits.undo).not.toHaveBeenCalled();
    expect(s.actions.saveAll).not.toHaveBeenCalled();
  });

  it('leaves undo and redo in text fields to the field', () => {
    const s = setup();
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    for (const el of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      editable,
    ]) {
      expect(s.press({ key: 'z', ctrlKey: true }, el), el.tagName).toEqual({
        handled: false,
        prevented: false,
      });
      expect(s.press({ key: 'y', ctrlKey: true }, el).handled).toBe(false);
    }
    expect(s.edits.undo).not.toHaveBeenCalled();
    expect(s.edits.redo).not.toHaveBeenCalled();
  });

  it('saves with Ctrl+S, also from a text field', () => {
    const s = setup();
    expect(s.press({ key: 's', ctrlKey: true }, document.createElement('input'))).toEqual({
      handled: true,
      prevented: true,
    });
    expect(s.actions.saveAll).toHaveBeenCalledTimes(1);
  });

  it('swallows Ctrl+S without saving when read-only, unmodified or busy', () => {
    const readOnly = setup();
    expect(readOnly.press({ key: 's', ctrlKey: true }, undefined, false)).toEqual({
      handled: true,
      prevented: true,
    });
    const clean = setup({ modified: false });
    expect(clean.press({ key: 's', ctrlKey: true }).prevented).toBe(true);
    const busy = setup({ busy: true });
    expect(busy.press({ key: 's', ctrlKey: true }).prevented).toBe(true);
    for (const s of [readOnly, clean, busy]) expect(s.actions.saveAll).not.toHaveBeenCalled();
  });

  it('does not undo or redo while a write runs', () => {
    const s = setup({ busy: true });
    expect(s.press({ key: 'z', ctrlKey: true }).handled).toBe(false);
    expect(s.press({ key: 'y', ctrlKey: true }).handled).toBe(false);
    expect(s.edits.undo).not.toHaveBeenCalled();
    expect(s.edits.redo).not.toHaveBeenCalled();
  });
});

describe('plural', () => {
  it('uses the singular for one and formats the number', () => {
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(0, 'change')).toBe('0 changes');
    expect(plural(2, 'document')).toBe('2 documents');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    expect(plural(1200, 'change')).toBe(`${new Intl.NumberFormat().format(1200)} changes`);
  });
});
