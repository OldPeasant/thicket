import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('creates the root component and renders the title', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appConfig.providers,
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance).toBeInstanceOf(App);
    expect(root.querySelector('h1')?.textContent).toBe('Thicket');
    expect(root.querySelector('main.shell p')?.textContent).toBe('A desktop client for MongoDB.');
  });

  it('runs zoneless: zone.js is not loaded', () => {
    // provideZonelessChangeDetection() in appConfig; nothing may pull in zone.js as a polyfill.
    expect(globalThis).not.toHaveProperty('Zone');
  });
});
