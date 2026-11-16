# Test Report

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: task base `5c13e8ab9c70388cbd7c7018bb83237d8b0871b3`, measured HEAD `073258cdce8be983ce9832c662fd41864f372b88` (`main`), diff `git diff 5c13e8ab..HEAD`. Task-owned commits (from the parent's instructions, matched against `git log 5c13e8ab..HEAD`): `754fd20` (Move the vendored JSON Canopy explorer into the renderer), `06b52ad` (Make the copied explorer pass the strict lint, type check and specs), `073258c` (Add the #/dev/explorer route showing the demo document, NOTICE and docs). There are no other commits in the range. Uncommitted at measurement: the 4 new spec files listed below (untracked) and this report. No production files were changed by this test-writer.

Requirements:
- `tasks/explorer-copy.md` acceptance criteria and the 5 recorded assumptions (`python tasks.py assumptions`)
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"; `docs/QUALITY.md`
- Parent instructions: test the behaviour changes made to pass the strict lint/tsconfig (schema-model index guards, `memo()` in schema.service, `withoutEntry`, json-lines EMPTY_DOC and `@if (lines[i]; as line)`, form-fields ghost branch, column-sync dataset fallback) and add inline-fixture tests for the schema-model paths whose samples-based cases were dropped.

How the changed behaviour was identified: each moved file was diffed against its original at the base (for example `git diff 5c13e8ab:vendor/json-canopy/src/app/schema/schema-model.ts HEAD:packages/renderer/src/app/schema/schema-model.ts`, and the same for `json-explorer/...` -> `explorer/...`). Apart from Prettier reformatting, the semantic edits are the ones listed by the parent; each was checked to keep the original behaviour (see "Findings").

## Test files changed

- `packages/renderer/src/app/schema/schema-model.variants.spec.ts` (new)
- `packages/renderer/src/app/explorer/services/schema.service.spec.ts` (new)
- `packages/renderer/src/app/explorer/json-lines/json-lines.component.spec.ts` (new)
- `packages/renderer/src/app/explorer/json-edit.entries.spec.ts` (new)

No existing spec was edited, weakened, skipped or deleted.

## Tests added or updated

Count: 46 new test cases (renderer suite 229 -> 275 tests, 18 -> 22 files).

- `schema-model.variants.spec.ts` (24): an inline work-item schema (`$ref` item with base properties + `oneOf` To-do/Bug/Event, `unevaluatedProperties: false`) replacing the dropped samples-based cases: `discriminatorOf`, `variantsAt` (titles; untitled variant labelled by first enum value; overlap and single-variant -> undefined), `variantIndexAt`, narrowing with base/variant shared properties (mergeTwo `allOf`), `switchVariant` (drop/reset/add, keep-when-fits, `drop = false`, discriminator key position, refusals for unknown value / non-object / missing item / no variants, input not mutated), `seedItem`, `metaAt` constraints with one vs several nodes; `seed` with alternatives (prefers non-null, all-null fallback, empty `oneOf`, base merged into first alternative, default/const/enum/minimum/type order); `resolve` of `allOf` with shared properties, union of `required`, `patternProperties`, and properties named like `Object.prototype` members (`toString`, `constructor`); `validate` closest-variant messages (chosen variant only; closest is a non-first option; tie picks the first; base errors kept).
- `schema.service.spec.ts` (7): neutral answers without schema/document; every memoised lookup (`readOnlyFor`, `ghostsFor`, `permitsKey`, `requiredFor`, `declaredKeys`, `declaredItemKeys`) answers correctly, caches including `false`/empty answers (same instance returned), recomputes data-dependent answers after `setData` and keeps schema-only ones; per-parent `permitsKey` ids; replace/clear schema; unusable schema text keeps the loaded one; variant/seed pass-throughs (`variantsFor`, `variantIndexFor`, `switchVariantFor`, `seedFor`, `seedItemFor`, `choicesFor`, `typesFor`, `key` from `$id`, `fail`); JSON Lines per-line answers including non-JSON lines.
- `json-lines.component.spec.ts` (8): EMPTY_DOC fallback renders "The file has no lines." when the service has no document; JSON lines as tables / text lines as text, numbered by physical line with blank lines skipped; form layout; shape labels only with more than one shape; search keeps matching JSON and text lines, "No line matches."; per-line schema problem badges; paging of 200 lines (50 shown, `+20` -> 70 and "70 / 200 lines", "Show all 200" -> 200 and the bar disappears); `lineChange` emits the line index with the new value.
- `json-edit.entries.spec.ts` (6): `withoutEntry` removes only the key, keeps order, returns a new shallow copy, absent key, numeric-looking/empty keys, a parsed `"__proto__"` key stays plain data without prototype pollution, inverse of `withEntry`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: All copied specs pass in `npm run check` | All 22 renderer spec files (18 existing incl. the copied ones, 4 new) and the root Vitest projects | `npm run check` (repo root; lint incl. `prettier --check`, typecheck, tests) | Pass: exit 0; root 5 files / 599 tests, renderer 22 files / 275 tests |
| AC2: Dev route renders the demo document; tables/form toggle, search (strict/context), collapse, edit work (component test) | Existing `dev/explorer-demo.spec.ts` (6 tests: render, toggle, strict/context search, collapse, column hiding, edit) and `app.spec.ts` (routing), run unchanged; supporting: new `json-lines.component.spec.ts`, `schema.service.spec.ts` | `npm run test -w packages/renderer` (ng test, Vitest, jsdom) | Pass (component test in jsdom; no Playwright e2e was run by this test-writer) |
| AC3: Root NOTICE lists JSON Canopy (Apache-2.0, Sonensei.ch) as origin | Not a unit-testable behaviour; inspected `NOTICE` (names JSON Canopy 0.4.0, Sonensei.ch, Apache License 2.0, and the explorer/schema/styles/demo paths) | `head -25 NOTICE` | Not testable (manual inspection: present) |
| AC4: `vendor/` deleted; no path or import refers to it or `../json-master-plugin` outside tasks/ and reviews/ | Not a unit test; checked by grep | `ls vendor`; `git grep -c "vendor/" -- ':!tasks' ':!reviews'`; `git grep -c "json-master-plugin" -- ':!tasks' ':!reviews'` | Pass: `vendor` does not exist, both greps return no matches |
| Strict-lint rewrites keep JSON Canopy behaviour: schema-model guards (narrow, discriminatorOf, metaAt, seedItem, variantsAt, switchVariant, seed, closestVariantProblems, mergeTwo) | `schema-model.variants.spec.ts` (24 tests) | `npx ng test --include='src/app/schema/schema-model.variants.spec.ts'` (in `packages/renderer`) | Pass |
| `memo()` caches in `SchemaService` | `schema.service.spec.ts` (7 tests) | `npx ng test --include='src/app/explorer/services/schema.service.spec.ts'` | Pass |
| `withoutEntry` via `Object.fromEntries` | `json-edit.entries.spec.ts` (6 tests) | `npx ng test --include='src/app/explorer/json-edit.entries.spec.ts'` | Pass |
| json-lines EMPTY_DOC fallback and `@if (lines[i]; as line)` template | `json-lines.component.spec.ts` (8 tests) | `npx ng test --include='src/app/explorer/json-lines/json-lines.component.spec.ts'` | Pass |
| form-fields ghost branch | Existing `form-fields.util.spec.ts` ("marks required keys, present or absent", "follows the schema order...") | `npm run test -w packages/renderer` | Pass (branch 7/8: the `?? false` fallback is unreachable because `ghostByKey.has(key)` was checked first) |
| column-sync `dataset['colKey'] ?? ''` fallback | Exercised through the existing table/demo component specs | `npm run test -w packages/renderer` | Pass (lines 18/18; the `?? ''` arm for a header without `data-col-key` is not hit, see Coverage gaps) |

## Focused test execution

Command (in `packages/renderer`):

`npx ng test --include='src/app/schema/schema-model.variants.spec.ts'`
`npx ng test --include='src/app/explorer/services/schema.service.spec.ts' --include='src/app/explorer/json-lines/json-lines.component.spec.ts'`
`npx ng test --include='src/app/explorer/services/schema.service.spec.ts' --include='src/app/explorer/json-edit.entries.spec.ts'`

Result:

Pass (24, 16 and 13 tests respectively; the final json-lines spec alone: 8 passed). While writing them, four assertions of mine were wrong and were corrected against the code and the spec: nested `app-json-table`s inside a line (selector narrowed to `.line-body > app-json-table`), an open object schema keeps the old variant's keys on `switchVariant` (it only drops keys the target closes off), an assertion on the unresolved intermediate of `mergeTwo` for a property named `toString` (see Findings; replaced by assertions on resolved, observable behaviour), and a first paging test whose 60-line file was fully revealed by the first `+20` click (rewritten with 200 lines so both `revealMore` and `revealAll` are asserted).

## Full test execution

Command:

`npm run check` (repo root)

Result:

Pass (exit 0). Lint and `prettier --check` clean, typecheck clean, root Vitest 5 files / 599 tests, renderer 22 files / 275 tests. Baseline before the new specs: renderer 18 files / 229 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` is `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi`; `package.json` exists, so it runs `npm run check`, which exited 0 on the final test files.

## Bugs found

None that require a production fix.

Findings (no fix required):

- TW-1 (informational, Low, pre-existing in JSON Canopy, not a regression): `mergeTwo` in `packages/renderer/src/app/schema/schema-model.ts` (~line 569) tests `merged[name]` on a plain object, so when only the second `allOf` part declares a property named like an `Object.prototype` member (`toString`, `constructor`), the merged, unresolved `properties.toString` becomes `{ allOf: [Object.prototype.toString, {...}] }`. The original code (`name in merged`) behaved the same. Resolving that property still yields the right schema (`{ type: 'string' }`), and `typesAt`/`seed` for a `constructor` property are correct (tested), so no observable defect was found. Mentioned because a future change that reads unresolved `properties` would see the function. Using `Object.hasOwn(merged, name)` would avoid it.
- The other strict-lint rewrites were checked to be behaviour-preserving: `switchVariant`'s `fits = !declared || ...` (old code also treated an undeclared key as fitting), `closestVariantProblems` reduce `?? Infinity`, `seed`'s `firstAlternative` (an empty `oneOf` now falls through to the type, as before, tested), `withoutEntry` (same key order and own `__proto__` handling as spread + delete, tested), `memo()` (stores `false`/empty answers, tested).

## Coverage

Status: verified (fresh run on the final test files, exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. Almost every line of these files is "added" in the diff because they were moved from `vendor/` (rename detection does not pair most of them across the two-step move), so changed-line coverage would equal whole-file coverage and say nothing about the small semantic edits; those were checked by targeted tests and lcov line hits instead (see the gaps table).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `explorer-copy`; base `5c13e8ab9c70388cbd7c7018bb83237d8b0871b3`; HEAD `073258cdce8be983ce9832c662fd41864f372b88`; commits `754fd20`, `06b52ad`, `073258c` from the parent and `git log 5c13e8ab..HEAD`; file scope from `git diff --name-only --diff-filter=AMR 5c13e8ab..HEAD -- 'packages/renderer/src/*.ts'` without `*.spec.ts`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD `073258c` with clean tracked files, plus untracked specs (sha256): `json-edit.entries.spec.ts` d71f71a54d9fc82c1643a710d2505b04649dfc2b7b39294cfcbd0270653a00e7, `json-lines/json-lines.component.spec.ts` 8cc00632552d76fa330c5861d2a5cc0433a1aa315a4628689a02176b689d79f7, `services/schema.service.spec.ts` 62af161afaf277b9a783d58812a3b5068eb71b6bd9d409cc4778182bdfad26df, `schema/schema-model.variants.spec.ts` d639b074d3cc9f4442d724e45f8f3dcb326d32e7d22ff05f9a7334b58b5cea0f. Hashes were identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: the 45 production `.ts` files in the table below (all measured, all present in the report). Excluded: Angular templates (`*.component.html`) and CSS, which v8 does not instrument (template logic is exercised through component tests, but has no counters); `packages/renderer/src/assets/samples/canopy-demo.json` and `styles.css` (data/styles, no executable code); deleted `vendor/json-canopy/**` and `host-bridge.service.ts` (do not exist at HEAD); config files (`angular.json`, `package.json`, `eslint.config.mjs`, `.prettierignore`, `package-lock.json`), docs (`NOTICE`, `AGENTS.md`, `BRIEF.md`) and spec files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via `@angular/build:unit-test` (Vitest 5.1.0, Node 24.22.1); working directory `packages/renderer`; command `npx ng test --coverage` with one `--coverage-include` flag per file for all 45 files of the table (paths relative to `packages/renderer`, e.g. `--coverage-include='src/app/schema/schema-model.ts'`); test selection: the whole renderer suite (22 files, 275 tests).
- Run start/completion time and exit status: start 2026-11-16 19:36:55 +0100, report written 19:36:58 +0100; exit 0, 275/275 passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 8afd8b23a535ed7e5a4c25a006b7951e77dec8bbaacd7807a4e9d3daac502e52), `packages/renderer/coverage/renderer/lcov.info` (sha256 08ca74c80f137940964f17a5dc435258d9bcc1a967a343b5ee1a1cbfd8405ff4), `packages/renderer/coverage/renderer/lcov-report/` (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: the report files carry this run's timestamps (19:36:58) and differ from the two earlier runs (19:32, summary sha256 2dc570b6...; 19:34, summary sha256 5b19597b...), which were before the last test changes; spec hashes were checked before and after this run.
- Final run after latest test additions and production fixes: yes for the test additions; no production fixes were made.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/app.routes.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/app.ts` | 6/6 (100%) | 10/10 (100%) | 1/1 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/home.ts` | 12/12 (100%) | 10/10 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/renderer/src/app/dev/explorer-demo.ts` | 33/33 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/explorer/column-menu/column-menu.component.ts` | 20/25 (80%) | 10/14 (71.42%) | 8/11 (72.72%) | 13/16 (81.25%) |
| `packages/renderer/src/app/explorer/docs-panel/docs-panel.component.ts` | 4/21 (19.04%) | 6/24 (25%) | 1/7 (14.28%) | 1/15 (6.66%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 17/40 (42.5%) | 14/37 (37.83%) | 6/15 (40%) | 13/29 (44.82%) |
| `packages/renderer/src/app/explorer/form-fields.util.ts` | 16/16 (100%) | 7/8 (87.5%) | 2/2 (100%) | 14/14 (100%) |
| `packages/renderer/src/app/explorer/highlight/highlight.component.ts` | 17/17 (100%) | 12/12 (100%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/json-edit.util.ts` | 32/42 (76.19%) | 17/20 (85%) | 8/11 (72.72%) | 26/36 (72.22%) |
| `packages/renderer/src/app/explorer/json-explorer.component.ts` | 20/20 (100%) | 11/12 (91.66%) | 5/5 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explorer/json-form/json-form.component.ts` | 51/102 (50%) | 34/81 (41.97%) | 21/43 (48.83%) | 46/91 (50.54%) |
| `packages/renderer/src/app/explorer/json-lines.util.ts` | 103/105 (98.09%) | 62/67 (92.53%) | 25/25 (100%) | 89/89 (100%) |
| `packages/renderer/src/app/explorer/json-lines/json-lines.component.ts` | 40/40 (100%) | 22/22 (100%) | 13/13 (100%) | 33/33 (100%) |
| `packages/renderer/src/app/explorer/json-table/json-table.component.ts` | 155/211 (73.45%) | 107/141 (75.88%) | 77/97 (79.38%) | 132/174 (75.86%) |
| `packages/renderer/src/app/explorer/jump-steps.util.ts` | 38/38 (100%) | 23/25 (92%) | 2/2 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/explorer/layout-memory.ts` | 9/9 (100%) | 4/4 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/explorer/layout.util.ts` | 11/11 (100%) | 13/13 (100%) | 3/3 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/explorer/outline/outline.component.ts` | 4/18 (22.22%) | 6/17 (35.29%) | 1/4 (25%) | 1/12 (8.33%) |
| `packages/renderer/src/app/explorer/outline/outline.util.ts` | 26/26 (100%) | 25/25 (100%) | 3/3 (100%) | 23/23 (100%) |
| `packages/renderer/src/app/explorer/reveal.util.ts` | 24/26 (92.3%) | 7/10 (70%) | 4/4 (100%) | 21/21 (100%) |
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

The aggregate covers all 45 scoped files; none is missing or unmeasured. HTML templates and CSS are excluded (not instrumented). For comparison, the run at 19:32 (before the `schema.service` pass-through and json-lines paging tests) gave 1510/1883 statements, 1072/1406 branches, 412/539 functions, 1170/1441 lines; `schema.service.ts` went from 88/121 to 121/121 lines. No baseline was taken before any new test was added.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `schema/schema-model.ts`: lines 331, 350, 392, 489-490, 522, 645-648 | allOf/anyOf type union in `allowedTypes`, `choicesAt` on the discriminator itself, nested oneOf summaries, unresolved local `$ref` warning, `patternProperties` lookup, invalid-regex fallback in `safeRegExp`. These lines were only reformatted by the task, not rewritten. | Not added: unchanged JSON Canopy behaviour outside this copy task. All index-guard rewrites the parent listed are now exercised (switchVariant, variantsAt, seed, closestVariantProblems, mergeTwo, seedItem, metaAt). Candidate for restoring the dropped samples-based cases if the samples are vendored (assumption #1). |
| `explorer/services/schema.service.ts`: 9 of 107 branches | Remaining `perLine` / no-model arms of individual lookups | Accepted: lines 121/121 and functions 46/46 covered; every `memo()` call site tested. |
| `explorer/services/column-sync.service.ts`: the `dataset['colKey'] ?? ''` fallback arms | Header without `data-col-key` (rewritten from a non-null assertion) | Not reachable through the templates (every synced `th` sets `data-col-key`); jsdom has no layout (`offsetWidth` is 0), so a unit test would only assert `0px`. Left uncovered, low risk. |
| `explorer/form-fields.util.ts`: 1 of 8 branches | `ghost?.required ?? false` fallback | Unreachable: the branch runs only after `ghostByKey.has(key)`. Justified gap. |
| `explorer/services/jump.service.ts` (2%), `layout.service.ts` (7%), `outline/outline.component.ts` (8%), `docs-panel/docs-panel.component.ts` (7%), `json-form/json-form.component.ts` (51%), `editable-value/editable-value.component.ts` (45%) | Copied JSON Canopy UI that the task's ACs do not name (jump navigation, outline, docs panel) or name only through the dev-route flows (form layout, editing) | Not added: outside the acceptance criteria of a copy task; the dev-route component test covers the named flows (toggle, search, collapse, column hiding, edit). The copy had no specs for these in JSON Canopy either. Follow-up belongs to the tasks that wire these features into Thicket. |

## Unable to test

- AC2 by Playwright e2e: not run by this test-writer. The criterion allows "Playwright e2e or component test"; the component test (`dev/explorer-demo.spec.ts`, jsdom) passes. Visual behaviour (Tron styles, inlined fonts, real layout, column width sync) cannot be checked in jsdom. No follow-up required by the criterion.
- AC3 (NOTICE content) is a documentation check, inspected manually, not testable as code.
- Schema validation in the packaged renderer: assumption #4 notes Ajv compiles with `new Function`, which the renderer CSP blocks. The unit tests run Ajv in Vitest without the CSP, so they do not show whether validation works in the built app. Needs follow-up when schema validation is wired up (the parent's assumption already records this).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient for the acceptance criteria and the strict-lint rewrites; no production defects requiring a fix were found (TW-1 is informational).
