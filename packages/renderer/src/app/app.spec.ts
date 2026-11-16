import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('creates the root component and renders the start page', async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const harness = await RouterTestingHarness.create('/');

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toBe('Thicket');
    expect(page.querySelector('main.shell p')?.textContent).toBe('A desktop client for MongoDB.');
  });

  it('hosts the routed page in a router outlet', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appConfig.providers,
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeInstanceOf(App);
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });

  it('sends unknown routes to the start page', async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const harness = await RouterTestingHarness.create('/no/such/page');

    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Thicket',
    );
  });

  it('runs zoneless: zone.js is not loaded', () => {
    // provideZonelessChangeDetection() in appConfig; nothing may pull in zone.js as a polyfill.
    expect(globalThis).not.toHaveProperty('Zone');
  });
});
