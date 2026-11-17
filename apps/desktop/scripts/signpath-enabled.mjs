// Decides whether the release workflow signs the Windows build with SignPath
// (.github/workflows/release.yml, docs/CODE_SIGNING.md). Signing runs only when both the
// SIGNPATH_API_TOKEN secret and the SIGNPATH_ORGANIZATION_ID variable are set; forks and
// repositories without the SignPath setup build unsigned, as before, and the log says so.
// Writes `enabled=true|false` to $GITHUB_OUTPUT (when set) and always exits 0.
// Run: SIGNPATH_API_TOKEN=… SIGNPATH_ORGANIZATION_ID=… node scripts/signpath-enabled.mjs
import { appendFileSync } from 'node:fs';

const env = process.env;
const missing = [
  ['SIGNPATH_API_TOKEN', 'secret'],
  ['SIGNPATH_ORGANIZATION_ID', 'variable'],
]
  .filter(([name]) => !(env[name] ?? '').trim())
  .map(([name, kind]) => `${name} (${kind})`);

const enabled = missing.length === 0;
if (enabled) {
  console.log('SignPath signing enabled: the Windows app and installer are signed.');
} else {
  // ::notice:: shows up in the run summary, so a skipped signing is visible without opening logs.
  console.log(
    `::notice title=Windows signing skipped::SignPath signing skipped, missing ${missing.join(' and ')}. ` +
      'The Windows artefacts are built unsigned (docs/CODE_SIGNING.md).',
  );
}
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `enabled=${enabled}\n`);
