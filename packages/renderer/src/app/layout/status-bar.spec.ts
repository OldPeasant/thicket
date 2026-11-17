import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { StatusBar } from './status-bar';
import { StatusService } from './status.service';

describe('StatusBar', () => {
  let fixture: ComponentFixture<StatusBar>;
  let status: StatusService;
  let el: HTMLElement;

  const conn = () => el.querySelector('[data-testid="status-connection"]');
  const ops = () => el.querySelector('[data-testid="status-operations"]');
  const bar = () => el.querySelector<HTMLElement>('[role="progressbar"]');
  const render = () => fixture.whenStable();

  beforeEach(async () => {
    fixture = TestBed.createComponent(StatusBar);
    status = TestBed.inject(StatusService);
    el = fixture.nativeElement as HTMLElement;
    await render();
  });

  it('shows "No connection" and no progress bar when idle', () => {
    expect(conn()?.textContent).toContain('No connection');
    expect(conn()?.querySelector('.dot')?.getAttribute('data-state')).toBe('none');
    expect(bar()).toBeNull();
  });

  it.each([
    ['connecting', 'Connecting…'],
    ['connected', 'Connected'],
    ['disconnected', 'Disconnected'],
    ['error', 'Connection failed'],
  ] as const)('names the connection state %s', async (state, text) => {
    status.setConnection({ name: 'staging-1', state });
    await render();
    expect(conn()?.querySelector('.name')?.textContent).toBe('staging-1');
    expect(conn()?.querySelector('.state')?.textContent).toBe(text);
    expect(conn()?.querySelector('.dot')?.getAttribute('data-state')).toBe(state);
  });

  it('flags production and read-only connections only when set', async () => {
    status.setConnection({ name: 'plain', state: 'connected' });
    await render();
    expect(conn()?.querySelector('.flag')).toBeNull();
    status.setConnection({ name: 'prod', state: 'connected', production: true, readonly: true });
    await render();
    expect(conn()?.querySelector('.flag.production')?.textContent).toBe('Production');
    expect(conn()?.querySelector('.flag.readonly')?.textContent).toBe('Read-only');
  });

  it('shows an indeterminate bar while the progress is unknown', async () => {
    status.begin('Loading orders');
    await render();
    expect(ops()?.querySelector('.label')?.textContent).toBe('Loading orders');
    expect(bar()?.classList).toContain('indeterminate');
    expect(bar()?.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar()?.getAttribute('aria-label')).toBe('Loading orders');
    expect(ops()?.querySelector('.more')).toBeNull();
  });

  it('shows known progress as a percentage, clamped to 0…100', async () => {
    const op = status.begin('Import', 0.333);
    await render();
    expect(bar()?.getAttribute('aria-valuenow')).toBe('33');
    expect(bar()?.classList).not.toContain('indeterminate');
    expect(bar()?.querySelector<HTMLElement>('.fill')?.style.width).toBe('33%');
    op.update({ progress: 1.7 });
    await render();
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100');
    op.update({ progress: -0.2 });
    await render();
    expect(bar()?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('tints the bar for production and marks read-only connections', async () => {
    const host = fixture.nativeElement as HTMLElement;
    status.setConnection({ name: 'dev', state: 'connected' });
    await render();
    expect(host.classList).not.toContain('production');
    status.setConnection({ name: 'prod', state: 'connected', production: true, readonly: true });
    await render();
    expect(host.classList).toContain('production');
    expect(host.classList).toContain('readonly');
  });

  it('counts the other running operations', async () => {
    status.begin('A');
    status.begin('B');
    status.begin('C');
    await render();
    expect(ops()?.querySelector('.label')?.textContent).toBe('C');
    expect(ops()?.querySelector('.more')?.textContent).toBe('+2 more');
  });

  describe('connection input', () => {
    it("shows the input connection instead of the status service's", async () => {
      status.setConnection({ name: 'service-conn', state: 'error' });
      fixture.componentRef.setInput('connection', {
        name: 'tab-conn',
        state: 'connected',
        production: true,
        readonly: true,
      });
      await render();
      expect(conn()?.querySelector('.name')?.textContent).toBe('tab-conn');
      expect(conn()?.querySelector('.state')?.textContent).toBe('Connected');
      expect(conn()?.querySelector('.dot')?.getAttribute('data-state')).toBe('connected');
      expect(conn()?.textContent).not.toContain('service-conn');
      expect(conn()?.querySelector('.flag.production')?.textContent).toBe('Production');
      expect(conn()?.querySelector('.flag.readonly')?.textContent).toBe('Read-only');
      const host = fixture.nativeElement as HTMLElement;
      expect(host.classList).toContain('production');
      expect(host.classList).toContain('readonly');
    });

    it('shows the input connection when the status service has none', async () => {
      fixture.componentRef.setInput('connection', { name: 'tab-only', state: 'connecting' });
      await render();
      expect(conn()?.querySelector('.name')?.textContent).toBe('tab-only');
      expect(conn()?.querySelector('.state')?.textContent).toBe('Connecting…');
      expect(conn()?.textContent).not.toContain('No connection');
    });

    it("falls back to the status service's connection when the input is cleared", async () => {
      const host = fixture.nativeElement as HTMLElement;
      status.setConnection({ name: 'service-conn', state: 'disconnected' });
      fixture.componentRef.setInput('connection', {
        name: 'tab-conn',
        state: 'connected',
        production: true,
      });
      await render();
      expect(host.classList).toContain('production');
      fixture.componentRef.setInput('connection', undefined);
      await render();
      expect(conn()?.querySelector('.name')?.textContent).toBe('service-conn');
      expect(conn()?.querySelector('.state')?.textContent).toBe('Disconnected');
      expect(conn()?.querySelector('.flag')).toBeNull();
      expect(host.classList).not.toContain('production');
      expect(host.classList).not.toContain('readonly');
      status.setConnection(null);
      await render();
      expect(conn()?.textContent).toContain('No connection');
    });
  });

  it('announces operations politely', () => {
    expect(ops()?.getAttribute('role')).toBe('status');
    expect(ops()?.getAttribute('aria-live')).toBe('polite');
  });
});
