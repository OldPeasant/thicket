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

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WriteControl],
  template: `
    <button appWriteControl="a" title="Save (Ctrl+S)">Save</button>
    <button appWriteControl="a" [title]="tip()">Delete</button>
  `,
})
class TitledHost {
  readonly tip = signal('Delete the document');
}

describe('WriteControl', () => {
  it('an empty bound title leaves no title attribute on a writable control', async () => {
    const fixture = TestBed.createComponent(TitledHost);
    const del = (fixture.nativeElement as HTMLElement).querySelectorAll('button')[1];
    fixture.componentInstance.tip.set('');
    await fixture.whenStable();
    expect(del?.hasAttribute('title')).toBe(false);
    expect(del?.hasAttribute('disabled')).toBe(false);

    TestBed.inject(ProfileSafetyService).set({
      id: 'a',
      name: 'A',
      readOnly: true,
      production: false,
    });
    await fixture.whenStable();
    expect(del?.title).toBe(READ_ONLY_HINT);
    expect(del?.hasAttribute('disabled')).toBe(true);
  });

  it('keeps the control own title on writable profiles and restores it after read-only', async () => {
    const fixture = TestBed.createComponent(TitledHost);
    const safety = TestBed.inject(ProfileSafetyService);
    const [save, del] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    await fixture.whenStable();
    expect(save?.title).toBe('Save (Ctrl+S)');
    expect(del?.title).toBe('Delete the document');

    safety.set({ id: 'a', name: 'A', readOnly: true, production: false });
    await fixture.whenStable();
    expect(save?.title).toBe(READ_ONLY_HINT);
    expect(del?.title).toBe(READ_ONLY_HINT);

    safety.set({ id: 'a', name: 'A', readOnly: false, production: false });
    fixture.componentInstance.tip.set('Delete it');
    await fixture.whenStable();
    expect(save?.title).toBe('Save (Ctrl+S)');
    expect(del?.title).toBe('Delete it');
  });

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

  it('re-enables the control and drops the hint when the profile stops being read-only', async () => {
    const safety = TestBed.inject(ProfileSafetyService);
    safety.set({ id: 'a', name: 'A', readOnly: true, production: true });
    const fixture = TestBed.createComponent(Host);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    await fixture.whenStable();
    expect(button?.disabled).toBe(true);

    safety.set({ id: 'a', name: 'A', readOnly: false, production: true });
    await fixture.whenStable();
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute('title')).toBe(false);
    expect(button?.hasAttribute('data-readonly')).toBe(false);

    safety.set({ id: 'a', name: 'A', readOnly: true, production: true });
    await fixture.whenStable();
    safety.remove('a');
    await fixture.whenStable();
    expect(button?.disabled).toBe(false);
  });

  it('production alone does not disable write controls', async () => {
    const safety = TestBed.inject(ProfileSafetyService);
    safety.set({ id: 'a', name: 'A', readOnly: false, production: true });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button?.disabled).toBe(false);
    expect(safety.production('a')).toBe(safety.production('a'));
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
