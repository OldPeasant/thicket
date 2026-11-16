import { parseResult, parseResultIn, privilegedMethods } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

import { mainHandlers, privilegedHandlers } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

describe('main handlers', () => {
  it('app.ping answers with the process and version', () => {
    const result: unknown = mainHandlers({ version: '1.2.3' })['app.ping']?.({} as never, ctx);
    expect(result).toEqual({ process: 'main', version: '1.2.3' });
    expect(parseResult('app.ping', result).ok).toBe(true);
  });

  it('the privileged handlers answer within their contract (secrets stub: none stored)', () => {
    const handlers = privilegedHandlers();
    const ping: unknown = handlers['main.ping']?.({} as never, ctx);
    const secrets: unknown = handlers['secrets.get']?.({ profileId: 'p' } as never, ctx);
    expect(parseResultIn(privilegedMethods, 'main.ping', ping).ok).toBe(true);
    expect(secrets).toEqual({ secrets: null });
    expect(parseResultIn(privilegedMethods, 'secrets.get', secrets).ok).toBe(true);
  });
});
