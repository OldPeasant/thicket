import { ERROR_CODES } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import { ApiError, describeError, ERROR_MESSAGES } from './api-error';

describe('ERROR_MESSAGES', () => {
  it.each(ERROR_CODES)('has a readable message for %s', (code) => {
    const message = ERROR_MESSAGES[code];
    expect(message).toEqual(expect.any(String));
    expect(message.trim().length).toBeGreaterThan(10);
    expect(message).not.toContain(code);
  });

  it('has no messages for codes outside the contract', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('uses a different message for every code', () => {
    expect(new Set(Object.values(ERROR_MESSAGES)).size).toBe(ERROR_CODES.length);
  });
});

describe('ApiError', () => {
  it('keeps code, message and detail and explains the code', () => {
    const error = new ApiError({
      code: 'READ_ONLY',
      message: 'profile p1 is read-only',
      detail: 1,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.code).toBe('READ_ONLY');
    expect(error.message).toBe('profile p1 is read-only');
    expect(error.detail).toBe(1);
    expect(error.explanation).toBe(ERROR_MESSAGES.READ_ONLY);
  });

  it('from() returns ApiErrors unchanged and wraps ErrorInfo', () => {
    const error = new ApiError({ code: 'TIMEOUT', message: 't' });
    expect(ApiError.from(error)).toBe(error);
    expect(ApiError.from({ code: 'NOT_FOUND', message: 'gone' })).toMatchObject({
      code: 'NOT_FOUND',
      message: 'gone',
    });
  });

  it.each([
    ['an unknown code', { code: 'NOPE', message: 'x' }],
    ['a missing message', { code: 'TIMEOUT' }],
    ['null', null],
    ['a string', 'boom'],
  ])('from() turns %s into INTERNAL', (_what, value) => {
    const error = ApiError.from(value);
    expect(error.code).toBe('INTERNAL');
    expect(error.detail).toBe(value);
  });

  it('from() keeps the message of a plain Error', () => {
    expect(ApiError.from(new Error('port closed'))).toMatchObject({
      code: 'INTERNAL',
      message: 'port closed',
    });
  });
});

describe('describeError', () => {
  it('shows the explanation followed by the backend message', () => {
    expect(
      describeError({ code: 'AUTH_FAILED', message: 'bad auth : authentication failed' }),
    ).toBe(`${ERROR_MESSAGES.AUTH_FAILED}\nbad auth : authentication failed`);
  });

  it('shows only the explanation when the message is empty or the same', () => {
    expect(describeError({ code: 'CANCELLED', message: '  ' })).toBe(ERROR_MESSAGES.CANCELLED);
    expect(describeError({ code: 'CANCELLED', message: ERROR_MESSAGES.CANCELLED })).toBe(
      ERROR_MESSAGES.CANCELLED,
    );
  });

  it('describes a plain Error as INTERNAL followed by its message', () => {
    expect(describeError(new Error('port closed'))).toBe(`${ERROR_MESSAGES.INTERNAL}\nport closed`);
  });

  it('describes an ApiError by its code', () => {
    const error = new ApiError({ code: 'SSH_ERROR', message: 'connect ECONNREFUSED' });
    expect(describeError(error)).toBe(`${ERROR_MESSAGES.SSH_ERROR}\nconnect ECONNREFUSED`);
  });

  it.each(ERROR_CODES)('describes %s with its readable message', (code) => {
    expect(describeError({ code, message: '' })).toBe(ERROR_MESSAGES[code]);
  });

  it('describes anything else as INTERNAL', () => {
    expect(describeError(undefined)).toContain(ERROR_MESSAGES.INTERNAL);
  });
});
