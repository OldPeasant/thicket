import { Directive, computed, inject, input } from '@angular/core';

import { ProfileSafetyService } from './profile-safety.service';

/** Tooltip of write controls on read-only connections. */
export const READ_ONLY_HINT = 'Read-only connection: writes are turned off';

/**
 * Disables a write control (button, input, fieldset) while its profile is read-only:
 * `<button [appWriteControl]="profileId">Save</button>`. Also `disabledWhen` for the control's
 * own conditions, since a host `[disabled]` binding would fight this one.
 */
@Directive({
  selector: '[appWriteControl]',
  exportAs: 'writeControl',
  host: {
    '[attr.disabled]': 'disabled() ? "" : null',
    '[attr.data-readonly]': 'readOnly() ? "" : null',
    '[attr.title]': 'readOnly() ? hint : null',
  },
})
export class WriteControl {
  private readonly safety = inject(ProfileSafetyService);

  /** Profile the control writes to. */
  readonly appWriteControl = input.required<string>();
  /** Other reasons to disable the control (e.g. nothing changed). */
  readonly disabledWhen = input(false);

  readonly readOnly = computed(() => this.safety.readOnly(this.appWriteControl())());
  readonly disabled = computed(() => this.readOnly() || this.disabledWhen());
  protected readonly hint = READ_ONLY_HINT;
}
