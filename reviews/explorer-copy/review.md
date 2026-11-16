# Code Review

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: final review after two fix rounds. Committed changes only: `git diff 0f9b769fb2cda1eaa202c0a12bff695444d181fa..14e79e9e012a871faa0829b5ee7ebe548ae8683f` (the task's 7 commits on top of `git merge-base HEAD origin/main`). Moved files were compared with the originals at `c0d4dca` (`vendor/json-canopy/...`) using rename detection, and reformatting was set aside. While this review was running, the parent rebased the task onto a newer main: HEAD moved from `4fef12e` (base `6a69dda`) to `14e79e9` (base `0f9b769`). `git diff --stat 4fef12e 14e79e9` shows only `tasks/explorer-copy.md` and `tasks/shell-syntax.md`, so the reviewed code is identical in both revisions.

Reviewed revision: `14e79e9e012a871faa0829b5ee7ebe548ae8683f` (code-identical to `4fef12ed5c3b2980dae0f6070dfdb08a332bdc94`)

Requirements:
- `tasks/explorer-copy.md` (goal, 4 acceptance criteria, 5 recorded assumptions)
- `SPEC.md`, `docs/ARCHITECTURE.md` (renderer, no-network rule, CSP), `docs/QUALITY.md`, `AGENTS.md`
- Earlier reports `reviews/explorer-copy/review.md` (CR-1..CR-4), `tests.md` (TW-1, TW-2) and `fixes.md`
- Parent instructions (final review, verify that earlier findings are resolved)

Git range:
- Branch: main
- HEAD: 14e79e9e012a871faa0829b5ee7ebe548ae8683f (code-identical to 4fef12ed5c3b2980dae0f6070dfdb08a332bdc94)
- Base/start: 0f9b769fb2cda1eaa202c0a12bff695444d181fa (was 6a69ddaa7b6191e1207cc35797e029d7e889beb5 before the rebase)
- Commits reviewed: 7 (8dff140 move, 6e48533 strict-mode fixes, c2812e5 dev route/NOTICE/docs, 04a0655 tests, d118053 fonts/NOTICE/mergeTwo fix, b78656b font/NOTICE/prototype-key tests, 14e79e9 own-property lookups). Before the rebase these were e870ea1, 737bd4d, 6e1ad98, 0b68061, 36d2e1e, 299d287 and 4fef12e.
- Uncommitted changes: at the end of the review, `packages/renderer/src/app/schema/schema-model.variants.spec.ts` was modified in the working tree, presumably by a concurrently running helper. This change is outside the committed scope and was not reviewed.

Commands run (read-only):
- `git log`, `git diff -M --stat`, `git show` on the fix commits, `git diff --stat 4fef12e 14e79e9`
- `git grep -n -i "intellij|jbcolor|themesync|host bridge|host-bridge|IDE settings|cefQuery|jcef" -- packages/renderer` returned only the expected `notice.spec.ts:32` assertion.
- `git grep -n "vendor/\|json-master-plugin" -- ':!tasks' ':!reviews'` returned only `packages/renderer/src/notice.spec.ts:59` (see CR-3). `ls vendor` reports that the folder does not exist.
- `git grep -il "open font license|OFL|Reserved Font Name" HEAD` found no OFL licence text in the repository (see CR-1).
- `python tasks.py verify explorer-copy` shows all 4 criteria still unticked. The parent records the evidence later, so this is not a finding.
- Not run: `npm run check`, the build and a browser. The working tree contained another helper's uncommitted spec change, so a run would not have tested the committed revision. The parent has to run the final validation.

Summary: 0 P0, 0 P1, 0 P2, 3 P3

## Earlier findings: resolution check

- CR-1 (CSP `font-src 'self'` blocked the inlined `data:` fonts): **resolved.** `styles.css:7-21` loads `url('./assets/fonts/orbitron.woff2')` and `url('./assets/fonts/share-tech-mono.woff2')`. No `data:` URL remains. The CSP in `src/index.html:12` is unchanged (`font-src 'self'`). The file sizes (11800 and 13500 bytes) match the WOFF2 length fields in the headers of the original base64 payloads at `c0d4dca` (`0x2E18` for Orbitron, `0x34BC` for Share Tech Mono), so the fonts were extracted without truncation. `styles.spec.ts` covers the relative URLs, the existence of the files and the `wOF2` signature. Only one leftover remains: the ARCHITECTURE wording (CR-2 below).
- CR-2 (stale IntelliJ/IDE host comments): **resolved.** `edit-mode.service.ts:28-31` and `schema.service.ts:49` were reworded, and the `styles.css` theme comment no longer mentions JBColor or ThemeSync. The grep above finds no remaining host references.
- CR-3 (NOTICE copyright line, modifications not stated): **resolved.** `NOTICE:1-16` no longer claims a Thicket copyright holder. It names JSON Canopy 0.4.0 (Apache-2.0, Copyright 2026 Sonensei.ch) as the origin and lists the modifications (Apache-2.0 §4(b)). It also keeps the original JSON Canopy NOTICE text. `notice.spec.ts` covers this.
- CR-4 / TW-1 (`mergeTwo` treated inherited names and `__proto__` as existing properties): **resolved.** `schema-model.ts:566-577` uses `Object.hasOwn` and `Object.defineProperty`. `schema-model.spec.ts:31-47` and `schema-model.variants.spec.ts:277-383` cover it.
- TW-2 (document keys such as `constructor`, `toString` and `__proto__` resolved to `Object.prototype` members): **resolved.** `ownEntry` and `setOwn` (`schema-model.ts:586-599`) are used in `ownChild` (and so in `permits`, `childrenOf`, `nodesAt`, `typesAt` and `permitsKey`), `seed`, `switchVariant` and `selectorValues`. The `in` checks in `ghostKeys` and `fits` became `Object.hasOwn`. I checked the remaining sites. `declaredKeysAt`, `ghostKeys`, `patternProperties` and `discriminatorOf` iterate with `Object.entries`/`Object.keys` and so see only own keys. `'default' in schema` checks a key that `Object.prototype` does not define. The object literal `{ [info.property]: to }` in `switchVariant` uses a computed key, which creates an own property even for `__proto__`. The `$ref` walk in `lookup` was deliberately left alone (`fixes.md`), and an inherited function there already ends as "unresolved $ref". The fix leaves the behaviour for ordinary keys unchanged.

## Acceptance criteria

- AC1 (copied specs pass in `npm run check`): the code supports it. All copied specs are present at `packages/renderer/src/app/explorer/**` and `src/app/schema/**`. Assumption #1 records the cases dropped because JSON Canopy's `samples/` were not vendored. I did not run `npm run check` (see Commands run). The parent must record that run as the evidence.
- AC2 (dev route, tables/form toggle, strict/context search, collapse, edit): met by a component test. `dev/explorer-demo.spec.ts` drives the real router (`appConfig.providers`, `RouterTestingHarness`) to `/dev/explorer`. It checks the rendering, the layout toggle, strict and context search, collapse/expand, column hiding, and an edit that reaches the page's document. The criterion allows a component test.
- AC3 (root NOTICE lists JSON Canopy, Apache-2.0, Sonensei.ch): met (`NOTICE:3-16`).
- AC4 (`vendor/` deleted, no references outside tasks/ and reviews/): `vendor/` is gone, its entries in `eslint.config.mjs` and `.prettierignore` were removed, and `AGENTS.md` and `BRIEF.md` were updated (assumption #5). The literal grep still has one match in a test (CR-3).

Architecture and integration (unchanged since the first review, re-checked): the router uses `provideRouter(routes, withHashLocation())` and lazy-loads the dev page. The demo JSON is a static import, so nothing is fetched. `@angular/router` is pinned like the other Angular packages (`~22.2.6`). `ajv`/`ajv-formats` are MIT licensed and listed in NOTICE. `allowedCommonJsDependencies` is limited to the three ajv entry points. The `no-extraneous-class` rule change applies only to `packages/renderer/**/*.ts`. No secrets or credentials are in the diff.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The extracted font files ship without the SIL OFL 1.1 licence text**
    - File: `packages/renderer/src/assets/fonts/orbitron.woff2`, `packages/renderer/src/assets/fonts/share-tech-mono.woff2`, `NOTICE:30-31`
    - Category: Quality
    - Problem: NOTICE says Orbitron and Share Tech Mono are under the SIL Open Font License 1.1. However, no OFL licence text or font copyright line exists anywhere in the repository (`git grep -il "open font license|OFL"` finds only NOTICE, the specs, `styles.css` comments and lockfiles). Angular's `3rdpartylicenses.txt` only covers npm packages, so the built `dist/` does not contain the OFL either. OFL 1.1 condition 2 requires every distributed copy of the font software to include the copyright notice and the licence. This gap already existed in JSON Canopy, which inlined the fonts. This task turned them into standalone font files (`dist/media/*.woff2`), which makes the gap more visible.
    - Why it matters: `main` is published, and the packaged app will redistribute these files. The licence obligation is cheap to meet now and easy to forget later.
    - Suggested fix: add `packages/renderer/src/assets/fonts/OFL.txt` with the OFL 1.1 text and each font's copyright line from its upstream release, and reference it from NOTICE. Alternatively, record a deferral to the themes task (which may switch to npm font packages that bring their own licence files) with `tasks.py assume`.

- [ ] **CR-2 | ARCHITECTURE still says fonts come from npm packages**
    - File: `docs/ARCHITECTURE.md:41`, `packages/renderer/src/styles.css:1-5`
    - Category: Quality
    - Problem: `docs/ARCHITECTURE.md:41` says "fonts come from npm packages bundled into `dist/`". After the CR-1 fix, the fonts are committed woff2 files under `src/assets/fonts/`. The `styles.css` header comment says this, and that "the themes task may switch to npm font packages". No assumption records the deviation from the documented approach (the five recorded assumptions predate the fix).
    - Why it matters: ARCHITECTURE is the reference that later tasks (themes, packaging) read for the font source. It now describes a setup that does not exist.
    - Suggested fix: change the line to say that fonts are bundled from files in the app (currently `src/assets/fonts/`) or from npm packages, never from a CDN. Alternatively, record the choice with `python tasks.py assume explorer-copy "..."`.

- [ ] **CR-3 | The AC4 grep still finds `json-master-plugin` in a test**
    - File: `packages/renderer/src/notice.spec.ts:59`
    - Category: Tests
    - Problem: AC4 says "grep shows none outside tasks/ and reviews/". `git grep -n "vendor/\|json-master-plugin" -- ':!tasks' ':!reviews'` returns one match: the negative assertion `expect(notice).not.toMatch(/vendor\/|json-master-plugin/)`, added in b78656b after the first review. This line is a guard, not a reference to the path, but it makes the literal grep that the criterion names non-empty.
    - Why it matters: evidence for AC4 that claims "grep -> no matches" would be wrong. A human repeating the grep would see a hit and have to work out whether it matters.
    - Suggested fix: either build the pattern without the literal token (for example `new RegExp(['json', 'master', 'plugin'].join('-'))`), or keep the line and record the evidence as "one match, the negative assertion in notice.spec.ts:59".

## Review conclusion

No material issues found. All earlier findings (CR-1 to CR-4, TW-1, TW-2) are resolved in the final code. The strict-mode rewrites keep JSON Canopy's behaviour, and the acceptance criteria are supported by the code and the tests. The three P3 findings (missing OFL licence text, a stale ARCHITECTURE line, and the literal AC4 grep hit in a test) can be fixed or accepted by the parent. The parent still has to run `npm run check` on the committed revision and record the evidence for each criterion.
