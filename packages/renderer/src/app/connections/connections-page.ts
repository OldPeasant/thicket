import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Profile } from '@thicket/contract';

import { describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';
import { NAV, editConnectionUrl } from '../layout/navigation';
import { WorkspaceService } from '../layout/workspace.service';
import { SidebarTreeService } from '../sidebar/sidebar-tree.service';
import { hostSummary } from './connection-form.model';

/** Profiles of one folder, as the manager lists them. */
export interface ProfileGroup {
  /** Folder path; '' for profiles without a folder. */
  folder: string;
  profiles: readonly Profile[];
}

/** Groups profiles by folder: no folder first, then folders by name; profiles by name. */
export function groupByFolder(profiles: readonly Profile[]): ProfileGroup[] {
  const byFolder = new Map<string, Profile[]>();
  for (const p of profiles) {
    const folder = p.folder ?? '';
    const list = byFolder.get(folder) ?? [];
    list.push(p);
    byFolder.set(folder, list);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({
      folder,
      profiles: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * Connection manager (`/connections`): every profile grouped by folder with its color, address
 * and flags; edit, duplicate and delete (asked inline first).
 */
@Component({
  selector: 'app-connections-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './connections-page.html',
  styleUrl: './connections-page.css',
})
export class ConnectionsPage {
  protected readonly tree = inject(SidebarTreeService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly workspace = inject(WorkspaceService);

  protected readonly nav = NAV;
  protected readonly groups = computed(() => groupByFolder(this.tree.profileList()));
  /** Profile whose deletion is being asked. */
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.tree.start();
  }

  protected summary(profile: Profile): string {
    return hostSummary(profile.connectionString);
  }

  protected edit(profile: Profile): void {
    void this.router.navigateByUrl(editConnectionUrl(profile.id));
  }

  protected async duplicate(profile: Profile): Promise<void> {
    await this.run(async () => {
      const { profile: copy } = await this.api.request('profiles.duplicate', {
        profileId: profile.id,
      });
      await this.tree.reloadProfiles();
      void this.router.navigateByUrl(editConnectionUrl(copy.id));
    });
  }

  protected async remove(profile: Profile): Promise<void> {
    await this.run(async () => {
      if (this.tree.conn(profile.id).state !== 'disconnected') {
        await this.tree.disconnect(profile.id).catch(() => undefined);
      }
      await this.api.request('profiles.delete', { profileId: profile.id });
      for (const tab of this.workspace.tabs()) {
        const data = tab.data as { profileId?: unknown } | undefined;
        if (data?.profileId === profile.id) this.workspace.close(tab.id);
      }
      this.confirmDelete.set(null);
      await this.tree.reloadProfiles();
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
