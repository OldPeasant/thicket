import type { Event } from '@thicket/contract';

export type EventSink = (event: Event) => void;

/**
 * Pushes broadcast events (`BROADCAST_STREAMS`) from main to every connected renderer. Each window
 * registers its main port's sender while it is connected.
 */
export class Broadcaster {
  private readonly sinks = new Set<EventSink>();

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  /** Adds a renderer; returns a function that removes it. */
  add(sink: EventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  /** Sends a `data` event on `stream` to every renderer. */
  emit(stream: string, payload: unknown): void {
    const event: Event = { stream, kind: 'data', payload };
    for (const sink of [...this.sinks]) {
      try {
        sink(event);
      } catch (error) {
        this.log(`broadcast of ${stream} failed: ${String(error)}`);
      }
    }
  }
}
