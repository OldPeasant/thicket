import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ProfileSafetyService } from './profile-safety.service';
import { READ_ONLY_HINT, WriteControl } from './write-control.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  template: `<button [appWriteControl]="profileId()" [disabledWhen]="busy()">Save</button>`,
})
class Host {
  readonly profileId = signal('a');
  readonly busy = signal(false);
}

describe('WriteControl', () => {
  it('disables the control while its profile is read-only and follows flag changes', async () => {
    const fixture = TestBed.createComponent(Host);
    const safety = TestBed.inject(ProfileSafetyService);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    await fixture.whenStable();
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute('title')).toBe(false);

    safety.set({ id: 'a', name: 'A', readOnly: true, production: false });
    await fixture.whenStable();
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe(READ_ONLY_HINT);
    expect(button?.hasAttribute('data-readonly')).toBe(true);

    fixture.componentInstance.profileId.set('b');
    await fixture.whenStable();
    expect(button?.disabled).toBe(false);

    fixture.componentInstance.busy.set(true);
    await fixture.whenStable();
    expect(button?.disabled).toBe(true);
    expect(button?.hasAttribute('data-readonly')).toBe(false);
  });

  it('profile flags are signals per id; unknown profiles are neither', () => {
    const safety = TestBed.inject(ProfileSafetyService);
    const ro = safety.readOnly('x');
    const prod = safety.production('x');
    expect(ro()).toBe(false);
    expect(prod()).toBe(false);
    expect(safety.readOnly('x')).toBe(ro);
    safety.set({ id: 'x', name: 'X', readOnly: true, production: true });
    expect(ro()).toBe(true);
    expect(prod()).toBe(true);
    expect(safety.get('x')?.name).toBe('X');
    safety.remove('x');
    safety.remove('x');
    expect(ro()).toBe(false);
    expect(safety.get('x')).toBeNull();
  });
});
