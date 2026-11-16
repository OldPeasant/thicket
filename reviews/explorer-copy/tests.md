# Test Report

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: third (final) test-writer pass, on the final code after the TW-2 fix. Task base `0f9b769fb2cda1eaa202c0a12bff695444d181fa` (`git merge-base HEAD origin/main` at measurement; it is a heartbeat commit for this task). Measured HEAD `14e79e9e012a871faa0829b5ee7ebe548ae8683f` (`main`). The parent rebased during this pass: HEAD was `4fef12ed...` at the start of the pass and became `14e79e9e...`, with the same 7 task commits. The patch content is unchanged, and the TW-2 fix diff shown by `git show HEAD` is identical. Task-owned commits in `git log 0f9b769..HEAD`, from the parent's list:
- `8dff140` Move the vendored JSON Canopy explorer into the renderer
- `6e48533` Make the copied explorer pass the strict lint, type check and specs
- `c2812e5` Add the #/dev/explorer route...
- `04a0655` Add tests for the copied explorer's strict-mode rewrites and JSON Lines view
- `d118053` Ship the Tron fonts as files within the CSP, fix NOTICE and mergeTwo own-property check
- `b78656b` Test fonts, NOTICE and prototype-named schema keys in the copied explorer
- `14e79e9` Use own-property lookups for document keys in the schema model (TW-2 fix)

No other agents' commits are in the range. This pass focuses on the TW-2 fix in `schema-model.ts`: `ownEntry`/`setOwn` in `ownChild`, `seed`, `switchVariant` and `selectorValues`, and the `in` to `Object.hasOwn` changes in `ghostKeys` and `fits`. Uncommitted at measurement: one modified spec file (listed below) and this report. This test-writer changed no production file.

Requirements:
- `tasks/explorer-copy.md` acceptance criteria (AC1-AC4) and the recorded assumptions
- `reviews/explorer-copy/review.md` (CR-1 to CR-4), and `reviews/explorer-copy/fixes.md` (CR-1 to CR-4 / TW-1 in `d118053`, TW-2 in `14e79e9`)
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"
- JSON Schema semantics: `properties` declares only the names it lists, and other keys fall through to `patternProperties`/`additionalProperties`. CR-4 and TW-2 established that names such as `toString`, `constructor` and `__proto__` are plain property names.

## Test files changed

- `packages/renderer/src/app/schema/schema-model.variants.spec.ts` (modified, uncommitted: 5 test cases added to the existing "document keys named like Object.prototype members" describe block)

Earlier passes added these files, which are committed in `b78656b` and unchanged in this pass:
- `src/styles.spec.ts`
- `src/notice.spec.ts`
- the earlier cases in `schema-model.variants.spec.ts`

No existing test was weakened, skipped or deleted. The 4 TW-2 tests are unchanged.

## Tests added or updated

Count: 5 new test cases (renderer suite now 27 files, 437 tests).

They cover the parts of the TW-2 fix that no earlier test reached with an inherited name:
- `offers a declared inherited name as a ghost key while the document lacks it` (`ghostKeys` filter, `Object.hasOwn`). Before the fix, `'constructor' in data` was always true, so the declared key was never offered.
- `does not count an inherited name as present when telling variants apart` (`fits`, both the required check and the property loop, through `variantIndex`). It checks two cases:
  - A required `toString` that is missing does not satisfy the strict pass.
  - A missing `constructor` is not compared with `Object.prototype.constructor`.
- `adds a required inherited name when switching variants` (`switchVariant` required loop: `ownEntry` plus `Object.hasOwn(value, key)` plus `setOwn`). Before the fix, `constructor` was never added.
- `switches on a __proto__ discriminator without changing the prototype` (`selectorValues` with an own `__proto__` key, and the `setOwn` writes in `switchVariant`). It checks that the result has the own key `__proto__` set to `'b'` and that the prototype is `Object.prototype`.
- `skips an inherited name that only some variants declare when choosing a discriminator` (`selectorValues` with `ownEntry`). This is a regression guard. The old code also returned `undefined` here, because a function has no `const`/`enum`, so this case cannot tell the old and new code apart.

