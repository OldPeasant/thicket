import { describe, expect, it } from 'vitest';

import {
  backendRestarted,
  isMethodName,
  parseParams,
  parseParamsIn,
  parseResult,
  parseResultIn,
  privilegedMethods,
  route,
} from './index';

describe('wiring diagnostics', () => {
  it('app.ping is served by main, backend.* by the backend', () => {
    expect(route('app.ping')).toBe('main');
    expect(route('backend.ping')).toBe('backend');
    expect(route('backend.sleep')).toBe('backend');
  });

  it('validates ping results', () => {
    expect(parseResult('app.ping', { process: 'main', version: '0.0.0' }).ok).toBe(true);
    expect(parseResult('app.ping', { process: 'backend', version: '0.0.0' }).ok).toBe(false);
    expect(
      parseResult('backend.ping', { process: 'backend', pid: 42, mainReachable: true }).ok,
    ).toBe(true);
  });

  it('backend.sleep needs a positive integer duration', () => {
    expect(parseParams('backend.sleep', { ms: 0 }).ok).toBe(false);
    expect(parseParams('backend.sleep', { ms: 1.5 }).ok).toBe(false);
    expect(parseParams('backend.sleep', {}).ok).toBe(false);
  });

  it('backend.restarted payload', () => {
    expect(backendRestarted.safeParse({ restarts: 1, reason: 'exit code 1' }).success).toBe(true);
    expect(backendRestarted.safeParse({ restarts: -1, reason: '' }).success).toBe(false);
  });
});

describe('privileged methods', () => {
  it('are not part of the renderer contract', () => {
    for (const name of Object.keys(privilegedMethods)) {
      expect(isMethodName(name)).toBe(false);
      expect(route(name)).toBeUndefined();
      expect(parseParams(name, {}).ok).toBe(false);
    }
  });

  it('validate against their own table', () => {
    expect(parseParamsIn(privilegedMethods, 'secrets.get', { profileId: 'p1' }).ok).toBe(true);
    const bad = parseParamsIn(privilegedMethods, 'secrets.get', {});
    expect(bad.ok ? undefined : bad.error.code).toBe('INVALID_PARAMS');
    const unknown = parseParamsIn(privilegedMethods, 'toString', {});
    expect(unknown.ok ? undefined : unknown.error.code).toBe('UNKNOWN_METHOD');
    expect(parseResultIn(privilegedMethods, 'secrets.get', { secrets: null }).ok).toBe(true);
    const wrong = parseResultIn(privilegedMethods, 'main.ping', { process: 'backend' });
    expect(wrong.ok ? undefined : wrong.error.code).toBe('INTERNAL');
    const missing = parseResultIn(privilegedMethods, 'nope', {});
    expect(missing.ok ? undefined : missing.error.code).toBe('UNKNOWN_METHOD');
  });
});
