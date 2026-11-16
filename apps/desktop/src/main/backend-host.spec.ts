import type { BackendControlMessage } from '@thicket/backend';
import type { BackendRestarted } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { BackendHost, type BackendProcess } from './backend-host';

interface FakePort {
  name: string;
  closed: boolean;
}

class FakeProcess implements BackendProcess<FakePort> {
  readonly messages: { message: BackendControlMessage; ports: FakePort[] }[] = [];
  killed = false;
  private exitListener: ((code: number) => void) | undefined;
  constructor(readonly pid: number) {}
  postMessage(message: BackendControlMessage, transfer: FakePort[]) {
    this.messages.push({ message, ports: transfer });
  }
  on(_event: 'exit', listener: (code: number) => void) {
    this.exitListener = listener;
    return this;
  }
  kill() {
    this.killed = true;
    return true;
  }
  exit(code: number) {
    this.exitListener?.(code);
  }
}

function setup(overrides: { now?: () => number } = {}) {
  const processes: FakeProcess[] = [];
  let channel = 0;
  const timers: { fn: () => void; ms: number }[] = [];
  const privileged = vi.fn<(port: FakePort) => () => void>(() => vi.fn());
  const host = new BackendHost<FakePort>({
    fork: () => {
      const p = new FakeProcess(1000 + processes.length);
      processes.push(p);
      return p;
    },
    createChannel: () => {
      channel += 1;
      return {
        port1: { name: `c${channel}.1`, closed: false },
        port2: { name: `c${channel}.2`, closed: false },
      };
    },
    servePrivileged: privileged,
    closePort: (port) => {
      port.closed = true;
    },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    now: overrides.now ?? (() => 0),
  });
  return { host, processes, privileged, timers };
}

describe('BackendHost', () => {
  it('starts the backend with a privileged port served by main', () => {
    const { host, processes, privileged } = setup();
    host.start();
    host.start(); // idempotent
    expect(processes).toHaveLength(1);
    expect(host.pid).toBe(1000);
    expect(processes[0]?.messages).toEqual([
      { message: { type: 'privileged' }, ports: [{ name: 'c1.2', closed: false }] },
    ]);
    expect(privileged).toHaveBeenCalledWith({ name: 'c1.1', closed: false });
  });

  it('gives each renderer its own port; the privileged one never goes to a renderer', () => {
    const { host, processes } = setup();
    const received: FakePort[] = [];
    host.connectRenderer((port) => received.push(port)); // before start: waits
    expect(received).toEqual([]);
    host.start();
    host.connectRenderer((port) => received.push(port));
    expect(received.map((p) => p.name)).toEqual(['c2.1', 'c3.1']);
    const toBackend = processes[0]?.messages.map((m) => [m.message, m.ports[0]?.name]);
    expect(toBackend).toEqual([
      [{ type: 'privileged' }, 'c1.2'],
      [{ type: 'renderer', window: 1 }, 'c2.2'],
      [{ type: 'renderer', window: 2 }, 'c3.2'],
    ]);
  });

  it('restarts a backend that died and hands renderers fresh ports with the restart info', () => {
    const { host, processes, privileged } = setup();
    host.start();
    const deliveries: [string, BackendRestarted | undefined][] = [];
    const disconnect = host.connectRenderer((port, restarted) =>
      deliveries.push([port.name, restarted]),
    );
    const stopFirstPrivileged = privileged.mock.results[0]?.value as () => void;

    processes[0]?.exit(9);

    expect(processes).toHaveLength(2);
    expect(host.pid).toBe(1001);
    expect(host.restartCount).toBe(1);
    expect(stopFirstPrivileged).toHaveBeenCalled();
    expect(privileged).toHaveBeenCalledTimes(2);
    expect(deliveries).toEqual([
      ['c2.1', undefined],
      ['c4.1', { restarts: 1, reason: 'backend process exited with code 9' }],
    ]);

    disconnect();
    processes[1]?.exit(1);
    expect(deliveries).toHaveLength(2);
  });

  it('backs off when the backend keeps crashing right after start', () => {
    let now = 0;
    const { host, processes, timers } = setup({ now: () => now });
    host.start();
    processes[0]?.exit(1); // first quick crash: immediate
    expect(processes).toHaveLength(2);
    processes[1]?.exit(1); // second: waits
    expect(processes).toHaveLength(2);
    expect(timers.map((t) => t.ms)).toEqual([250]);
    timers[0]?.fn();
    expect(processes).toHaveLength(3);
    processes[2]?.exit(1);
    expect(timers.map((t) => t.ms)).toEqual([250, 500]);
    timers[1]?.fn();
    now = 60_000; // lived long: counts as stable again
    processes[3]?.exit(1);
    expect(processes).toHaveLength(5);
  });

  it('caps the back-off', () => {
    const { host, processes, timers } = setup();
    host.start();
    for (let i = 0; i < 12; i++) {
      processes.at(-1)?.exit(1);
      timers.at(-1)?.fn();
    }
    expect(Math.max(...timers.map((t) => t.ms))).toBe(10_000);
  });

  it('does not restart after stop(), and ignores exits of replaced processes', () => {
    const { host, processes, timers } = setup();
    host.start();
    processes[0]?.exit(1);
    processes[0]?.exit(1); // stale process
    expect(processes).toHaveLength(2);
    host.stop();
    expect(processes[1]?.killed).toBe(true);
    processes[1]?.exit(0);
    expect(processes).toHaveLength(2);
    expect(timers).toEqual([]);
    host.start();
    expect(processes).toHaveLength(2);
  });

  it('a stop() during a back-off wait cancels the restart', () => {
    const { host, processes, timers } = setup();
    host.start();
    processes[0]?.exit(1);
    processes[1]?.exit(1);
    host.stop();
    timers[0]?.fn();
    expect(processes).toHaveLength(2);
  });
});
