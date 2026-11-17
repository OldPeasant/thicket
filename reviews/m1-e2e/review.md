# Code Review

Date: 2026-11-17

Task: m1-e2e - M1: End-to-end demo steps 2–7 (second review, final revision after fixes)

Scope: `git diff $(git merge-base HEAD origin/main)..HEAD -- . ':!tasks'` at HEAD aa212b676132096eb77c88869ab2b8503ed4962f, as supplied by the parent worker. Committed changes only. Per the fixer's report, the only source file changed since the first review is `test/e2e/m1/demo.e2e.ts`. The harness changes (`startMongoSpec`, TLS in `initiateReplicaSet`) were reviewed in the first round and were not changed by the fixes.

Requirements:
- tasks/m1-e2e.md acceptance criteria and recorded assumptions
- SPEC.md section 2 (demo script steps 2–7)
- docs/ARCHITECTURE.md and AGENTS.md (evidence, no committed secrets, test keys generated at test time)
- Earlier report (first revision of this file), reviews/m1-e2e/fixes.md, tasks/ui-polish-m1.md

Git range:
- Branch: main
- HEAD: aa212b676132096eb77c88869ab2b8503ed4962f (read from `.git/refs/heads/main`)
- Base/start: merge-base with origin/main, as supplied by the parent worker (first round: 3882e6b4ff401fc9545f810630aaa05e309c7f5d)
- Commits reviewed: the m1-e2e commits up to aa212b6 (62600e2, e07d2f1, 229b77f, aa212b6 per the session's git status)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Commands run and limits of this review

- In this reviewer session, the shell tool was denied. Because of that, `npx playwright test m1`, `git diff`, `git log` and `sha256sum` **could not be run by the reviewer**. This review is based on reading the files directly:
  - read `test/e2e/m1/demo.e2e.ts` in full (final revision);
  - read `tasks/m1-e2e.md` and `tasks/ui-polish-m1.md`;
  - read `reviews/m1-e2e/fixes.md`;
  - viewed all 9 committed PNGs in `reviews/m1-e2e/`.
- Suite execution evidence therefore comes from fixes.md: `npm run test:e2e -- m1` passed twice (1 passed, 11.6s and 11.8s), plus eslint, prettier and `npm run check` all passing. The parent worker should record its own final run of `npm run test:e2e -- m1` with `tasks.py verify` and not cite this review as run evidence.

## Disposition of earlier findings

- **CR-1 (P2, step 4 sort/filter not proven): Resolved.**
  - `DEMO_ID` is now created in `seed()` after the 39,999 other orders are flushed (demo.e2e.ts:141-154). `seed()` asserts with the driver that it is the largest `_id` (:155-160).
  - Step 4 asserts that the demo document is not in the raw text of the default page 1 (:305-309). After filter + sort it asserts:
    - the demo document is the first `ObjectId` on the page (:334);
    - all parsed `total` values are > 100 and in descending order (:335-340);
    - no non-open status appears (:331);
    - the exact count equals the driver's `countDocuments` for the same filter, and that count is below the number of open orders (:344-352). This shows the `$gt` part of the filter is applied.
  - The pager is asserted to stay on page 1 with the demo document first before steps 5–7 (:354-358).
  - The checklist at :35-42 now describes these checks accurately.
  - The screenshots agree:
    - step-4-table.png shows page 3 "101–150 of ~40,000"; its first `_id` (...ed71) is not the demo id;
    - step-4-filter-sort.png shows "1–50 of 7,500 documents" with `_id` ...894c and total 9999.95 first.
- **CR-2 (P3, duplicate screenshot / production box not visible): Resolved.**
  - `step-4-table.png` is now taken on page 3 (:313-320). It visibly differs from step-3-sidebar.png (page 1, `_id` ...ed0d first).
  - New `step-2-production.png` (:256-260) shows "Production" checked and visible.
  - All 9 images show different content when viewed. The reviewer could not re-run `sha256sum`; fixes.md reports 9 distinct hashes.
- **CR-3 (P3, UI defects without follow-up task): Resolved.**
  - `tasks/ui-polish-m1.md` exists with acceptance criteria for the rounded Test connection latency and for the status bar connection state.
  - It references the m1 screenshots and requires the m1 e2e suite to keep passing.

## Acceptance criteria

1. **`npm run test:e2e -- m1` passes; Business light screenshots of each step committed under reviews/m1-e2e/.**
   - Screenshots: met. Steps 2 (two shots), 3, 4 (two shots), 5, 6 (two shots) and 7 are present. All show the Business style in light mode, which the test sets and asserts on `html[data-style]`/`[data-theme]` (:220-231).
   - Security: the password is masked in every shot (step-2-connection-form.png shows `****` in the URI preview and dots in the field). Only a generated user name and a temporary CA path are visible.
   - Suite pass: the reviewer could not run it (see the limits above). The fixer's two recorded passing runs support it, and the parent worker must record its own run.
2. **Human-readable checklist maps each step to the SPEC demo script: met.** The checklist is at demo.e2e.ts:24-57, with one entry per SPEC step 2–7. Each entry gives the SPEC wording and what the test does, and it matches the final assertions.

## New issues checked, none found

- Possible race in step 4: the reviewer checked whether the post-query assertions could read stale page-3 text.
  - `rows` is awaited to have the exact text `1–50` before the checks (:326), and the raw view is awaited to contain `DEMO_ID` (:329).
  - Default order puts `DEMO_ID` on the last page (~800), so it cannot appear on page 3.
  - The `textContent` read at :330 therefore sees the query result, not stale page-3 content.
- `totals` parsing (:335) matches only top-level `total: NumberDecimal(...)` fields. Nested `items` have no `total`, so the check is not polluted.
- Seed data does produce open orders with total ≤ 100, so `expected < open` holds and the count check can tell the filters apart. This matches fixes.md: 7,500 of 10,000 open orders.
- No secrets or keys were added. The user and password are generated at test time (:165-175), and the password is asserted absent from `connections.json`, `secrets.bin` and the URI preview.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. CR-1, CR-2 and CR-3 from the first review are resolved in the final code and the committed screenshots, and both acceptance criteria are met on code inspection. Caveat: this reviewer session could not run the Playwright suite or git (the shell tool was denied). Before `done`, the parent worker must record its own `npm run test:e2e -- m1` run as the evidence for criterion 1.
