import { InjectionToken, type Provider, type Type } from '@angular/core';

import type { TabKind } from './workspace.service';

/**
 * A view component for a tab kind. It gets the tab as its `tab` input
 * (`readonly tab = input.required<WorkspaceTab>()`).
 */
export interface TabView {
  kind: TabKind;
  component: Type<unknown>;
}

/** The registered tab views (multi provider). */
export const TAB_VIEWS = new InjectionToken<readonly TabView[]>('TAB_VIEWS', {
  factory: () => [],
});

/** Registers `component` as the view of tabs of `kind` (in `appConfig` or a test). */
export function provideTabView(kind: TabKind, component: Type<unknown>): Provider {
  return { provide: TAB_VIEWS, multi: true, useValue: { kind, component } satisfies TabView };
}
