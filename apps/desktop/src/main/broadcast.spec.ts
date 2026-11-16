import { describe, expect, it, vi } from 'vitest';

import { Broadcaster } from './broadcast';

describe('Broadcaster', () => {
  it('sends data events to every added sink until it is removed', () => {
    const broadcaster = new Broadcaster();
    const a = vi.fn();
    const b = vi.fn();
    const removeA = broadcaster.add(a);
    broadcaster.add(b);
    broadcaster.emit('app.settings.changed', { settings: 1 });
    const event = { stream: 'app.settings.changed', kind: 'data', payload: { settings: 1 } };
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
    removeA();
    broadcaster.emit('x', null);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('a failing sink (closed port) is logged and does not stop the others', () => {
    const log = vi.fn();
    const broadcaster = new Broadcaster(log);
    const ok = vi.fn();
    broadcaster.add(() => {
      throw new Error('port closed');
    });
    broadcaster.add(ok);
    broadcaster.emit('s', 1);
    expect(ok).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('port closed'));
  });

  it('without a log, a failing sink is swallowed and emit does not throw', () => {
    const broadcaster = new Broadcaster();
    const ok = vi.fn();
    broadcaster.add(() => {
      throw new Error('port closed');
    });
    broadcaster.add(ok);
    expect(() => broadcaster.emit('s', 1)).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('emit with no renderers connected does nothing', () => {
    expect(() => new Broadcaster().emit('app.settings.changed', {})).not.toThrow();
  });
});
