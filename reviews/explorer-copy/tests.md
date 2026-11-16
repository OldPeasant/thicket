# Test Report

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: second test-writer pass, after the fixer commit. Task base `39ea176382bee26068b872b47c53d8887193a9f4` (`git merge-base HEAD origin/main` after the rebase onto the latest main), measured HEAD `97efff0037315ea1d8afb9690a1aa655499b0d81` (`main`). Task-owned commits, as given by the parent and matched against `git log 39ea176..HEAD` (no other commits are in the range): `a712f50` (Move the vendored JSON Canopy explorer into the renderer), `57ea9a8` (Make the copied explorer pass the strict lint, type check and specs), `f503711` (Add the #/dev/explorer route...), `1d8a453` (Add tests for the copied explorer's strict-mode rewrites and JSON Lines view), `97efff0` (Ship the Tron fonts as files within the CSP, fix NOTICE and mergeTwo own-property check). The first report described the pre-rebase hashes `5c13e8ab` (base) and `754fd20`/`06b52ad`/`073258c`, which correspond to `a712f50`/`57ea9a8`/`f503711`. This pass focuses on the fixer's changes in `97efff0`: the font files and the CSP, the NOTICE content, and mergeTwo's own-property and `__proto__` behaviour. Uncommitted at measurement: the 3 spec files listed below and this report. This test-writer changed no production file.

Requirements:
- `tasks/explorer-copy.md` acceptance criteria (AC1-AC4) and the recorded assumptions
- `reviews/explorer-copy/review.md` (CR-1 to CR-4) and `reviews/explorer-copy/fixes.md`
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"; the renderer CSP (`font-src 'self'`, pinned by `src/no-network.spec.ts`)
- JSON Schema semantics: `properties` declares only the names it lists, and other keys fall through to `patternProperties`/`additionalProperties`. This is the standard the new failing tests rely on (see Bugs found).
- Apache-2.0 section 4 (attribution kept, modified files marked as modified), as already used by CR-3

## Test files changed

- `packages/renderer/src/styles.spec.ts` (new, untracked). It was started by an interrupted earlier pass, then reviewed and kept unchanged.
- `packages/renderer/src/notice.spec.ts` (new, untracked)
- `packages/renderer/src/app/schema/schema-model.variants.spec.ts` (modified, uncommitted: 5 cases from the interrupted pass were reviewed and kept, and 5 cases were added in this pass)

No existing test was weakened, skipped or deleted.

## Tests added or updated

Count: 20 new test cases (renderer suite now 27 files, 432 tests).

- `styles.spec.ts` (4), CR-1 fonts: no `data:` URL or `;base64,` payload in `styles.css`. Exactly the two families Orbitron and Share Tech Mono, each with `src: url('./assets/fonts/...woff2') format('woff2')` (`orbitron.woff2`, `share-tech-mono.woff2`). Every `url()` is relative, stays inside `src/`, exists, is larger than 1000 bytes and starts with the WOFF2 signature `wOF2`. The `--font-*` tokens use both families.
- `notice.spec.ts` (6), AC3/CR-3: the NOTICE names JSON Canopy, `Copyright 2026 Sonensei.ch`, `Apache License, Version 2.0` and `JSON explorer (packages/renderer/src/app/explorer)`. The header starts with `Thicket` and claims no copyright of its own. The NOTICE says the files were modified (host bridge removed, fonts extracted) and keeps the original JSON Canopy NOTICE text. The fonts are listed under SIL OFL 1.1 without the stale "inlined in" wording. Every `packages/...` path in NOTICE exists, and there is no `vendor/` or `json-master-plugin` reference.
- `schema-model.variants.spec.ts`, mergeTwo (CR-4/TW-1) (6, all pass):
  - An inherited name (`hasOwnProperty`, `valueOf`) declared only by the second part stays unwrapped and keeps its key order.
  - `toString` declared by both parts is combined into `allOf` and resolves to the merged constraints.
  - `__proto__` in the first part only and in both parts stays an own data key. The prototype stays `Object.prototype` and nothing leaks onto `Object.prototype`.
  - `patternProperties` follow the same rules.
  - The input parts are not mutated.
  - `typesAt(['__proto__'])` works for a `__proto__` property merged from allOf parts.
- `schema-model.variants.spec.ts`, "document keys named like Object.prototype members" (4, **fail**, see TW-2):
  - `typesAt` for undeclared `constructor`/`toString` follows `additionalProperties`/`patternProperties`.
  - `permitsKey` refuses `constructor` under `additionalProperties: false`.
  - `seed` does not invent a required but undeclared `toString`.
  - `seed` of a required, declared `__proto__` creates an own key and leaves the prototype unchanged.

  Each test first checks an ordinary key (`zzz`, `valueof`, `a`), and those checks pass. Only the inherited-name checks fail.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: All copied specs pass in `npm run check` | All renderer specs (27 files) and the root Vitest projects (14 files) | `npm run check` (repo root) | Fail. Lint (eslint + `prettier --check`) and typecheck pass. Root vitest: 14 files, 1051 tests pass. Renderer: 26 files pass, 1 fails; 428 tests pass, 4 fail. All copied JSON Canopy specs pass. The 4 failures are the new TW-2 tests in `schema-model.variants.spec.ts`. |
| AC2: Dev route renders the demo document; tables/form toggle, search (strict/context), collapse, edit (component test) | Existing `dev/explorer-demo.spec.ts`, `app.spec.ts`, unchanged in this pass | `npm run check` (renderer `ng test`, jsdom) | Pass (component test; no Playwright e2e was run by this test-writer) |
| AC3: Root NOTICE lists JSON Canopy (Apache-2.0, Sonensei.ch) as origin of the explorer code | `notice.spec.ts` (6 tests) | `npx ng test --include='src/notice.spec.ts'` (in `packages/renderer`); also in `npm run check` | Pass |
| AC4: `vendor/` deleted; no reference to it or `../json-master-plugin` outside tasks/ and reviews/ | `notice.spec.ts` "refers only to repository paths that exist" (NOTICE only); the earlier grep is unchanged by `97efff0` | `npm run check`; `git diff --name-only --diff-filter=D 39ea176..HEAD` lists only `vendor/` deletions | Pass (NOTICE part); the repo-wide grep was not repeated in this pass because `97efff0` adds no vendor paths |
| CR-1: fonts load within the CSP `font-src 'self'` | `styles.spec.ts` (4); existing `no-network.spec.ts` (CSP pin) | `npx ng test --include='src/styles.spec.ts'`; `npm run build -w packages/renderer` | Pass. Build check: `dist/media/orbitron-D5C4P7FB.woff2` and `dist/media/share-tech-mono-XX4T45LZ.woff2` are emitted. `dist/styles-*.css` contains only `url("./media/orbitron-D5C4P7FB.woff2")` and `url("./media/share-tech-mono-XX4T45LZ.woff2")` and 0 `data:` occurrences. `dist/index.html` keeps `font-src 'self'` and `<base href="./"/>`. No browser was used, so the actual font rendering under the CSP is Not run. |
| CR-4 / TW-1: mergeTwo treats inherited names and `__proto__` as plain property names | Fixer's 2 tests in `schema-model.spec.ts` and 6 tests in `schema-model.variants.spec.ts` (above) | `npx ng test --include='src/app/schema/schema-model.spec.ts' --include='src/app/schema/schema-model.variants.spec.ts'` | Pass |
| Inherited names in document lookups (JSON Schema `properties` semantics; same defect class as CR-4, outside mergeTwo) | 4 tests in "document keys named like Object.prototype members" | same command | **Fail**: TW-2 |

## Focused test execution

Command (in `packages/renderer`):

`npx ng test --include='src/notice.spec.ts' --include='src/styles.spec.ts' --include='src/app/schema/schema-model.variants.spec.ts' --include='src/app/schema/schema-model.spec.ts'`

Result:

Fail: 4 files, 62 tests; 58 pass, 4 fail (all TW-2). Two of my own assertions were wrong and were corrected before this run:
- `typesAt` reports `integer` as `number` by design (`schema-model.ts:332`).
- The NOTICE copyright check wrongly matched JSON Canopy's own `Copyright 2026 Sonensei.ch, ...` line. It now checks only the header before the origin paragraph.

## Full test execution

Command:

`npm run check` (repo root)

Result:

Fail (nonzero exit, from the renderer test step only). Lint and `prettier --check` are clean, typecheck (all workspaces) is clean, and root `vitest run` passes with 14 files and 1051 tests. Renderer `ng test`: 27 files, 432 tests; 428 pass, 4 fail (TW-2). Without the 4 TW-2 tests the suite is green: the coverage run below excludes exactly those 4 with `--filter`, and 428 pass with 4 skipped.

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check` because `package.json` exists. It will pass once TW-2 is fixed in production code. Do not skip or delete the 4 tests to make it pass.

## Bugs found

### Inherited Object names in documents resolve to Object.prototype members instead of the schema

Finding ID:

`TW-2`

Test:

`packages/renderer/src/app/schema/schema-model.variants.spec.ts`, describe "document keys named like Object.prototype members":
- `types an undeclared inherited name by additionalProperties and patternProperties`
- `refuses an undeclared inherited name when additionalProperties is false`
- `does not seed a required inherited name that properties does not declare`
- `seeds a required __proto__ property as an own key without changing the prototype`

Production source:

`packages/renderer/src/app/schema/schema-model.ts`:
- `:519` `ownChild`: `const declared = s.properties?.[key]; if (declared) return declared;`
- `:314` `seed`: `const prop = s.properties?.[key]; if (prop) out[key] = ...`. The assignment `out['__proto__'] = ...` also sets the prototype.
- The same unchecked pattern appears at `:210` and `:220` (`switchVariant`) and `:545` (`selectorValues`).

Requirement:

JSON Schema `properties` declares only its own listed names. CR-4 already established that names like `toString` and `__proto__` must be treated as plain property names. The fixer applied this only to `mergeTwo`.

Expected behavior:

Take an object schema `{ type: 'object', properties: { a: {type:'string'} }, ... }`:
- With `additionalProperties: {type:'boolean'}`, `typesAt(['constructor'])` is `['boolean']`, the same as for any undeclared key (`typesAt(['zzz'])` is already `['boolean']`).
- With `patternProperties: {'^[a-zA-Z]+$': {type:'integer'}}`, `typesAt(['toString'])` is `['number']`.
- With `additionalProperties: false`, `permitsKey([], {}, 'constructor')` is `false`.
- `seed` with `required: ['a','toString']` returns `{ a: '' }`.
- `seed` of `required: ['__proto__']` with a declared object `__proto__` property returns an object with prototype `Object.prototype` and the own key `__proto__: { x: 1 }`.

Actual behavior:

- `typesAt(['constructor'])` and `typesAt(['toString'])` return all six types (`string, number, boolean, null, object, array`), because `Object.prototype.constructor`/`toString` is used as the schema node.
- `permitsKey(..., 'constructor')` returns `true`, so the explorer would offer or accept a key the schema forbids.
- `seed` returns `{ a: '', toString: '' }`.
- `seed` returns `{}` whose prototype is `{ x: 1 }`, and the `__proto__` key is lost.

Severity:

Low. This is inherited from JSON Canopy and is not a regression of the copy. It is the same defect class as CR-4, so the CR-4 fix is incomplete: any JSON document with a key such as `constructor` or `toString` gets wrong types, permissions or seeds when a schema is loaded. The `__proto__` seed only changes the prototype of the seeded object, not the global `Object.prototype`.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` A likely fix is an own-property lookup such as `Object.hasOwn(s.properties ?? {}, key) ? s.properties[key] : undefined` at the lookup sites, plus `Object.defineProperty` (as in `mergeTwo`) for the `out[key]` write in `seed`.

## Coverage

Status: verified for the whole-file metric, with one disclosed limitation. The run excludes the 4 failing TW-2 tests by name (`--filter`), because Vitest writes no coverage report when a test fails. The unfiltered run, which includes the 4 failing tests, exited nonzero and left `packages/renderer/coverage/` empty, so it has no partial output. The excluded tests only call `typesAt`/`permitsKey`/`seed`, which other tests already reach, so the measured counters are a lower bound for the full suite.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured only for the fixer's executable change in `97efff0`. It was read from `lcov.info` for the changed `mergeTwo` lines 568-577 of `schema-model.ts`. Executable lines 570 and 571 are both hit (DA 87/87), so 2/2 lines are covered. The `Object.hasOwn` conditional at line 570 has both arms hit (BRDA 37 and 50). For the rest of the task it was not measured: the files were moved from `vendor/`, so nearly every line counts as added and changed-line coverage would equal the whole-file numbers. The other fixer changes are comments, CSS, binary fonts and NOTICE, which have no instrumented lines; they are covered by `styles.spec.ts` and `notice.spec.ts` instead.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explorer-copy`. Base `39ea176382bee26068b872b47c53d8887193a9f4`, HEAD `97efff0037315ea1d8afb9690a1aa655499b0d81`. Commits `a712f50`, `57ea9a8`, `f503711`, `1d8a453`, `97efff0` come from the parent and from `git log 39ea176..HEAD`. The file scope comes from `git diff --name-only --diff-filter=AMR 39ea176..HEAD -- 'packages/renderer/src/*.ts' ':!*.spec.ts'` (45 files).
- Source/test snapshot identifier (including uncommitted inputs): HEAD `97efff0`, with tracked production files clean. Uncommitted specs (sha256):
  - `src/notice.spec.ts`: `216b5833e6b1170f8384b696070d752eba952841156df525caeb1df1b65773bd`
  - `src/styles.spec.ts`: `50aaa774c0e9a9ccb53439cdb3aab581d89582acf42b868442d5f6a2715aa084`
  - `src/app/schema/schema-model.variants.spec.ts`: `9c0224d6c5367d33da3abe6f1e09634ea56f381c7daaade7e2f43c28937466ab`

  The hashes and `git status` were identical before and after the coverage run.
- Exact included files; renamed/deleted/excluded files and reasons: the 45 `.ts` files in the table below, all measured. Excluded:
  - Angular templates (`*.component.html`) and component CSS, which v8 does not instrument
  - `styles.css` and the two `assets/fonts/*.woff2` files (styles and binaries, checked by `styles.spec.ts`)
  - `assets/samples/canopy-demo.json` (data)
  - the deleted `vendor/json-canopy/**` and `host-bridge.service.ts` files, which do not exist at HEAD
  - config files (`angular.json`, `package.json`, `eslint.config.mjs`, `.prettierignore`, `package-lock.json`)
  - documentation (`NOTICE`, which `notice.spec.ts` checks, plus `AGENTS.md` and `BRIEF.md`)
  - spec files
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` through `@angular/build:unit-test`, Vitest 5.1.0. Working directory `packages/renderer`. Command: `npx ng test --filter='^(?!.*document keys named like Object\.prototype members)' --coverage` with one `--coverage-include=src/...` flag for each of the 45 files. Test selection: the whole renderer suite (27 files) except the 4 TW-2 tests, which ran as 428 passed and 4 skipped.
- Run start/completion time and exit status: start 2026-11-16 19:54:06 +0100, report written at 19:54:12 +0100. All 428 selected tests passed and none failed. The exit status was not captured separately, because the sandbox refused `; echo $?`. A successful exit is inferred from the absence of failures and the fact that the report was written (Vitest wrote no report for the failing unfiltered run at 19:53:45).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (mtime 19:54:12.38, sha256 `8afd8b23a535ed7e5a4c25a006b7951e77dec8bbaacd7807a4e9d3daac502e52`) and `packages/renderer/coverage/renderer/lcov.info` (mtime 19:54:12.41, sha256 `9f6c9f5e8570a5a49cd62e707cef9948aac4bb0c612fa46edf7d77a2962488f5`). Both are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The directory was empty after the failed run at 19:53:45, so these files can only come from the 19:54 run. The summary hash equals the one in the first report because every counter is unchanged (the fixer's mergeTwo rewrite has the same number of lines and branches). `lcov.info` differs from the first report's (`08ca74c8...`), and `lcov.info` is the file that carries the new line numbers.
- Final run after latest test additions and production fixes: yes. It covers the latest test additions and fixer commit `97efff0`. A TW-2 fix will need a new run.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/app.ts` | 6/6 (100%) | 10/10 (100%) | 1/1 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/home.ts` | 12/12 (100%) | 10/10 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/renderer/src/app/dev/explorer-demo.ts` | 33/33 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `packages/renderer/src/app/explorer/json-edit.util.ts` | 32/42 (76.19%) | 17/20 (85%) | 8/11 (72.72%) | 26/36 (72.22%) |
| `packages/renderer/src/app/explorer/json-explorer.component.ts` | 20/20 (100%) | 11/12 (91.66%) | 5/5 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explorer/json-lines.util.ts` | 103/105 (98.09%) | 62/67 (92.53%) | 25/25 (100%) | 89/89 (100%) |
| `packages/renderer/src/app/explorer/jump-steps.util.ts` | 38/38 (100%) | 23/25 (92%) | 2/2 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explorer/layout-memory.ts` | 9/9 (100%) | 4/4 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/explorer/layout.util.ts` | 11/11 (100%) | 13/13 (100%) | 3/3 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/reveal.util.ts` | 24/26 (92.3%) | 7/10 (70%) | 4/4 (100%) | 21/21 (100%) |
| `packages/renderer/src/app/explorer/column-menu/column-menu.component.ts` | 20/25 (80%) | 10/14 (71.42%) | 8/11 (72.72%) | 13/16 (81.25%) |
| `packages/renderer/src/app/explorer/docs-panel/docs-panel.component.ts` | 4/21 (19.04%) | 6/24 (25%) | 1/7 (14.28%) | 1/15 (6.66%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 17/40 (42.5%) | 14/37 (37.83%) | 6/15 (40%) | 13/29 (44.82%) |
| `packages/renderer/src/app/explorer/highlight/highlight.component.ts` | 17/17 (100%) | 12/12 (100%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/json-form/json-form.component.ts` | 51/102 (50%) | 34/81 (41.97%) | 21/43 (48.83%) | 46/91 (50.54%) |
| `packages/renderer/src/app/explorer/json-lines/json-lines.component.ts` | 40/40 (100%) | 22/22 (100%) | 13/13 (100%) | 33/33 (100%) |
| `packages/renderer/src/app/explorer/json-table/json-table.component.ts` | 155/211 (73.45%) | 107/141 (75.88%) | 77/97 (79.38%) | 132/174 (75.86%) |
| `packages/renderer/src/app/explorer/outline/outline.component.ts` | 4/18 (22.22%) | 6/17 (35.29%) | 1/4 (25%) | 1/12 (8.33%) |
| `packages/renderer/src/app/explorer/outline/outline.util.ts` | 26/26 (100%) | 25/25 (100%) | 3/3 (100%) | 23/23 (100%) |
| `packages/renderer/src/app/explorer/schema-doc/schema-doc.component.ts` | 4/7 (57.14%) | 6/10 (60%) | 1/2 (50%) | 1/3 (33.33%) |
| `packages/renderer/src/app/explorer/schema-info/schema-info.component.ts` | 14/19 (73.68%) | 20/21 (95.23%) | 3/5 (60%) | 10/15 (66.66%) |
| `packages/renderer/src/app/explorer/services/collapse.service.ts` | 13/20 (65%) | 10/13 (76.92%) | 4/7 (57.14%) | 9/11 (81.81%) |
| `packages/renderer/src/app/explorer/services/column-sync.service.ts` | 23/24 (95.83%) | 16/19 (84.21%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/explorer/services/edit-mode.service.ts` | 12/17 (70.58%) | 8/11 (72.72%) | 3/5 (60%) | 7/10 (70%) |
| `packages/renderer/src/app/explorer/services/filter.service.ts` | 68/69 (98.55%) | 59/61 (96.72%) | 20/20 (100%) | 46/46 (100%) |
| `packages/renderer/src/app/explorer/services/focus.service.ts` | 6/7 (85.71%) | 5/5 (100%) | 0/1 (0%) | 3/4 (75%) |
| `packages/renderer/src/app/explorer/services/json-lines.service.ts` | 16/25 (64%) | 7/13 (53.84%) | 3/8 (37.5%) | 12/18 (66.66%) |
| `packages/renderer/src/app/explorer/services/jump.service.ts` | 3/58 (5.17%) | 3/43 (6.97%) | 0/9 (0%) | 1/48 (2.08%) |
| `packages/renderer/src/app/explorer/services/layout.service.ts` | 3/19 (15.78%) | 3/17 (17.64%) | 0/5 (0%) | 1/14 (7.14%) |
| `packages/renderer/src/app/explorer/services/node-visibility.service.ts` | 11/13 (84.61%) | 6/7 (85.71%) | 3/4 (75%) | 8/10 (80%) |
| `packages/renderer/src/app/explorer/services/panel.service.ts` | 6/10 (60%) | 5/5 (100%) | 0/4 (0%) | 3/5 (60%) |
| `packages/renderer/src/app/explorer/services/reveal.service.ts` | 17/18 (94.44%) | 7/7 (100%) | 6/7 (85.71%) | 13/14 (92.85%) |
| `packages/renderer/src/app/explorer/services/schema.service.ts` | 151/154 (98.05%) | 98/107 (91.58%) | 46/46 (100%) | 121/121 (100%) |
| `packages/renderer/src/app/explorer/services/table-orientation.service.ts` | 11/14 (78.57%) | 7/9 (77.77%) | 2/5 (40%) | 8/10 (80%) |
| `packages/renderer/src/app/schema/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/schema/problem-index.ts` | 55/57 (96.49%) | 37/39 (94.87%) | 10/10 (100%) | 48/48 (100%) |
| `packages/renderer/src/app/schema/schema-describe.ts` | 52/54 (96.29%) | 50/52 (96.15%) | 8/8 (100%) | 34/34 (100%) |
| `packages/renderer/src/app/schema/schema-load.ts` | 10/10 (100%) | 7/9 (77.77%) | 1/1 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/schema/schema-model.ts` | 397/430 (92.32%) | 306/357 (85.71%) | 109/119 (91.59%) | 304/312 (97.43%) |
| `packages/renderer/src/app/schema/schema-ref.ts` | 5/5 (100%) | 9/9 (100%) | 2/2 (100%) | 4/4 (100%) |
| `packages/renderer/src/app/schema/schema-validator.ts` | 31/31 (100%) | 25/30 (83.33%) | 7/7 (100%) | 27/27 (100%) |
| `packages/renderer/src/app/schema/schema.types.ts` | N/A | N/A | N/A | N/A |
| **Aggregate (45 files, summed counters)** | 1550/1883 (82.31%) | 1104/1406 (78.52%) | 426/539 (79.03%) | 1206/1441 (83.69%) |

All 45 scoped files are in the aggregate, and none is missing or unmeasured. `index.ts` and `schema.types.ts` contain only re-exports or types and have zero counters. HTML templates, CSS, fonts, JSON and NOTICE are excluded because they are not instrumented; the spec-based checks for them are listed above. The aggregate excludes only the 4 TW-2 tests, as disclosed under Status.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `schema/schema-model.ts:568-577` (fixer's mergeTwo change) | CR-4: own-property check and `defineProperty` for `properties`/`patternProperties` | Fully covered: lines 570 and 571 hit, both arms of the `Object.hasOwn` branch hit. Tests: fixer's 2 tests and 6 in `schema-model.variants.spec.ts`. |
| `schema/schema-model.ts:210, 220, 314, 519, 545` (covered lines, wrong behaviour for inherited names) | Same class as CR-4: `properties?.[key]` reads `Object.prototype` members | Covered by lines, but the behaviour is wrong: TW-2 (4 failing tests). |
| `schema/schema-model.ts`: lines 331, 350, 392, 489-490, 522, 645-648 | allOf/anyOf type union in `allowedTypes`, `choicesAt` on the discriminator, nested oneOf summaries, the unresolved local `$ref` warning, the `patternProperties` lookup in `ownChild`, the invalid-regex fallback in `safeRegExp` | Not added in this pass. This is unchanged JSON Canopy behaviour that the task only reformatted (same gap as the first report). Line 522 will be exercised by the TW-2 pattern test once the bug is fixed. |
| `explorer/services/column-sync.service.ts`: the `dataset['colKey'] ?? ''` arms | Header without `data-col-key` | Unreachable through the templates, and jsdom has no layout. Justified gap, as in the first report. |
| `explorer/form-fields.util.ts`: 1 of 8 branches | `ghost?.required ?? false` | Unreachable after `ghostByKey.has(key)`. Justified gap. |
| `jump.service.ts` (2%), `layout.service.ts` (7%), `outline.component.ts` (8%), `docs-panel.component.ts` (7%), `json-form.component.ts` (51%), `editable-value.component.ts` (45%) | Copied JSON Canopy UI that the acceptance criteria do not name, or name only through the dev-route flows | Not added: outside the copy task's criteria. The dev-route component test covers the named flows. Follow-up belongs to the tasks that wire these features into Thicket. |

## Unable to test

- Font rendering under the real CSP in a browser or Electron: Not run, because there is no browser in this pass. Static checks (`styles.spec.ts`), the production build output (relative `./media/*.woff2` URLs, no `data:`, `font-src 'self'`, `<base href="./">`) and `no-network.spec.ts` stand in. No follow-up is required by the criteria. The themes task or e2e can confirm visually.
- AC2 by Playwright e2e: Not run. The criterion allows a component test, and that test passes.
- Schema validation under the CSP (Ajv `new Function`): unchanged from the first report. The parent's assumption already records it. It needs follow-up when validation is wired up.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.

The fixer's changes for CR-1 (fonts as files within the CSP), CR-3 (NOTICE) and CR-4 (mergeTwo) are tested and pass. TW-2 (Low) shows that the CR-4 fix is incomplete: other `properties?.[key]` lookups in `schema-model.ts` still return `Object.prototype` members for document keys such as `constructor`/`toString`, and `seed` changes the prototype of the seeded object for a required `__proto__`. 4 tests fail until this is fixed, so `npm run check` and `.taskcheck` fail at this revision.