The other 4 tests are expected to fail on the code before `14e79e9`. I worked this out by reading the code. They were not run against the old revision, because that needs a checkout and checkouts are outside my permissions.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: All copied specs pass in `npm run check` | All renderer specs (27 files) and the root Vitest projects (24 files) | `npm --prefix <repo> run check` (repo root `npm run check`) | Pass. Lint (eslint, `prettier --check`) passes, the typecheck of all workspaces passes, root vitest passes 24 files / 1369 tests, and renderer `ng test` passes 27 files / 437 tests. |
| AC2: Dev route renders the demo document; tables/form toggle, search (strict/context), collapse, edit (component test) | Existing `dev/explorer-demo.spec.ts`, `app.spec.ts` (unchanged) | `npm run check` (renderer `ng test`, jsdom) | Pass (component test). This test-writer ran no Playwright e2e. |
| AC3: Root NOTICE lists JSON Canopy (Apache-2.0, Sonensei.ch) as origin of the explorer code | `notice.spec.ts` (6 tests) | `npm run check` | Pass |
| AC4: `vendor/` deleted; no reference to it or `../json-master-plugin` outside tasks/ and reviews/ | `notice.spec.ts` "refers only to repository paths that exist" (NOTICE only) | `npm run check`. Also `git diff --name-only 0f9b769..HEAD -- . ':!packages/renderer/src' ':!vendor'` lists no new vendor paths. | Pass (NOTICE part). The repo-wide grep was not repeated, because `14e79e9` changes only `schema-model.ts`. |
| CR-1: fonts load within the CSP `font-src 'self'` | `styles.spec.ts` (4), `no-network.spec.ts` | `npm run check` | Pass (static checks; no browser) |
| CR-4 / TW-1: mergeTwo treats inherited names and `__proto__` as plain property names | Fixer's 2 tests in `schema-model.spec.ts`, plus 6 tests in `schema-model.variants.spec.ts` | `npm --prefix packages/renderer run test -- --include=src/app/schema/schema-model.variants.spec.ts --include=src/app/schema/schema-model.spec.ts` | Pass |
| TW-2: inherited names in document lookups (`typesAt`, `permitsKey`, `seed`, `__proto__` seed) | 4 TW-2 tests in "document keys named like Object.prototype members" | same focused command | **Pass** (failed before `14e79e9`) |
| TW-2 fix extras: `ghostKeys`, `fits`, `switchVariant` writes, `selectorValues` | 5 new tests (above) | same focused command; also `npm run check` | Pass |

## Focused test execution

Command:

`npm --prefix packages/renderer run test -- --include=src/app/schema/schema-model.variants.spec.ts --include=src/app/schema/schema-model.spec.ts` (runs `ng test` in `packages/renderer`)

Result:

Pass. 2 files, 57 tests, all pass, including the 4 TW-2 tests and the 5 new tests.

## Full test execution

Command:

`npm run check` (repo root; run as `npm --prefix /home/felix/work/thicket-agents/agent-1 run check`)

Result:

Pass. The steps are chained with `&&`, and every step completed:
- eslint `--max-warnings 0`, and `prettier --check`: "All matched files use Prettier code style!"
- typecheck: `tsc` for the root and all 5 workspaces, plus `ngc`
- root vitest: 24 files, 1369 tests pass
- renderer `ng test`: 27 files, 437 tests pass

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` because `package.json` exists, and that run passed (see above). It was run as `npm run check`, not through the `.taskcheck` wrapper.

## Bugs found

None in this pass. TW-2 from the previous pass is fixed by `14e79e9`: its 4 tests now pass. No new defect was found in the fix.

## Coverage

Status: verified (whole-file metric, full renderer suite, no tests excluded).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured for the TW-2 fix (`14e79e9`), read from `lcov.info` for `schema-model.ts`:
- Lines: all 16 changed executable lines are hit (lines 108, 206, 210, 213, 217, 220, 221, 222, 314, 315, 519, 545, 588, 593, 609, 613), so 16/16 (100%). The function declarations at lines 587/592 and the descriptor object lines 594-597 have no DA entries.
- Branches: every branch arm on these changed lines is hit, 20/20:
  - 213: 2/2
  - 221: 4/4
  - 315: 2/2
  - 588 (`record && Object.hasOwn`): 4/4
  - 609: 2/2
  - 613: 6/6

  This counts branches on changed lines. It does not prove that every changed condition is covered by a test that targets it, but the new tests do target each changed site.

Changed-line coverage was not measured for the rest of the task. The files were moved from `vendor/`, so nearly every line counts as added, and changed-line coverage would equal the whole-file numbers.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explorer-copy`. Base `0f9b769fb2cda1eaa202c0a12bff695444d181fa`, HEAD `14e79e9e012a871faa0829b5ee7ebe548ae8683f`. The task commits are listed in Scope (parent-supplied and matched with `git log`). The file scope comes from `git diff --name-only --diff-filter=AMR 0f9b769..HEAD -- 'packages/renderer/src/*.ts' ':!*.spec.ts'`, which gives 45 files, the same list as in the previous pass.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `14e79e9`. Tracked production files are clean (`git status --short` shows only the spec). sha256 values, which were identical before and after the coverage run:
  - `packages/renderer/src/app/schema/schema-model.variants.spec.ts` (uncommitted): `57d0ea3185fd280bf784065beaa2b18072aac3cb5589d4a4bb6342f0ffd386b2`
  - `packages/renderer/src/app/schema/schema-model.ts` (committed at HEAD): `6d0df4a93df077cef3eb154931d7e1c6db175014276ef99671fbea0eb81f5038`
