import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { CurrentOpView } from './admin/currentop';
import { UsersRolesView } from './admin/users';
import { App } from './app';
import { appConfig } from './app.config';
import { ShellConsole } from './console';
import { GridfsView } from './gridfs';
import { IndexesView } from './indexes';
import { TAB_VIEWS } from './layout/tab-views';
import { WatchView } from './watch';

describe('App', () => {
  it('creates the root component and renders the start page in the layout', async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const harness = await RouterTestingHarness.create('/');

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.tagName.toLowerCase()).toBe('app-shell');
    expect(page.querySelector('app-welcome h1')?.textContent).toBe('Thicket');
    expect(page.querySelector('app-welcome .lede')?.textContent).toBe(
      'A desktop client for MongoDB.',
    );
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

  it('registers exactly one view per tab kind, including indexes, users and shell', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const views = TestBed.inject(TAB_VIEWS);

    const kinds = views.map((view) => view.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(views.find((view) => view.kind === 'indexes')?.component).toBe(IndexesView);
    expect(views.find((view) => view.kind === 'users')?.component).toBe(UsersRolesView);
    expect(views.find((view) => view.kind === 'shell')?.component).toBe(ShellConsole);
  });

  it('registers the current operations view for the currentop tab kind', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const views = TestBed.inject(TAB_VIEWS);

    expect(views.find((view) => view.kind === 'currentop')?.component).toBe(CurrentOpView);
  });

  it('registers the GridFS view for the gridfs tab kind', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const views = TestBed.inject(TAB_VIEWS);

    expect(views.find((view) => view.kind === 'gridfs')?.component).toBe(GridfsView);
  });

  it('registers the change-stream view for the watch tab kind', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const views = TestBed.inject(TAB_VIEWS);

    expect(views.filter((view) => view.kind === 'watch').map((view) => view.component)).toEqual([
      WatchView,
    ]);
  });

  it('runs zoneless: zone.js is not loaded', () => {
    // provideZonelessChangeDetection() in appConfig; nothing may pull in zone.js as a polyfill.
    expect(globalThis).not.toHaveProperty('Zone');
  });
});
