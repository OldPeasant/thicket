# Code Review

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: `git diff 5c13e8ab9c70388cbd7c7018bb83237d8b0871b3..f7c02aab97e33cad41ea075f1d8f8aadff5f1a2b` (committed changes only). Moved files were compared with their originals at `c0d4dca` (`vendor/json-canopy/src/app/...`) using `git diff -M c0d4dca f7c02aa -- <old> <new>`, `git diff -M -w`, and a whitespace-normalised comparison of every component template, so that only real edits were reviewed and Prettier reformatting was set aside.

Requirements:
- `tasks/explorer-copy.md` (goal and 4 acceptance criteria) and the 5 recorded assumptions (`python tasks.py assumptions`)
- `SPEC.md` (M0 explorer requirement, themes, renderer security), `docs/ARCHITECTURE.md` (renderer, no-network rule, CSP), `docs/QUALITY.md`, `AGENTS.md`
- Parent instructions (focus list, TW-1 in `reviews/explorer-copy/tests.md`)

Git range:
- Branch: main
- HEAD: f7c02aab97e33cad41ea075f1d8f8aadff5f1a2b
- Base/start: 5c13e8ab9c70388cbd7c7018bb83237d8b0871b3
- Commits reviewed: 4 (754fd20 move, 06b52ad strict-mode fixes, 073258c dev route/NOTICE/docs, f7c02aa tests)
- Uncommitted changes: none at review time (working tree clean)

Commands run:
- `npm run check` (repo root) -> pass: eslint `--max-warnings 0` and `prettier --check` clean; typecheck (root tsc, every workspace, renderer `ngc` + spec `tsc`) clean; root Vitest 5 files / 599 tests passed; renderer `ng test` 22 files / 275 tests passed.
- `git grep -n "vendor/\|json-master-plugin" -- ':!tasks' ':!reviews'` -> no matches; `ls vendor` -> does not exist.
- `python tasks.py verify explorer-copy` -> all 4 criteria still unticked (the parent records evidence later; not a finding).
- Not run: `npm run build -w packages/renderer` and any browser/Electron run (no browser binary available in this clone; outside the commands the parent allowed).

Summary: 0 P0, 0 P1, 1 P2, 3 P3

## Acceptance criteria

- AC1 (copied specs pass in `npm run check`): met. All copied specs run in `ng test` and pass. The samples-based cases of `schema-model.spec.ts` (and some of `layout.util.spec.ts` / `form-fields.util.spec.ts`) were dropped or switched to inline fixtures because only `canopy-demo.json` was vendored; this is recorded as assumption #1 and partly compensated by the new `schema-model.variants.spec.ts`.
- AC2 (dev route, tables/form toggle, strict/context search, collapse, edit): met by component test. `dev/explorer-demo.spec.ts` drives the real router (`appConfig.providers`, `RouterTestingHarness`) to `/dev/explorer` and checks render, toggle, strict and context search, collapse/expand, column hiding and an edit that reaches the page's document. The criterion allows a component test.
- AC3 (root NOTICE lists JSON Canopy, Apache-2.0, Sonensei.ch): met (`NOTICE:6-11`). See CR-3 for two small wording points.
- AC4 (`vendor/` deleted, no references outside tasks/ and reviews/): met. `vendor/**` entries were removed from `eslint.config.mjs` and `.prettierignore`; BRIEF.md and the AGENTS.md project note were updated (assumption #5).

## Behaviour preservation of the strict-mode edits

Checked against the originals at `c0d4dca`; no regression found:
- `schema.service.ts` `memo()`: same has/get/set semantics as the former `if (!m.has(k)) m.set(...); return m.get(k)!`, including cached `false`/empty answers.
- `schema-model.ts` index guards (`narrow`, `discriminatorOf`, `metaAt`, `seedItem`, `variantsAt`, `switchVariant`, `seed`, `closestVariantProblems`): each new guard only triggers where the original indexed `undefined` (and would have thrown or produced `undefined`); `fits = !declared || ...` matches the original, where `allowed` was already falsy when `declared` was missing; the `reduce` with `?? Infinity` picks the same index. `mergeTwo` `existing ?` versus `name in merged`: equivalent for every value a schema property can hold (see CR-4 for the pre-existing inherited-key quirk).
- `json-edit.util.ts` `withoutEntry`: `Object.fromEntries(Object.entries(...).filter(...))` keeps key order and copies an own `__proto__` key as data, like spread + `delete`.
- `json-lines.component`: `EMPTY_DOC` fallback only replaces a non-null assertion; `@if (lines[i]; as line)` is always true for a real `JsonLine` object, so rendering is unchanged.
- `problem-index.ts` `seg === undefined` guard and `column-sync.service.ts` `?? ''`: unreachable for valid input, no behaviour change.
- Templates: whitespace-normalised comparison shows only reformatting, plus `rootProblems[0]?.message ?? ''` in `json-form` and the `json-lines` `@if`. `highlight.component` was reformatted over several lines; Angular's default whitespace removal keeps `<mark>`/`<span>` adjacent (the demo spec's `'Grace Hopper'` assertion confirms no gap is inserted).
- `host-bridge.service.ts` had no uses in the vendored copy; deleting it removed nothing else.

