import { describe, expect, it } from 'vitest';

import { WORKSPACE } from './index';

describe('@thicket/desktop', () => {
  it('is wired into the test run', () => {
    expect(WORKSPACE).toBe('@thicket/desktop');
  });
});
