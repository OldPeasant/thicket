import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';

import { StatusService } from '../layout/status.service';
import { WorkspaceService } from '../layout/workspace.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { WriteGuard } from '../safety/write-guard.service';

/** Profile id of the demo's production connection. */
export const DEMO_PROFILE = 'dev-safety-prod';

/**
 * Development page (`#/dev/safety`, inside the main window): a production connection with an open
 * tab, the red accent on the tab strip, sidebar and status bar, and the confirm dialog for a
 * `deleteMany` over 1 000 documents. Nothing is sent: the dialog only previews the write.
 */
@Component({
  selector: 'app-safety-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="note">Safety demo: production connection and confirm dialog.</p>`,
  styles: `
    .note {
      margin: 1rem;
      color: var(--text-muted);
    }
  `,
})
export class SafetyDemo {
  constructor() {
    const safety = inject(ProfileSafetyService);
    const workspace = inject(WorkspaceService);
    const status = inject(StatusService);
    const guard = inject(WriteGuard);
    const abort = new AbortController();
    inject(DestroyRef).onDestroy(() => abort.abort());

    safety.set({ id: DEMO_PROFILE, name: 'orders-prod', readOnly: false, production: true });
    status.setConnection({ name: 'orders-prod', state: 'connected', production: true });
    // After the navigation ended (which shows the start page), open the tabs and the dialog.
    setTimeout(() => {
      if (abort.signal.aborted) return;
      workspace.open({
        id: 'dev-safety-local',
        kind: 'collection',
        title: 'events',
        detail: 'local / app',
      });
      workspace.open({
        id: 'dev-safety-orders',
        kind: 'collection',
        title: 'orders',
        detail: 'orders-prod / shop',
        production: true,
      });
      guard
        .approve(
          'docs.deleteMany',
          {
            profileId: DEMO_PROFILE,
            db: 'shop',
            coll: 'orders',
            filter: '{"status":"cancelled","createdAt":{"$lt":{"$date":"2025-01-01T00:00:00Z"}}}',
            expectedCount: 12431,
          },
          { signal: abort.signal, confirmLabel: 'Delete documents' },
        )
        .catch(() => undefined);
    });
  }
}
