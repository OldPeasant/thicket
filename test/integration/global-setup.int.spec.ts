import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StartedTestContainer } from 'testcontainers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestProject } from 'vitest/node';
import setup from './fixtures/global-setup.ts';
import {
  FIXTURE_NAMES,
  startFixture,
  type FixtureName,
  type FixtureSpec,
  type StartedFixture,
} from './fixtures/mongo.ts';

// Setup/teardown logic of the global setup with container starts replaced by fakes (no container
// needed). The real setup runs in Vitest's main process for every `npm run test:int`.

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), writeFile: vi.fn(actual.writeFile) };
});

vi.mock('./fixtures/mongo.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fixtures/mongo.ts')>();
  return { ...actual, startFixture: vi.fn() };
});

const startFixtureMock = vi.mocked(startFixture);

interface FakeFixture extends StartedFixture {
  stop: ReturnType<typeof vi.fn>;
}

/** A started fixture whose container only records `stop()` calls. */
function fakeFixture(name: FixtureName, stopError?: Error): FakeFixture {
  const stop = stopError
    ? vi.fn().mockRejectedValue(stopError)
    : vi.fn().mockResolvedValue(undefined);
  const container = {
    stop,
    getId: () => `fake-container-${name}`,
  } as unknown as StartedTestContainer;
  return {
    stop,
    container,
    info: {
      uri: `mongodb://localhost:1/?fixture=${name}`,
      host: 'localhost',
      port: 1,
      version: '8',
      tls: false,
    },
  };
}

/** Fake fixtures by name; `startFixture` resolves them in FIXTURE_NAMES order unless listed in `fail`. */
function fakeStarts(options: { fail?: FixtureName[]; stopFails?: FixtureName[] } = {}) {
  const fixtures = new Map<FixtureName, FakeFixture>();
  for (const name of FIXTURE_NAMES) {
    fixtures.set(
      name,
      fakeFixture(
        name,
        options.stopFails?.includes(name) ? new Error(`no such container (${name})`) : undefined,
      ),
    );
  }
  startFixtureMock.mockImplementation((spec: FixtureSpec) => {
    const index = startFixtureMock.mock.calls.findIndex((call) => call[0] === spec);
    const name = FIXTURE_NAMES[index] as FixtureName;
    if (options.fail?.includes(name))
      return Promise.reject(new Error(`image start failed (${name})`));
    return Promise.resolve(fixtures.get(name) as FakeFixture);
  });
  return fixtures;
}

function fakeProject() {
  const provided = new Map<string, unknown>();
  const project = {
    provide: vi.fn((key: string, value: unknown) => provided.set(key, value)),
  } as unknown as TestProject;
  return { project, provided };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function createdCertDir(): Promise<string> {
  const result = vi.mocked(mkdtemp).mock.results.at(-1);
  expect(result).toBeDefined();
  return (await result?.value) as string;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('integration global setup', () => {
  it('starts every fixture with one certificate set and provides their info and the CA file', async () => {
    const fixtures = fakeStarts();
    const { project, provided } = fakeProject();

    const teardown = await setup(project);
    try {
      expect(startFixtureMock).toHaveBeenCalledTimes(FIXTURE_NAMES.length);
      const certsArgs = new Set(startFixtureMock.mock.calls.map((call) => call[1]));
      expect(certsArgs.size).toBe(1);
      const [certs] = [...certsArgs];

      const mongo = provided.get('mongo') as Record<string, unknown>;
      expect(Object.keys(mongo).sort()).toEqual([...FIXTURE_NAMES].sort());
      for (const name of FIXTURE_NAMES) expect(mongo[name]).toEqual(fixtures.get(name)?.info);

      const caFile = provided.get('tlsCaFile') as string;
      expect(await readFile(caFile, 'utf8')).toBe(certs?.caCert);
      expect((await stat(caFile)).mode & 0o777).toBe(0o600);
    } finally {
      await teardown();
    }

    for (const fixture of fixtures.values()) expect(fixture.stop).toHaveBeenCalledTimes(1);
    expect(await exists(dirname(provided.get('tlsCaFile') as string))).toBe(false);
  });

  it('stops the started fixtures, removes the cert dir and names the failed ones when a start fails', async () => {
    const fixtures = fakeStarts({ fail: ['mongo8rs', 'mongo7tls'] });
    const { project } = fakeProject();

    const error = await setup(project).then(
      () => undefined,
      (err: unknown) => err as Error,
    );

    expect(error?.message).toMatch(/MongoDB fixtures failed to start/);
    expect(error?.message).toContain('mongo8rs: Error: image start failed (mongo8rs)');
    expect(error?.message).toContain('mongo7tls: Error: image start failed (mongo7tls)');
    expect(error?.message).not.toContain('mongo8:');
    for (const name of ['mongo8', 'mongo7', 'mongo8tls'] as const) {
      expect(fixtures.get(name)?.stop).toHaveBeenCalledTimes(1);
    }
    expect(fixtures.get('mongo8rs')?.stop).not.toHaveBeenCalled();
    expect(project.provide).not.toHaveBeenCalled();
    expect(await exists(await createdCertDir())).toBe(false);
  });

  it('warns with the fixture name and container id when a container fails to stop, and stops the rest', async () => {
    const fixtures = fakeStarts({ stopFails: ['mongo7'] });
    const { project, provided } = fakeProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const teardown = await setup(project);
    await expect(teardown()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('mongo7');
    expect(message).toContain('fake-container-mongo7');
    expect(message).toContain('no such container (mongo7)');
    for (const fixture of fixtures.values()) expect(fixture.stop).toHaveBeenCalledTimes(1);
    expect(await exists(dirname(provided.get('tlsCaFile') as string))).toBe(false);
  });

  it('removes the temp dir and starts no container when writing the CA file fails', async () => {
    fakeStarts();
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk full (fictitious)'));
    const { project } = fakeProject();

    await expect(setup(project)).rejects.toThrow('disk full (fictitious)');

    expect(startFixtureMock).not.toHaveBeenCalled();
    expect(project.provide).not.toHaveBeenCalled();
    expect(await exists(await createdCertDir())).toBe(false);
  });
});
