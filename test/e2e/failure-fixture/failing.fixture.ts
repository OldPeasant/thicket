import { expect, test } from '../harness';

// Run only by harness-helpers.e2e.ts (via ./playwright.config.ts): the first test fails on purpose.

test('fails on purpose after the window opened', async ({ window }) => {
  await expect(window).toHaveTitle('Thicket');
  expect('deliberate failure', 'this test fails on purpose').toBe('a passing value');
});

test('passes without a screenshot', async ({ window }) => {
  await expect(window).toHaveTitle('Thicket');
});