Router: `provideRouter(routes, withHashLocation())`, `<base href="./">` unchanged, lazy `loadComponent` for the dev page, `**` redirects to `''`. Fine for Electron `loadFile` (assumption #2). The demo JSON is a static module import, so no fetch and nothing for the CSP to block. `@angular/router` matches the other Angular pins (`~22.2.6`); `ajv`/`ajv-formats` are MIT and listed in NOTICE; `allowedCommonJsDependencies` only silences the CJS warning for those three entry points. The new eslint rule (`no-extraneous-class` with `allowWithDecorator`) is scoped to `packages/renderer/**/*.ts`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | The inlined Tron fonts are blocked by the renderer CSP**
    - File: `packages/renderer/src/styles.css:6-22`, `packages/renderer/src/index.html:12`
    - Category: Integration
    - Problem: the copied `@font-face` rules load Orbitron and Share Tech Mono from `url(data:font/woff2;base64,...)`. The renderer CSP is `... font-src 'self'`, and `no-network.spec.ts:107` requires exactly that. Under CSP, `'self'` does not match the `data:` scheme, so Chromium (Electron and `ng serve`) refuses both fonts, logs a CSP violation for each, and falls back to other fonts. The header comment added at `styles.css:1-5` says the fonts are inlined "so the app works fully offline", but with this CSP they never load. `docs/ARCHITECTURE.md:41` also says fonts "come from npm packages bundled into `dist/`", which `'self'` would allow. This is derived from CSP semantics and the committed files; it was not observed in a browser, because none is available in this clone.
    - Why it matters: the task moves "the Tron tokens and inlined fonts", and SPEC.md defines the Tron style by Orbitron and Share Tech Mono. As committed, the fonts are dead weight (about 37 KB of base64 in the initial global stylesheet), and the comment tells the next task (themes) that they work.
    - Suggested fix: serve the two woff2 files from the app's own origin (for example from an npm font package or files under `public/`, referenced by a relative `url()`), so `font-src 'self'` matches, as ARCHITECTURE.md says. Alternatively, add `data:` to `font-src` and update `no-network.spec.ts` and the ARCHITECTURE CSP text in the same change. If it is left for the themes task, correct the comment and record the deferral with `tasks.py assume`.

## P3 Low

- [ ] **CR-2 | Stale IntelliJ/IDE host comments in the copied code**
    - File: `packages/renderer/src/styles.css:28-34`, `packages/renderer/src/app/explorer/services/edit-mode.service.ts:28-31`, `packages/renderer/src/app/explorer/services/schema.service.ts:49`
    - Category: Quality
    - Problem: the comments still describe the IntelliJ host (`JBColor.isBright()`, `ThemeSync.kt`, "Called by the IntelliJ host bridge", origin `'IDE settings'`). The task removed the host bridge, so these callers no longer exist.
    - Why it matters: future tasks that wire theming, read-only files and schema loading into Thicket will look for callers that are not there.
    - Suggested fix: rewrite the three comments to describe Thicket's situation (for example, "set by the host when the document is read-only"; theme set by the themes task), or remove the host-specific parts.

- [ ] **CR-3 | NOTICE wording: unsourced Thicket copyright line, and modifications not stated**
    - File: `NOTICE:1-4`, `NOTICE:6-11`
    - Category: Quality
    - Problem: (a) `Thicket / Copyright 2026 Sonensei.ch` names a copyright holder for the whole project. Nothing else in the repository (README, package.json, LICENSE, SPEC, BRIEF) states that, and no assumption records it. (b) The NOTICE says the explorer code "originate[s] from JSON Canopy", but this task modified those files (strict-mode rewrites, removed host bridge, dropped spec cases). Apache-2.0 section 4(b) asks that modified files carry a notice that they were changed.
    - Why it matters: attribution and licence text are what the AC is about, and a human will rely on it when publishing. Both points are cheap to settle now.
    - Suggested fix: record the project copyright holder as an assumption, or confirm it with the human. Add one sentence such as "modified for Thicket (strict TypeScript/lint fixes, IDE host bridge removed)" to the JSON Canopy paragraph.

- [ ] **CR-4 | `mergeTwo` treats inherited `Object.prototype` names as existing properties (pre-existing, TW-1)**
    - File: `packages/renderer/src/app/schema/schema-model.ts:566-570`
    - Category: Correctness
    - Problem: I confirmed the test-writer's TW-1. `merged` is a plain object, so `merged[name]` is truthy for `toString`, `constructor` and similar, and the result is `{ allOf: [<function>, schema] }`. The original `name in merged` behaved the same, so this is not a regression. One case goes beyond TW-1: when only `b` declares a property named `__proto__` (possible with `JSON.parse`d schemas), the assignment `merged['__proto__'] = { allOf: [Object.prototype, schema] }` changes the prototype of `merged` and does not create the property, so that property silently disappears. Only that local object is affected (no global prototype pollution). Schema support is not wired to anything yet (assumption #4).
    - Why it matters: low today. It becomes a real defect once user-loaded schemas reach `resolve`.
    - Suggested fix: use `Object.hasOwn(merged, name)` and build `merged` with `Object.create(null)` (or `Object.fromEntries`), when schema support is wired up or now, as a one-line change with a test. Deferring it to the task that enables schema validation is acceptable.

## Review conclusion

Material issues found; fix before completing the task. All four acceptance criteria are met and `npm run check` passes. The strict-mode rewrites keep JSON Canopy's behaviour. There are no P0/P1 findings. The one P2 (CR-1: the CSP blocks the inlined fonts that this task moved in) should be fixed, or explicitly deferred to the themes task with a corrected comment and a recorded assumption, before `done`. The P3s can be accepted or deferred.
