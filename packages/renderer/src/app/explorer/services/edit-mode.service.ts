import { Injectable, computed, signal } from '@angular/core';

// Global (not per-node) switch between the editor's read/write controls and
// a clean, read-only rendering of the same tree. Defaults to the quiet,
// read-only view — editing is an opt-in a user reaches for deliberately.
@Injectable({ providedIn: 'root' })
export class EditModeService {
  private readonly _enabled = signal(false);
  private readonly _readOnly = signal(false);

  // Effectively OFF whenever the host has marked the current file
  // read-only (see setReadOnly), regardless of the user's own toggle state.
  readonly enabled = computed(() => this._enabled() && !this._readOnly());

  readonly readOnly = this._readOnly.asReadonly();

  toggle(): void {
    if (this._readOnly()) return;
    this._enabled.update((v) => !v);
  }

  // Called whenever a new document is loaded, so switching to edit mode for
  // one file doesn't carry over and surprise-edit the next one opened.
  reset(): void {
    this._enabled.set(false);
  }

  // Called by the host app when the current document must not be edited
  // (e.g. a read-only source) — forces edit mode off and keeps toggle() a
  // no-op until it is cleared again. Nothing calls this yet, so it stays
  // false.
  setReadOnly(value: boolean): void {
    this._readOnly.set(value);
    if (value) this._enabled.set(false);
  }
}
