/**
 * The renderer is not cross-origin isolated, so Chromium does not define `SharedArrayBuffer`.
 * `webidl-conversions` (loaded by `whatwg-url`, which `mongodb-connection-string-url` uses for
 * core's connection string parser) reads `SharedArrayBuffer.prototype`'s `byteLength` and
 * `growable` getters when it loads and throws a `ReferenceError` without them. It only uses them
 * to tell whether a value is a shared buffer, so a stand-in whose getters always throw (it never
 * is one) is enough. Constructing it throws, so code that tries to use shared memory still fails
 * as before; nothing in the renderer does.
 */
export function installSharedArrayBufferStub(target: typeof globalThis = globalThis): boolean {
  if (typeof target.SharedArrayBuffer !== 'undefined') return false;
  const unavailable = () =>
    new TypeError('SharedArrayBuffer is not available (the window is not cross-origin isolated)');
  class SharedArrayBufferUnavailable {
    constructor() {
      throw unavailable();
    }
    get byteLength(): number {
      throw unavailable();
    }
    get growable(): boolean {
      throw unavailable();
    }
  }
  Object.defineProperty(target, 'SharedArrayBuffer', {
    value: SharedArrayBufferUnavailable,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return true;
}

installSharedArrayBufferStub();
