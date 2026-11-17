import { describe, expect, it } from 'vitest';

import * as backend from './index';
import { WORKSPACE } from './index';

describe('@thicket/backend', () => {
  it('is wired into the test run', () => {
    expect(WORKSPACE).toBe('@thicket/backend');
  });

  it('exports the shell, ssh, indexes and server APIs side by side from the package entry', () => {
    // shell (task shell-backend)
    expect(typeof backend.ShellHost).toBe('function');
    expect(typeof backend.shellHandlers).toBe('function');
    expect(typeof backend.splitShellInput).toBe('function');
    expect(typeof backend.isExitCommand).toBe('function');
    expect(typeof backend.toEjson).toBe('function');
    expect(typeof backend.RESTARTED_TEXT).toBe('string');
    // neighbours merged in the same export list
    expect(typeof backend.sshHandlers).toBe('function');
    expect(typeof backend.KnownHosts).toBe('function');
    expect(typeof backend.indexHandlers).toBe('function');
    expect(typeof backend.startBackend).toBe('function');
    expect(typeof backend.ConnectionManager).toBe('function');
  });
});
