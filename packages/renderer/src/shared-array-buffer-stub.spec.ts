import { describe, expect, it } from 'vitest';

import { installSharedArrayBufferStub } from './shared-array-buffer-stub';

describe('installSharedArrayBufferStub', () => {
  it('leaves a real SharedArrayBuffer alone', () => {
    const target = { SharedArrayBuffer } as unknown as typeof globalThis;
    expect(installSharedArrayBufferStub(target)).toBe(false);
    expect(target.SharedArrayBuffer).toBe(SharedArrayBuffer);
  });

  it('without one, installs a stand-in whose getters and constructor throw', () => {
    const target = {} as typeof globalThis;
    expect(installSharedArrayBufferStub(target)).toBe(true);
    const Stub = target.SharedArrayBuffer;
    const byteLength = Object.getOwnPropertyDescriptor(Stub.prototype, 'byteLength')?.get;
    const growable = Object.getOwnPropertyDescriptor(Stub.prototype, 'growable')?.get;
    expect(byteLength).toBeTypeOf('function');
    // webidl-conversions' isSharedArrayBuffer(): the getter throws for anything else.
    expect(() => byteLength?.call(new ArrayBuffer(4))).toThrow(TypeError);
    expect(() => growable?.call(new ArrayBuffer(4))).toThrow(TypeError);
    expect(() => new Stub(4)).toThrow(/not available/);
  });
});
