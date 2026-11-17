import { release } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LdapFixtureUnsupportedError,
  MONGO_ENTERPRISE_IMAGE,
  OPENLDAP_IMAGE,
  startLdapFixture,
} from './fixtures/ldap.ts';

// How startLdapFixture() reports a container that did not start (task e2e-suite-red): only a failed
// Enterprise 8.0 start on a Linux kernel it refuses (SERVER-121912) becomes
// LdapFixtureUnsupportedError; everything else stays the original error. No container runtime is
// used: testcontainers and the kernel release are replaced by fakes.

/** What each image's `start()` does in the current test: an Error rejects, anything else starts. */
const outcome = vi.hoisted(() => ({
  byImage: new Map<string, Error | undefined>(),
  started: [] as { image: string; stop: ReturnType<typeof vi.fn> }[],
  networkStop: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, release: vi.fn(actual.release) };
});

vi.mock('testcontainers', () => {
  class GenericContainer {
    constructor(private readonly image: string) {}
    withNetwork() {
      return this;
    }
    withNetworkAliases() {
      return this;
    }
    withEnvironment() {
      return this;
    }
    withExposedPorts() {
      return this;
    }
    withCommand() {
      return this;
    }
    withWaitStrategy() {
      return this;
    }
    withStartupTimeout() {
      return this;
    }
    start() {
      const error = outcome.byImage.get(this.image);
      if (error) return Promise.reject(error);
      const container = { image: this.image, stop: vi.fn().mockResolvedValue(undefined) };
      outcome.started.push(container);
      return Promise.resolve(container);
    }
  }
  class Network {
    start() {
      return Promise.resolve({ stop: outcome.networkStop });
    }
  }
  const Wait = { forLogMessage: () => ({}) };
  return { GenericContainer, Network, Wait };
});

const AFFECTED_KERNEL = '7.0.9-200.fc44.x86_64';
const FIXED_KERNEL = '7.1.3-200.fc44.x86_64';

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function kernel(value: string): void {
  vi.mocked(release).mockReturnValue(value);
}

function fail(image: string, message: string): Error {
  const error = new Error(message);
  outcome.byImage.set(image, error);
  return error;
}

beforeEach(() => {
  outcome.byImage.clear();
  outcome.started.length = 0;
  outcome.networkStop.mockReset().mockResolvedValue(undefined);
  onPlatform('linux');
});

afterEach(() => {
  onPlatform(realPlatform);
  vi.mocked(release).mockReset();
});

describe('startLdapFixture when a container does not start', () => {
  it('reports an Enterprise start failure on an affected Linux kernel as unsupported', async () => {
    kernel(AFFECTED_KERNEL);
    fail(MONGO_ENTERPRISE_IMAGE, 'Container exited before "Waiting for connections" (fictitious)');

    const error: unknown = await startLdapFixture().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(LdapFixtureUnsupportedError);
    const message = (error as Error).message;
    expect(message).toContain(MONGO_ENTERPRISE_IMAGE);
    expect(message).toContain(`Linux ${AFFECTED_KERNEL}`);
    expect(message).toContain('SERVER-121912');
    // The original start error stays visible in the reason.
    expect(message).toContain('Waiting for connections');
    // The LDAP container that did start and the network are stopped again.
    expect(outcome.started.map((c) => c.image)).toEqual([OPENLDAP_IMAGE]);
    expect(outcome.started[0]?.stop).toHaveBeenCalledTimes(1);
    expect(outcome.networkStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error on a Linux kernel outside the affected range', async () => {
    kernel(FIXED_KERNEL);
    const original = fail(MONGO_ENTERPRISE_IMAGE, 'pull failed (fictitious)');

    await expect(startLdapFixture()).rejects.toBe(original);
    expect(outcome.started[0]?.stop).toHaveBeenCalledTimes(1);
    expect(outcome.networkStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error off Linux, whatever the release says', async () => {
    onPlatform('darwin');
    kernel('7.0.0');
    const original = fail(MONGO_ENTERPRISE_IMAGE, 'VM not running (fictitious)');

    await expect(startLdapFixture()).rejects.toBe(original);
  });

  it('keeps the OpenLDAP error when only OpenLDAP failed, also on an affected kernel', async () => {
    kernel(AFFECTED_KERNEL);
    const original = fail(OPENLDAP_IMAGE, 'slapd never started (fictitious)');

    await expect(startLdapFixture()).rejects.toBe(original);
    // The Enterprise container that did start is stopped again.
    expect(outcome.started.map((c) => c.image)).toEqual([MONGO_ENTERPRISE_IMAGE]);
    expect(outcome.started[0]?.stop).toHaveBeenCalledTimes(1);
    expect(outcome.networkStop).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported when both failed on an affected kernel', async () => {
    kernel(AFFECTED_KERNEL);
    fail(OPENLDAP_IMAGE, 'slapd never started (fictitious)');
    fail(MONGO_ENTERPRISE_IMAGE, 'exited (fictitious)');

    await expect(startLdapFixture()).rejects.toBeInstanceOf(LdapFixtureUnsupportedError);
    expect(outcome.networkStop).toHaveBeenCalledTimes(1);
  });

  it('reports the OpenLDAP error first when both failed on an unaffected kernel', async () => {
    kernel(FIXED_KERNEL);
    const ldapError = fail(OPENLDAP_IMAGE, 'slapd never started (fictitious)');
    fail(MONGO_ENTERPRISE_IMAGE, 'exited (fictitious)');

    await expect(startLdapFixture()).rejects.toBe(ldapError);
  });
});
