# Code Review

Date: 2026-11-16

Task: renderer-scaffold (M0: Angular renderer workspace)

Scope: `git diff 177498f..HEAD -- . ':!tasks' ':!reviews'` (committed changes only; package-lock.json checked for unintended version changes only)

Requirements:
- tasks/renderer-scaffold.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md (section 6 security: strict CSP, no remote content; section 7 testing)
- docs/ARCHITECTURE.md (stack, renderer CSP, commands, coverage)
- AGENTS.md, docs/QUALITY.md, parent agent instructions

Git range:
- Branch: main
- HEAD: fabb8cf
- Base/start: 177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f
- Commits reviewed: 2 (9bd783c, fabb8cf)

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Root `engines` allows Node versions the new Angular toolchain rejects**
    - File: `package.json:9`
    - Category: Integration
    - Problem: The root declares `"node": ">=24 <25"`, but the dependencies added by this task require a newer Node 24: `@angular/build` 22.2.7 and `@angular/core` need `^24.15.0` (or ^22.22.3 / >=26), and `jsdom` 31 needs `^24.15.0`. Node 24.0 to 24.14 meet the root `engines` range but not the toolchain's.
    - Why it matters: A developer or CI image on an early Node 24 passes the root engines check, then fails or gets engine warnings in `ng build` / `ng test`. The ARCHITECTURE install table only says "Node 24".
    - Suggested fix: Raise the root range to `>=24.15.0 <25` and say "Node 24.15+" in the install section of docs/ARCHITECTURE.md.

- [ ] **CR-2 | The no-network guard misses Angular property bindings and `srcset`**
    - File: `packages/renderer/src/no-network.spec.ts:17`
    - Category: Tests
    - Problem: `REMOTE` allows only one optional quote after `src=`/`href=`. It does not match `[src]="'https://cdn.x/a.png'"` (an Angular binding with a quoted string literal) or `srcset="https://..."`, because `\b(?:src|href)\s*=` does not match `srcset=`. I checked both with node: the regex returns `false` for each, and `true` for `<link href="https://...">` and `@import url("https://...")`.
    - Why it matters: Criterion 4 relies on this spec as its regression guard. Component templates will soon contain `[src]`-style bindings. The runtime CSP (`default-src 'self'`, `img-src 'self' data:`) still blocks such loads, so this is a gap in the test, not a security hole.
    - Suggested fix: Allow an optional double quote followed by an optional single quote after `=` (for example `=\s*["']?'?`), and match `srcset` too (`src(?:set)?`). Add one positive fixture assertion for each new pattern so the regex itself is tested.

## Notes (not findings)

- Verified: `npm run check` passes (lint, `ngc` with strictTemplates plus `tsc` for specs, root `vitest run` with 4 files, then `ng test` with 2 files and 8 tests). The run used the working tree, which at review time held uncommitted test-writer edits (`app.spec.ts`, `no-network.spec.ts`, untracked `zz-probe.*`). Those edits are outside this review's scope. Make sure the untracked probe files are not committed.
- File:// suitability (structural check): `dist/index.html` sits at the top of `dist/` (`outputPath.browser: ""`), has `<base href="./">` and references `styles-*.css` and `main-*.js` with relative URLs. The build has no external URLs, and font inlining is off (`optimization.fonts: false`), so the build does not fetch Google Fonts. Nobody has loaded the build in Electron (assumption #2). When recording criterion 1, the parent should state that only the structure was checked, or record the Electron load as skipped with a reason. It should not claim a runtime file:// load.
- Criterion 2 (`ng serve`): I could not check it here without curl or a browser. Its evidence must come from an actual run.
- `&&` in the root `test` script works in cmd.exe, PowerShell npm shims and sh, so it is portable. There is no CI workflow in the repository yet.
- The CSP matches SPEC section 6 and ARCHITECTURE ("default-src 'self'; script-src 'self'" plus the inline styles Angular needs). There is no `unsafe-eval` and no remote sources.
- The lockfile diff only reorders the existing tool entries (eslint, prettier, vitest coverage, @types/node keep their versions) and adds the Angular dependency tree.

## Review conclusion

No material issues found. The two P3 findings are optional cleanup.
