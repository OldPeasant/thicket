# Code Review

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: round 3, final task code `git diff 1dfcf47..45adc25` (4 commits), committed changes only. The full task diff was reviewed in round 2 (up to c429a7c). This round reviews the only code change since then, `git diff c429a7c..45adc25 -- packages/renderer/src`, and confirms the rest is unchanged. The working tree was clean.

Requirements:
- tasks/font-license.md acceptance criteria and recorded assumption (angular.json assets entry)
- reviews/explorer-copy/review.md findings CR-1 / CR-2 (background)
- docs/ARCHITECTURE.md, AGENTS.md, NOTICE, docs/QUALITY.md
- reviews/font-license/tests.md and reviews/font-license/fixes.md
- SIL Open Font License 1.1 (canonical text; condition 2: each copy must contain the copyright notice and the licence)

Git range:
- Branch: main
- HEAD: 45adc25d0f3b73ca511e678e3ca404b06a881257
- Base/start: 1dfcf47d005346393de36220875ea064bbccab2b
- Commits reviewed: 4 (2eb0e2a implementation, a34120f tests and round-1 reports, c429a7c TW-1 fix, 45adc25 whole-line copyright test and round-2 reports)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked

- Change since round 2 (45adc25): `git diff --stat c429a7c 45adc25` touches only
  `packages/renderer/src/font-license.spec.ts` (6 lines) plus `reviews/font-license/review.md` and
  `tests.md`. `OFL.txt`, `angular.json`, `NOTICE`, `docs/ARCHITECTURE.md` and `notice.spec.ts` are
  unchanged, so the round-2 findings for them still hold.
- In the test `names the copyright holder of each bundled font`, `expect(ofl).toContain(...)` (a substring
  match) is replaced by `expect(ofl.split(/\r?\n/)).toContain(...)`. On an array, Vitest's `toContain`
  checks for an exact element, so it now matches whole lines. This makes the test stricter. A notice with an
  extra or missing character at either end now fails. The previous substring match would have accepted,
  for example, the old trailing-period variant of the Share line. The `\r?\n` split also tolerates CRLF
  checkouts. The comment explains why.
- I confirmed with Node against the current `OFL.txt` (ASCII text): both expected lines are present as
  whole lines (lines 2 and 5). The variant `... Reserved Font Name 'Share'.` (trailing period) is not a
  line, so the test would catch a regression of TW-1.
- No other test changed. The verbatim name-table test and the build-output test are as reviewed in round 2.

From round 2, still valid for the unchanged files: `OFL.txt` contains the full canonical OFL 1.1 text
with each font's copyright line. `angular.json` copies it to `dist/media/` next to the hashed woff2
files (criterion 1). `docs/ARCHITECTURE.md` and `NOTICE` describe the font location (criterion 2). The
WOFF2 name-table parser in the spec is correct for these single fonts. No secrets were found, and no
dependencies were added.

Limitation: I did not run the full `ng test` suite in this round. The conclusion relies on the Node check
above and the test-writer's recorded runs in tests.md.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.
