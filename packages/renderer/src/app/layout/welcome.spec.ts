import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withHashLocation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { routes } from '../app.routes';
import { NAV } from './navigation';

describe('Welcome', () => {
  async function start() {
    TestBed.configureTestingModule({
      providers: [
        provideFakeThicket(new FakeThicketBridge()),
        provideRouter(routes, withHashLocation()),
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    return { harness, el, router };
  }

  it('offers "New connection" and "Import from Compass"', async () => {
    const { el } = await start();
    const buttons = [...el.querySelectorAll('app-welcome button .action-title')].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(['New connection', 'Import from Compass']);
  });

  it('"New connection" navigates to the connection editor', async () => {
    const { harness, el, router } = await start();
    const spy = vi.spyOn(router, 'navigateByUrl');
    el.querySelector<HTMLElement>('[data-testid="welcome-new"]')?.click();
    await harness.fixture.whenStable();
    expect(spy).toHaveBeenCalledExactlyOnceWith(NAV.newConnection);
    expect(router.url).toBe('/connections/new');
    expect(el.querySelector('[data-testid="page-heading"]')?.textContent).toBe('New connection');
  });

  it('"Import from Compass" navigates to the Compass import', async () => {
    const { harness, el, router } = await start();
    const spy = vi.spyOn(router, 'navigateByUrl');
    el.querySelector<HTMLElement>('[data-testid="welcome-import"]')?.click();
    await harness.fixture.whenStable();
    expect(spy).toHaveBeenCalledExactlyOnceWith(NAV.importCompass);
    expect(router.url).toBe('/connections/import/compass');
    expect(el.querySelector('app-import-export-page h1')?.textContent).toBe(
      'Import and export connections',
    );
  });
});
