# Code Review

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: final review of the committed task at HEAD `aa8d214d9cdb4ee044819f6b81849e6e21624894`. Committed changes only: `git diff c362008f454785d5c8cc940c9160539ed83a8165..aa8d214d9cdb4ee044819f6b81849e6e21624894` (the task's 9 commits on top of `git merge-base HEAD origin/main`). This report replaces the previous one, which reviewed `14e79e9e012a871faa0829b5ee7ebe548ae8683f`. It carries over that report's findings and acceptance-criteria assessment, and it adds a review of the code that changed after it.

Reviewed revision: `aa8d214d9cdb4ee044819f6b81849e6e21624894`

Requirements:
- `tasks/explorer-copy.md` (goal, 4 acceptance criteria, 6 recorded assumptions; the sixth records the dispositions of CR-1 to CR-3)
- `tasks/font-license.md` (follow-up task that takes over CR-1 and CR-2)
- `SPEC.md`, `docs/ARCHITECTURE.md` (renderer, no-network rule, CSP), `docs/QUALITY.md`, `AGENTS.md`
- Earlier reports `reviews/explorer-copy/review.md` (rounds 1 to 3), `tests.md` (TW-1, TW-2) and `fixes.md`
- Parent instructions (re-review after the test-writer's last addition, run `npm run check`, record dispositions)

Git range:
- Branch: main
- HEAD: aa8d214d9cdb4ee044819f6b81849e6e21624894
- Base/start: c362008f454785d5c8cc940c9160539ed83a8165 (`git merge-base HEAD origin/main`). The previous review used base 0f9b769 and head 14e79e9. The task was rebased onto a newer main since then.
- Commits reviewed: 9 (6d8758b move, 1011534 strict-mode fixes, 8ce00c3 dev route/NOTICE/docs, 870ea45 tests, 907696d fonts/NOTICE/mergeTwo fix, b5e398a font/NOTICE/prototype-key tests, dd8f8c0 own-property lookups, e4298d2 more own-property tests plus reports, aa8d214 task file font-license only)
- Uncommitted changes: none (`git status --short` is empty).

## Delta since the previous review (14e79e9 -> aa8d214)

Scope check: the parent asked for `git diff 14e79e9e HEAD -- . ':!tasks' ':!reviews'`. That diff also lists files from the `secrets-store` task (`apps/desktop/src/secrets/**`, `packages/contract/**`, `docs/ARCHITECTURE.md`, ...), because main moved under the task during the rebase (0f9b769..c362008 contains `done: secrets-store`). These files are not part of this task. To isolate the task's own changes I compared the task diffs before and after the rebase using `git patch-id --stable`:
- `git diff 0f9b769 14e79e9 -- . ':!tasks' ':!reviews' ':!packages/renderer/src/app/schema/schema-model.variants.spec.ts'` and `git diff c362008 HEAD` with the same exclusions both give patch-id `522fc9a1…`.
- So the only code change in the task since the reviewed revision is `packages/renderer/src/app/schema/schema-model.variants.spec.ts` (+69 lines, 5 new cases in `describe('document keys named like Object.prototype members')`, commit e4298d2). Production code is unchanged.

Assessment of the 5 new test cases (checked against `schema-model.ts` at HEAD):
1. "offers a declared inherited name as a ghost key while the document lacks it": exercises `ghostKeys` (`schema-model.ts:108`, `Object.hasOwn(data, key)`). With the earlier `key in data`, `constructor` would count as present and no ghost key would appear. The test catches that regression. The second assertion checks that the key disappears once it is really present.
2. "does not count an inherited name as present when telling variants apart": exercises `fits` (`schema-model.ts:609,613`). With `in` checks, `{ other: 1 }` would pass the strict pass for both variants, and `{}` would compare `constructor`'s const with `Object.prototype.constructor`. Both cases would return a different index. The test is correct and catches a regression.
3. "adds a required inherited name when switching variants": exercises `switchVariant`'s added-keys loop (`schema-model.ts:219-224`). With the earlier `in` check, `constructor` would not be added. The expected result (`constructor: ''`, `added: ['constructor']`) matches `seed` for a string schema. The test is correct and catches a regression.
4. "switches on a __proto__ discriminator without changing the prototype": the schema and data come from `JSON.parse`, so `__proto__` is an own key, as in a real loaded document. The test covers `discriminatorOf`/`selectorValues`, the computed key in `variantIndex(node, { [info.property]: to })` and `setOwn`. The key-order and own-descriptor assertions would fail if a plain assignment were used. The prototype assertion alone would not fail, because assigning a string to `__proto__` is ignored, but the other two assertions cover that case.
5. "skips an inherited name that only some variants declare when choosing a discriminator": this test is correct and documents the intended result (`kind`). However, it does not discriminate. Without `ownEntry` in `selectorValues` (`schema-model.ts:545`), `variant.properties.toString` would resolve to `Object.prototype.toString`, which has no `const` or `enum`, so `selectorValues` would still return `undefined` and the test would still pass. This is a characterisation test, not a regression test. It is harmless and cheap, and it does not justify a finding.

The new tests are behaviour-level (public `SchemaModel` methods, no mocks), consistent with the surrounding cases, and make no production change. They need no action.

Commands run (read-only, besides the check):
- `git log --oneline c362008..HEAD`, `git diff 14e79e9e HEAD -- packages/renderer/src/app/schema/schema-model.variants.spec.ts`, and the `git patch-id --stable` comparison above
- `npm run check` (= `npm run lint && npm run typecheck && npm run test`) on the clean tree at aa8d214 -> passed (exit 0). Root vitest: 28 files, 1530 tests passed. Renderer `ng test`: 27 files, 437 tests passed.
- `git grep -n "vendor/\|json-master-plugin" -- ':!tasks' ':!reviews'` -> one match, `packages/renderer/src/notice.spec.ts:59` (the accepted negative assertion, CR-3). `ls vendor` -> no such directory.

Summary: 0 P0, 0 P1, 0 P2, 3 P3 (all 3 P3 findings carry over from the previous round and are dispositioned: CR-1 and CR-2 deferred to task `font-license`, CR-3 accepted; no new findings)

## Earlier findings: resolution check (carried over, re-checked at HEAD)

From the first two review rounds (production code unchanged since then, so these remain valid):
- Round-1 CR-1 (CSP `font-src 'self'` blocked the inlined `data:` fonts): **resolved.** `styles.css:7-21` loads `./assets/fonts/orbitron.woff2` and `./assets/fonts/share-tech-mono.woff2`. No `data:` URL remains, and the CSP in `src/index.html` is unchanged. The file sizes match the WOFF2 length fields of the original payloads at `c0d4dca`. `styles.spec.ts` covers the URLs, the existence of the files and the `wOF2` signature.
- Round-1 CR-2 (stale IntelliJ/IDE host comments): **resolved.** The host-reference grep finds only the expected `notice.spec.ts` assertion.
- Round-1 CR-3 (NOTICE copyright line, modifications not stated): **resolved.** `NOTICE:1-16` names JSON Canopy 0.4.0 (Apache-2.0, Copyright 2026 Sonensei.ch) and lists the modifications. `notice.spec.ts` covers this.
- Round-1 CR-4 / TW-1 (`mergeTwo` treated inherited names and `__proto__` as existing): **resolved.** `schema-model.ts:566-577` uses `Object.hasOwn` and `Object.defineProperty`, with tests in `schema-model.spec.ts` and `schema-model.variants.spec.ts`.
- TW-2 (document keys such as `constructor`, `toString` and `__proto__` resolved to `Object.prototype` members): **resolved.** `ownEntry`/`setOwn` (`schema-model.ts:586-599`) and `Object.hasOwn` in `ghostKeys` and `fits`. The five new cases above extend the coverage of this fix.

From the previous (third) round, findings CR-1 to CR-3 below. They were not fixed in code, and the parent recorded their dispositions in `tasks/explorer-copy.md` (assumption of 2026-11-16 20:02).

## Acceptance criteria

- AC1 (copied specs pass in `npm run check`): **met.** I ran `npm run check` at aa8d214 and it passed: lint, type check, root vitest (1530 tests) and renderer `ng test` (437 tests). All copied specs are at `packages/renderer/src/app/explorer/**` and `src/app/schema/**`. Assumption #1 records the cases dropped because JSON Canopy's `samples/` were not vendored.
- AC2 (dev route, tables/form toggle, strict/context search, collapse, edit): **met by a component test.** `dev/explorer-demo.spec.ts` drives the real router (`appConfig.providers`, `RouterTestingHarness`) to `/dev/explorer`. It covers rendering, the layout toggle, strict and context search, collapse/expand, column hiding and an edit that reaches the page's document. It ran in the passing `ng test` run.
- AC3 (root NOTICE lists JSON Canopy, Apache-2.0, Sonensei.ch): **met** (`NOTICE:3-16`).
- AC4 (`vendor/` deleted, no references outside tasks/ and reviews/): **met, with the accepted exception CR-3.** `vendor/` is gone, and its `eslint.config.mjs`/`.prettierignore` entries were removed. The literal grep has one hit, a negative assertion in `notice.spec.ts:59`. The parent's evidence for AC4 should state that one match rather than claim "no matches".

Architecture and integration (unchanged since the first review): `provideRouter(routes, withHashLocation())` with a lazy-loaded dev page. The demo JSON is a static import, so nothing is fetched at runtime. `@angular/router` is pinned like the other Angular packages. `ajv`/`ajv-formats` are MIT licensed and listed in NOTICE. `allowedCommonJsDependencies` is limited to the ajv entry points. The `no-extraneous-class` rule change applies only to `packages/renderer/**/*.ts`. No secrets or credentials are in the diff.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The extracted font files ship without the SIL OFL 1.1 licence text** (disposition: deferred to task `font-license`)
    - File: `packages/renderer/src/assets/fonts/orbitron.woff2`, `packages/renderer/src/assets/fonts/share-tech-mono.woff2`, `NOTICE:30-31`
    - Category: Quality
    - Problem: NOTICE says Orbitron and Share Tech Mono are under the SIL Open Font License 1.1, but the repository and the built `dist/` contain no OFL text and no font copyright lines. OFL 1.1 condition 2 requires them with every distributed copy. JSON Canopy already had this gap. This task made the fonts standalone files, which makes it more visible.
    - Why it matters: the packaged app will redistribute these files.
    - Suggested fix: add the OFL 1.1 text with each font's copyright line next to the fonts and include it in the build output. Status: still present at HEAD (re-checked). Taken over by `tasks/font-license.md`, which depends on `explorer-copy`. Its AC1 covers exactly this fix. The deferral is recorded as an assumption in `tasks/explorer-copy.md`. This disposition is acceptable for a P3, and the finding does not block this task.

- [ ] **CR-2 | ARCHITECTURE still says fonts come from npm packages** (disposition: deferred to task `font-license`)
    - File: `docs/ARCHITECTURE.md:41`, `packages/renderer/src/styles.css:1-5`
    - Category: Quality
    - Problem: `docs/ARCHITECTURE.md` says fonts come from npm packages bundled into `dist/`. They are now committed woff2 files under `src/assets/fonts/`.
    - Why it matters: later tasks (themes, packaging) read ARCHITECTURE as the reference for the font source.
    - Suggested fix: describe the actual font location. Status: still present at HEAD. Taken over by `tasks/font-license.md` AC2, and the deferral is recorded as an assumption. This finding does not block this task.

- [ ] **CR-3 | The AC4 grep still finds `json-master-plugin` in a test** (disposition: accepted)
    - File: `packages/renderer/src/notice.spec.ts:59`
    - Category: Tests
    - Problem: `git grep -n "vendor/\|json-master-plugin" -- ':!tasks' ':!reviews'` returns one match. It is the guard `expect(notice).not.toMatch(/vendor\/|json-master-plugin/)`, not a reference to the path.
    - Why it matters: evidence that claims "grep -> no matches" would be wrong.
    - Suggested fix: none required. The parent accepted the line as a negative assertion (assumption in `tasks/explorer-copy.md`). The AC4 evidence recorded with `tasks.py verify` must mention this one match.

## Review conclusion

No material issues found. Since the previous review, the only code change in the task is 5 test cases in `schema-model.variants.spec.ts`. They are correct, test public behaviour, and 4 of the 5 would catch a regression of the own-property fix (the fifth is a harmless characterisation test). `npm run check` passes at aa8d214. All earlier P1/P2-level findings (round-1 CR-1 to CR-4, TW-1, TW-2) remain resolved. The three P3 findings have recorded dispositions: CR-1 and CR-2 are deferred to task `font-license`, and CR-3 is accepted. The parent should record AC4's evidence with the single accepted grep match.
