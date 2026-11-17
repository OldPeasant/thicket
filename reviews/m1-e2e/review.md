# Code Review

Date: 2026-11-17

Task: m1-e2e - M1: End-to-end demo steps 2–7

Scope: `git diff 3882e6b4ff401fc9545f810630aaa05e309c7f5d..49d9eabb515aa6b03f1a7626a4637aa306191efc -- . ':!tasks'` (committed changes only; no uncommitted changes at review start)

Requirements:
- tasks/m1-e2e.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md section 2 (demo script steps 2–7), section 7 (e2e with Playwright)
- docs/ARCHITECTURE.md (e2e layout, collection tab, doc paging, write safety, secrets)
- AGENTS.md (evidence, no committed secrets, test certificates generated at test time)
- Conventions of the existing e2e suites (test/e2e/collection.e2e.ts, connections.e2e.ts, harness/)

Git range:
- Branch: main
- HEAD: 49d9eabb515aa6b03f1a7626a4637aa306191efc
- Base/start: 3882e6b4ff401fc9545f810630aaa05e309c7f5d
- Commits reviewed: 2 (01dcbd2, 49d9eab)

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## Commands run

- `git log --oneline 3882e6b4..HEAD`, `git diff --stat` / `git diff 3882e6b4..HEAD -- test/e2e/harness test/integration` -> 2 commits; 4 source files, 8 PNGs
- `sha256sum reviews/m1-e2e/*.png` -> 8 files; step-3-sidebar.png and step-4-table.png are byte-identical
- Viewed step-2, step-3, step-4-filter-sort, step-6-production-confirm, step-7-conflict screenshots -> Business style, light mode; password masked; only a generated user name and a temp CA path visible
- `npx playwright test m1` (headless, against the existing build; this task changes no app code) -> 1 passed (13.5s)
- `python tasks.py verify m1-e2e` -> both criteria not yet recorded (parent worker's step)

## Acceptance criteria

1. Suite passes; Business light screenshots of each step committed under reviews/m1-e2e/: suite passes in this review's run; 8 screenshots cover steps 2–7; style/mode are set via `app.settings.set` and asserted on `html[data-style]`/`[data-theme]` before any step. Met (evidence still to be recorded with `tasks.py verify`).
2. Human-readable checklist maps each step to the SPEC demo script: present at test/e2e/m1/demo.e2e.ts:24-51, one entry per step 2–7 quoting the SPEC step and what the test does. Met, with the inaccuracy in CR-1.

Other checks with no finding: the harness change (`startMongoSpec`) keeps `startMongo` behaviour identical; the `initiateReplicaSet` TLS option is backward compatible (no existing fixture combines `replicaSet` and `tls`, and `FIXTURE_NAMES` is unchanged); the temp CA dir is removed by `stop()` (in `finally`) and on start failure; `afterAll` stops the server also when seeding fails because `server` is assigned before `seed`; the user password is generated at test time (`randomBytes`), is asserted absent from `connections.json` and from the URI preview, and no credentials or keys are committed; skip-without-container-runtime matches the harness pattern.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Step 4 sort and `total > 100` filter are not actually verified; checklist claims they are**
    - File: `test/e2e/m1/demo.e2e.ts:81`, `test/e2e/m1/demo.e2e.ts:295-299` (checklist claim at :36-37)
    - Category: Tests
    - Problem: The checklist says "filter + sort `{total: -1}` -> the first document is the largest open order", but the test only checks that the raw view *contains* `DEMO_ID` and no non-open status. `DEMO_ID = new ObjectId()` is created at module load, before every seeded `_id`, so it is the smallest `_id` in the collection and is already the first document under the default paging sort `{_id: 1}` (the step-3 screenshot shows it as row 1 before any filter). A sort that is ignored, or applied ascending on page 1 of `{_id: 1}`-ordered results, still passes. No assertion checks the `total > 100` part of the filter either. Step 5 (`.first()` document) and steps 6–7 rely on the same accidental ordering.
    - Why it matters: SPEC step 4 "Enter a filter ... and a sort; results update" is the demo's query step; the suite would stay green if sort handling were broken, so it is weaker evidence than the checklist states.
    - Suggested fix: Give the demo document an `_id` that is not first in `_id` order (e.g. create it after the bulk seed), and assert that the first few `total` values in the raw view are descending and all `> 100` (e.g. parse the `NumberDecimal("...")` values from `raw-text`), so the first document being `DEMO_ID` actually proves the sort.

## P3 Low

- [ ] **CR-2 | Step 3 and step 4 "table" screenshots are the same image; step 2 shot does not show the production mark**
    - File: `reviews/m1-e2e/step-3-sidebar.png`, `reviews/m1-e2e/step-4-table.png` (taken at `test/e2e/m1/demo.e2e.ts:269` and `:281`); `reviews/m1-e2e/step-2-connection-form.png` (`:243`)
    - Category: Quality
    - Problem: The two files are byte-identical (same sha256): the collection tab opens in Table view, so clicking `view-table` changes nothing. The step-2 screenshot is taken at the top of the form, so the checked "Production" box is below the fold (the red accent appears only from step 3 on).
    - Why it matters: Reviewers reading the screenshots get one fewer distinct view than the file names suggest, and step 2's "mark production" is not visible in its own shot.
    - Suggested fix: Drop one of the duplicate shots, and scroll `field-production` into view (or take a second step-2 shot) before the step-2 screenshot.

- [ ] **CR-3 | Product defects seen in the committed screenshots are recorded only as an assumption, not as a task**
    - File: `tasks/m1-e2e.md` (assumption #3); visible in `reviews/m1-e2e/step-2-connection-form.png` ("Connected in 2.1195470000000114 ms") and in every later screenshot (status bar "No connection" while the production connection is open)
    - Category: Quality
    - Problem: Both are real UI defects on the M1 demo path; they are noted as out of scope (correctly for this task), but no follow-up task exists (searching tasks/ finds them only in m1-e2e.md).
    - Why it matters: Assumptions are reviewed as decisions, not as a bug backlog; the defects may be lost.
    - Suggested fix: Parent worker to file a task (`python tasks.py new ...`) for the unrounded test-connection time and the status bar connection state.

## Review conclusion

No material issues found. The suite passes and both acceptance criteria are met. CR-1 is a non-blocking gap in test strength that is cheap to fix and would make the step-4 evidence match the checklist. CR-2 and CR-3 are optional cleanups.
