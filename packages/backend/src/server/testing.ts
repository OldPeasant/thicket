import type { Port } from './rpc';

/** Two entangled in-memory `Port`s that deliver asynchronously, like a MessageChannel (tests). */
export function portPair(): [Port & { sent: unknown[] }, Port & { sent: unknown[] }] {
  const make = () => {
    const listeners = new Set<(message: unknown) => void>();
    const sent: unknown[] = [];
    let closed = false;
    let peer: { deliver: (message: unknown) => void } | undefined;
    const port = {
      sent,
      send(message: unknown) {
        if (closed) return;
        sent.push(message);
        const copy = structuredClone(message);
        setTimeout(() => peer?.deliver(copy), 0);
      },
      onMessage(listener: (message: unknown) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      close() {
        closed = true;
      },
      deliver(message: unknown) {
        if (closed) return;
        for (const listener of [...listeners]) listener(message);
      },
      connect(other: { deliver: (message: unknown) => void }) {
        peer = other;
      },
    };
    return port;
  };
  const a = make();
  const b = make();
  a.connect(b);
  b.connect(a);
  return [a, b];
}
