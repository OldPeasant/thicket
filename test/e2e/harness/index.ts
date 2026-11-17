// Playwright e2e harness for the Electron app: import `test`/`expect` from here in test/e2e/**/*.e2e.ts.
export { appDir, launchApp, realUserDataDir, snapshotDir, type LaunchOptions } from './app';
export {
  expect,
  screenshotWindows,
  test,
  type E2EFixtures,
  type E2EWorkerFixtures,
} from './fixtures';
export {
  containerRuntimeUnavailable,
  startMongo,
  startMongoSpec,
  type E2EMongo,
  type FixtureName,
  type FixtureSpec,
} from './mongo';
