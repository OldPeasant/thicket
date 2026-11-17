import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Profile, ResultOf } from '@thicket/contract';

import { describeError } from '../../api/api-error';
import { ApiService } from '../../api/api.service';
import { NAV } from '../../layout/navigation';
import { SidebarTreeService } from '../../sidebar/sidebar-tree.service';
import { hostSummary } from '../connection-form.model';

type ImportResult = ResultOf<'profiles.importUris'>;

/** What the last import or export did, as the page reports it. */
export type TransferOutcome =
  | { kind: 'import'; from: 'file' | 'uris'; result: ImportResult }
  | { kind: 'export'; path: string; exported: number };

/** The non-blank lines of the connection strings field. */
export function uriLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function count(n: number): string {
  return `${String(n)} ${n === 1 ? 'connection' : 'connections'}`;
}

/** "Imported 3 connections, skipped 1." */
export function importSummary(result: ImportResult): string {
  const skipped = result.skipped.length;
  if (result.imported.length === 0 && skipped === 0)
    return 'Nothing was imported: no connections found.';
  return `Imported ${count(result.imported.length)}${skipped > 0 ? `, skipped ${String(skipped)}` : ''}.`;
}

/**
 * Import and export of connections (`/connections/import/compass`): a Compass (or Thicket)
 * connections file chosen with the native dialog (`profiles.importCompass`), a list of
 * connection strings (`profiles.importUris`), and the export of selected profiles without
 * secrets (`profiles.export`). Imported profiles show up in the sidebar right away.
 */
@Component({
  selector: 'app-import-export-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './import-export-page.html',
  styleUrl: './import-export-page.css',
})
export class ImportExportPage {
  protected readonly tree = inject(SidebarTreeService);
  private readonly api = inject(ApiService);

  protected readonly nav = NAV;
  protected readonly uriText = signal('');
  protected readonly uriCount = computed(() => uriLines(this.uriText()).length);
  /** Profiles chosen for export (ids). */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly profiles = computed(() =>
    [...this.tree.profileList()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  /** Chosen ids of profiles that still exist, in name order. */
  protected readonly selectedIds = computed(() =>
    this.profiles()
      .map((p) => p.id)
      .filter((id) => this.selected().has(id)),
  );
  protected readonly allSelected = computed(
    () => this.profiles().length > 0 && this.selectedIds().length === this.profiles().length,
  );
  protected readonly count = count;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly outcome = signal<TransferOutcome | null>(null);

  constructor() {
    this.tree.start();
  }

  protected importSummary(result: ImportResult): string {
    return importSummary(result);
  }

  protected summary(profile: Profile): string {
    return hostSummary(profile.connectionString);
  }

  protected toggle(id: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleAll(on: boolean): void {
    this.selected.set(new Set(on ? this.profiles().map((p) => p.id) : []));
  }

  protected async importFile(): Promise<void> {
    await this.run(async () => {
      const result = await this.api.request('profiles.importCompass', {});
      if (result === null) return;
      this.outcome.set({ kind: 'import', from: 'file', result });
      await this.tree.reloadProfiles();
    });
  }

  protected async importUris(): Promise<void> {
    const uris = uriLines(this.uriText());
    if (uris.length === 0) return;
    await this.run(async () => {
      const result = await this.api.request('profiles.importUris', { uris });
      this.outcome.set({ kind: 'import', from: 'uris', result });
      // Keep the lines that failed, so they can be fixed and imported again.
      if (result.skipped.length === 0) this.uriText.set('');
      await this.tree.reloadProfiles();
    });
  }

  protected async exportSelected(): Promise<void> {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    await this.run(async () => {
      const { path, exported } = await this.api.request('profiles.export', { profileIds: ids });
      if (path !== null) this.outcome.set({ kind: 'export', path, exported });
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
    } catch (error) {
      this.error.set(describeError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
