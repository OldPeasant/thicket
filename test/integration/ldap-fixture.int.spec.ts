import { describe, expect, it } from 'vitest';

import { kernelBreaksMongo80, LdapFixtureUnsupportedError } from './fixtures/ldap.ts';

// The LDAP fixture's host check (task e2e-suite-red): mongo 8.0 images refuse to start on Linux
// 6.19.0-7.0.13 (SERVER-121912), so the fixture reports that host as unsupported instead of failing.

describe('kernelBreaksMongo80', () => {
  it.each([
    '6.19.0',
    '6.19.4-200.fc43.x86_64',
    '7.0.0',
    '7.0.9-200.fc44.x86_64',
    '7.0.13-100.fc44.x86_64',
  ])('%s is affected', (kernel) => {
    expect(kernelBreaksMongo80(kernel)).toBe(true);
  });

  it.each([
    '6.18.12-200.fc43.x86_64',
    '6.8.0-57-generic',
    '7.0.14-200.fc44.x86_64',
    '7.1.3-200.fc44.x86_64',
    '10.0.0',
  ])('%s is not affected', (kernel) => {
    expect(kernelBreaksMongo80(kernel)).toBe(false);
  });

  it('reads a release without a patch number as patch 0', () => {
    expect(kernelBreaksMongo80('6.19')).toBe(true);
    expect(kernelBreaksMongo80('6.18')).toBe(false);
  });

  it('ignores releases it cannot parse', () => {
    expect(kernelBreaksMongo80('')).toBe(false);
    expect(kernelBreaksMongo80('unknown')).toBe(false);
    expect(kernelBreaksMongo80('Darwin 24.1')).toBe(false);
  });
});

describe('LdapFixtureUnsupportedError', () => {
  it('is an Error with its own name', () => {
    const error = new LdapFixtureUnsupportedError('no');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LdapFixtureUnsupportedError');
    expect(error.message).toBe('no');
  });
});