- Exact included files; renamed/deleted/excluded files and reasons: the 45 `.ts` files in the table below, all measured. Excluded:
  - Angular templates (`*.component.html`) and component CSS, which v8 does not instrument
  - `styles.css` and `assets/fonts/*.woff2` (checked by `styles.spec.ts`)
  - `assets/samples/canopy-demo.json` (data)
  - the deleted `vendor/json-canopy/**` and `host-bridge.service.ts` files, which do not exist at HEAD
  - config files (`angular.json`, `package.json`, `eslint.config.mjs`, `.prettierignore`, `package-lock.json`)
  - documentation (`NOTICE`, which `notice.spec.ts` checks, plus `AGENTS.md` and `BRIEF.md`)
  - spec files
  - `reviews/`
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` through `@angular/build:unit-test`, Vitest 5.1.0. Working directory `packages/renderer`. Command: `npm --prefix packages/renderer run coverage -- --coverage-include=src/...`, which is `ng test --coverage` with one `--coverage-include` flag for each of the 45 files. Test selection: the whole renderer suite, 27 files and 437 tests, with no filter.
- Run start/completion time and exit status: Vitest start 2026-11-16 20:00:29 +0100, report written 20:00:32 +0100. All 437 tests passed, and the command returned with no error or nonzero-exit indication. The sandbox refused a compound command to echo `$?`, so the exit status was not captured as a number.
- Generated report paths and report hashes/run identifier:
  - `packages/renderer/coverage/renderer/coverage-summary.json`: mtime 20:00:32.590, sha256 `2d8a0cc98771e480f4ae6ea008bcd1e01490a79c64e6dc578ece20e719bdc697`
  - `packages/renderer/coverage/renderer/lcov.info`: mtime 20:00:32.619, sha256 `cbb32e1f13109b814876230f9b877ba60c8fd821df7a228888cd35e442e3bbe1`

  Both are Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Before the run, the directory held the 19:54 files from the previous pass. After the run, all files have 20:00:32 mtimes and new hashes. The counters also differ from the previous pass (for example, `schema-model.ts` statements went from 397/430 to 406/432), which matches the fix and the new tests. The input hashes and `git status` were unchanged.
- Final run after latest test additions and production fixes: yes. It covers TW-2 fix `14e79e9` and the 5 tests added in this pass.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/app.ts` | 6/6 (100%) | 10/10 (100%) | 1/1 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/home.ts` | 12/12 (100%) | 10/10 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/renderer/src/app/dev/explorer-demo.ts` | 33/33 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `packages/renderer/src/app/explorer/json-edit.util.ts` | 32/42 (76.19%) | 17/20 (85%) | 8/11 (72.73%) | 26/36 (72.22%) |
| `packages/renderer/src/app/explorer/json-explorer.component.ts` | 20/20 (100%) | 11/12 (91.67%) | 5/5 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explorer/json-lines.util.ts` | 103/105 (98.1%) | 62/67 (92.54%) | 25/25 (100%) | 89/89 (100%) |
| `packages/renderer/src/app/explorer/jump-steps.util.ts` | 38/38 (100%) | 23/25 (92%) | 2/2 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explorer/layout-memory.ts` | 9/9 (100%) | 4/4 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/explorer/layout.util.ts` | 11/11 (100%) | 13/13 (100%) | 3/3 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/reveal.util.ts` | 24/26 (92.31%) | 7/10 (70%) | 4/4 (100%) | 21/21 (100%) |
| `packages/renderer/src/app/explorer/column-menu/column-menu.component.ts` | 20/25 (80%) | 10/14 (71.43%) | 8/11 (72.73%) | 13/16 (81.25%) |
| `packages/renderer/src/app/explorer/docs-panel/docs-panel.component.ts` | 4/21 (19.05%) | 6/24 (25%) | 1/7 (14.29%) | 1/15 (6.67%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 17/40 (42.5%) | 14/37 (37.84%) | 6/15 (40%) | 13/29 (44.83%) |
| `packages/renderer/src/app/explorer/highlight/highlight.component.ts` | 17/17 (100%) | 12/12 (100%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/json-form/json-form.component.ts` | 51/102 (50%) | 34/81 (41.98%) | 21/43 (48.84%) | 46/91 (50.55%) |
| `packages/renderer/src/app/explorer/json-lines/json-lines.component.ts` | 40/40 (100%) | 22/22 (100%) | 13/13 (100%) | 33/33 (100%) |
| `packages/renderer/src/app/explorer/json-table/json-table.component.ts` | 155/211 (73.46%) | 107/141 (75.89%) | 77/97 (79.38%) | 132/174 (75.86%) |
| `packages/renderer/src/app/explorer/outline/outline.component.ts` | 4/18 (22.22%) | 6/17 (35.29%) | 1/4 (25%) | 1/12 (8.33%) |
| `packages/renderer/src/app/explorer/outline/outline.util.ts` | 26/26 (100%) | 25/25 (100%) | 3/3 (100%) | 23/23 (100%) |
| `packages/renderer/src/app/explorer/schema-doc/schema-doc.component.ts` | 4/7 (57.14%) | 6/10 (60%) | 1/2 (50%) | 1/3 (33.33%) |
| `packages/renderer/src/app/explorer/schema-info/schema-info.component.ts` | 14/19 (73.68%) | 20/21 (95.24%) | 3/5 (60%) | 10/15 (66.67%) |
| `packages/renderer/src/app/explorer/services/collapse.service.ts` | 13/20 (65%) | 10/13 (76.92%) | 4/7 (57.14%) | 9/11 (81.82%) |
| `packages/renderer/src/app/explorer/services/column-sync.service.ts` | 23/24 (95.83%) | 16/19 (84.21%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/explorer/services/edit-mode.service.ts` | 12/17 (70.59%) | 8/11 (72.73%) | 3/5 (60%) | 7/10 (70%) |
| `packages/renderer/src/app/explorer/services/filter.service.ts` | 68/69 (98.55%) | 59/61 (96.72%) | 20/20 (100%) | 46/46 (100%) |
| `packages/renderer/src/app/explorer/services/focus.service.ts` | 6/7 (85.71%) | 5/5 (100%) | 0/1 (0%) | 3/4 (75%) |
| `packages/renderer/src/app/explorer/services/json-lines.service.ts` | 16/25 (64%) | 7/13 (53.85%) | 3/8 (37.5%) | 12/18 (66.67%) |
| `packages/renderer/src/app/explorer/services/jump.service.ts` | 3/58 (5.17%) | 3/43 (6.98%) | 0/9 (0%) | 1/48 (2.08%) |
| `packages/renderer/src/app/explorer/services/layout.service.ts` | 3/19 (15.79%) | 3/17 (17.65%) | 0/5 (0%) | 1/14 (7.14%) |
| `packages/renderer/src/app/explorer/services/node-visibility.service.ts` | 11/13 (84.62%) | 6/7 (85.71%) | 3/4 (75%) | 8/10 (80%) |
| `packages/renderer/src/app/explorer/services/panel.service.ts` | 6/10 (60%) | 5/5 (100%) | 0/4 (0%) | 3/5 (60%) |
| `packages/renderer/src/app/explorer/services/reveal.service.ts` | 17/18 (94.44%) | 7/7 (100%) | 6/7 (85.71%) | 13/14 (92.86%) |
| `packages/renderer/src/app/explorer/services/schema.service.ts` | 151/154 (98.05%) | 98/107 (91.59%) | 46/46 (100%) | 121/121 (100%) |
| `packages/renderer/src/app/explorer/services/table-orientation.service.ts` | 11/14 (78.57%) | 7/9 (77.78%) | 2/5 (40%) | 8/10 (80%) |
| `packages/renderer/src/app/schema/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/schema/problem-index.ts` | 55/57 (96.49%) | 37/39 (94.87%) | 10/10 (100%) | 48/48 (100%) |
| `packages/renderer/src/app/schema/schema-describe.ts` | 52/54 (96.3%) | 50/52 (96.15%) | 8/8 (100%) | 34/34 (100%) |
| `packages/renderer/src/app/schema/schema-load.ts` | 10/10 (100%) | 7/9 (77.78%) | 1/1 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/schema/schema-model.ts` | 406/432 (93.98%) | 316/361 (87.53%) | 114/121 (94.21%) | 309/314 (98.41%) |
| `packages/renderer/src/app/schema/schema-ref.ts` | 5/5 (100%) | 9/9 (100%) | 2/2 (100%) | 4/4 (100%) |
| `packages/renderer/src/app/schema/schema-validator.ts` | 31/31 (100%) | 25/30 (83.33%) | 7/7 (100%) | 27/27 (100%) |
| `packages/renderer/src/app/schema/schema.types.ts` | N/A | N/A | N/A | N/A |
| **Aggregate (45 files, summed provider counters)** | 1559/1885 (82.71%) | 1114/1410 (79.01%) | 431/541 (79.67%) | 1211/1443 (83.92%) |

All 45 scoped files are in the aggregate, and none is missing or unmeasured. `index.ts` and `schema.types.ts` contain only re-exports or types and have zero counters. HTML templates, CSS, fonts, JSON and NOTICE are excluded because they are not instrumented; spec-based checks for them are listed above.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `schema/schema-model.ts`: TW-2 fix lines (108, 206-223, 314-315, 519, 545, 587-599, 609, 613) | TW-2: own-property lookups and own-key writes for document keys | Fully covered: 16/16 changed executable lines and 20/20 branch arms on them. Tests: the 4 TW-2 tests and the 5 new tests. |
| `schema/schema-model.ts:568-577` (mergeTwo, CR-4) | own-property merge | Covered (unchanged since the previous pass) |
| `schema/schema-model.ts`: remaining uncovered statements and branches (allOf/anyOf type union in `allowedTypes`, `choicesAt` on the discriminator, nested oneOf summaries, unresolved local `$ref` warning, invalid-regex fallback in `safeRegExp`) | Unchanged JSON Canopy behaviour that the task only reformatted | Not added: outside this pass, and the same gap as the earlier reports. The `patternProperties` lookup in `ownChild` is now exercised by the TW-2 pattern test. |
| `explorer/services/column-sync.service.ts`: the `dataset['colKey'] ?? ''` arms | Header without `data-col-key` | Unreachable through the templates, and jsdom has no layout. Justified gap. |
| `explorer/form-fields.util.ts`: 1 of 8 branches | `ghost?.required ?? false` | Unreachable after `ghostByKey.has(key)`. Justified gap. |
| `jump.service.ts` (2%), `layout.service.ts` (7%), `outline.component.ts` (8%), `docs-panel.component.ts` (7%), `json-form.component.ts` (51%), `editable-value.component.ts` (45%) | Copied JSON Canopy UI that the acceptance criteria do not name, or name only through the dev-route flows | Not added: outside the copy task's criteria. The dev-route component test covers the named flows. Follow-up belongs to the tasks that wire these features into Thicket. |

## Unable to test

- Font rendering under the real CSP in a browser or Electron: Not run, because there is no browser in this pass. Static checks (`styles.spec.ts`), the earlier production-build check and `no-network.spec.ts` stand in. The criteria require no follow-up.
- AC2 by Playwright e2e: Not run. The criterion allows a component test, and that test passes.
- Whether the 5 new tests fail on the code before the fix was established by reading the code, not by running them on that revision. Running them there would need a checkout, which is outside this helper's permissions.
- Schema validation under the CSP (Ajv `new Function`): unchanged from the first report, and already recorded in the parent's assumption. It needs follow-up when validation is wired up.

## Summary

Tests added and all validation passed.

The 4 TW-2 tests now pass on `14e79e9`. I added 5 small tests for the parts of the fix that had no inherited-name test before: the `ghostKeys` filter, `fits` (required check and property loop), adding a required key in `switchVariant`, `__proto__` writes in `switchVariant`, and `selectorValues`. `npm run check` (and therefore `.taskcheck`) passes with 437 renderer and 1369 root tests. Task-scoped coverage was measured fresh with no tests excluded, and the TW-2 changed lines are fully covered. No production defects were found in this pass.
