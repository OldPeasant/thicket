# Code Review

Date: 2026-11-16

Task: renderer-scaffold (M0: Angular renderer workspace)

Scope: final review pass at 044a8e7. This pass reviews `git diff 7758345 044a8e7 -- packages/renderer`, which changes only `packages/renderer/src/no-network.spec.ts`. The task code up to 7758345 (`git diff 177498f..7758345`, excluding `tasks/` and `reviews/`) was reviewed in the previous pass with no findings, and its conclusions are kept below. The working tree was clean during this pass.

Requirements:
- tasks/renderer-scaffold.md acceptance criteria and recorded assumptions
- SPEC.md (section 6 security: strict CSP, no remote content; section 7 testing)
- docs/ARCHITECTURE.md (stack, renderer, install, coverage)
- AGENTS.md, docs/QUALITY.md, parent agent instructions
- Earlier findings CR-1 and CR-2 and reviews/renderer-scaffold/fixes.md

Git range:
- Branch: main
- HEAD: 044a8e74081d36b92138e9f88edfa725ede8a429
- Base/start: 177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f (task base). The delta in this pass starts at 775834532a404883faa46707bea88318bd04c7c5.
- Commits reviewed: 5 task commits (7b0d988, b52fc6e, 36fd6cc, 7758345, 044a8e7). The range also holds claim/heartbeat commits and a2604f3 (`.claude/settings.json` denies ScheduleWakeup). a2604f3 is TFP infrastructure, not part of this task, and was not reviewed as task code.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Delta review (7758345 -> 044a8e7)

- `packages/renderer/src/no-network.spec.ts:20-21`: `REMOTE` now allows an optional `ng` prefix on `src`/`href` and on `srcset`. Under the `i` flag this matches `ngSrc`, `[ngSrc]` and `ngSrcset`. The prefix is needed: `\bsrc` cannot match inside `ngSrc` because there is no word boundary between `g` and `S`. For `ngSrcset=`, the `src` alternative fails because `set` follows `Src`, and the `srcset` alternative matches it. I traced the regex by hand. `ngHref` also matches now, which is harmless because no such attribute exists. The other alternatives did not change, so earlier positive and negative fixtures keep their meaning.
- New positive fixtures: a single-quoted protocol-relative `srcset` in a later candidate, `ngSrc`, a `[ngSrc]` binding, and `ngSrcset`. New negative fixtures: a `[srcset]` binding to a field, and a local `ngSrc` with a width-only `ngSrcset` (`"100w, 200w"`). In the negative `ngSrcset` case the candidate group can cross the comma, but `//` never follows, so the case is correctly not flagged. No existing fixture was removed or weakened.
- The real source scan still passes with the wider pattern, so it adds no false positives in the current renderer sources.
- Only a test file changed. No production code, configuration or dependency changed in this delta.

## Verification of earlier findings

- CR-1 (root `engines` too loose): still fixed. `package.json` requires `"node": ">=24.15.0 <25"`, and the lockfile root entry and docs/ARCHITECTURE.md agree.
- CR-2 (no-network guard misses bindings and `srcset`): still fixed. 044a8e7 extends the guard further, to NgOptimizedImage attributes.

## Validation run in this pass

- `npm run check` at 044a8e7, clean working tree -> lint, typecheck (backend, renderer `ngc` + spec `tsc`) and tests all passed. Root Vitest: 4 files, 4 tests passed. Renderer `ng test`: 2 files, 46 tests passed.

## Notes (not findings)

- Criterion 1 (file://): as in the earlier reviews, only the build structure has been verified, not an Electron load (assumption #2). Record the evidence that way.
- Criterion 2 (`ng serve`): the evidence must come from an actual run of `npm run dev -w packages/renderer`. This review did not run it.
- docs/ARCHITECTURE.md lists fewer patterns than the no-network spec now covers (`srcset`, bindings, `ngSrc`/`ngSrcset`). It lists fewer cases but says nothing wrong, so this is not a finding.

## Review conclusion

No material issues found.
