# Code Review

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: round 2, final task code `git diff 1dfcf47..c429a7c` (3 commits), committed changes only. An uncommitted change to `packages/renderer/src/font-license.spec.ts` (concurrent test-writer work) is outside this scope and was not reviewed.

Requirements:
- tasks/font-license.md acceptance criteria and recorded assumption (angular.json assets entry)
- reviews/explorer-copy/review.md findings CR-1 / CR-2 (background)
- docs/ARCHITECTURE.md, AGENTS.md, NOTICE, docs/QUALITY.md
- reviews/font-license/tests.md (TW-1) and reviews/font-license/fixes.md
- SIL Open Font License 1.1 (canonical text; condition 2: each copy must contain the copyright notice and the licence)

Git range:
- Branch: main
- HEAD: c429a7c66c9e52fdb584d3eed3875443dc7ab12b
- Base/start: 1dfcf47d005346393de36220875ea064bbccab2b
- Commits reviewed: 3 (2eb0e2a implementation, a34120f tests and round-1 reports, c429a7c TW-1 fix)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked

- Implementation (2eb0e2a): same content as reviewed in round 1 (rebased onto the new base). `OFL.txt`
  has the header with each font file and its copyright line, the standard "This Font Software is
  licensed under ..." text, and the full OFL 1.1 body (Preamble, Definitions, Permission & Conditions
  1-5, Termination, Disclaimer). It matches the canonical text. `angular.json` adds
  `{ glob: "OFL.txt", input: "src/assets/fonts", output: "media" }` to the build options, so it applies
  to every build configuration. `NOTICE` and `docs/ARCHITECTURE.md:41-45` describe the location
  correctly. Criterion 2 is met.
- TW-1 fix (c429a7c): the trailing period after `Reserved Font Name 'Share'` is removed from
  `OFL.txt:5`, and the matching expectation in `font-license.spec.ts:19` is changed the same way. The
  verbatim test was not weakened. It still requires the whole line `(<font>):\n<embedded>\n`, so a
  truncated or extended notice fails. The Orbitron line keeps its period, which the test-writer
  reports matches its font record.
- Build output: `packages/renderer/dist/media/OFL.txt` (built after the fix, per fixes.md) is
  byte-identical to the source (`cmp`). It sits next to `orbitron-*.woff2` and
  `share-tech-mono-*.woff2`. Criterion 1 is met. OFL.txt names the source files (`orbitron.woff2`)
  rather than the hashed output names. The fonts are still clearly identified, so this is not a
  defect.
- `font-license.spec.ts` `woff2Copyright`: I checked the parser against the WOFF2 format. The header
  offsets are correct (`numTables` @12, `totalCompressedSize` @20, directory @48). The UIntBase128
  decoding is correct. The transform-version rule is correct (glyf/loca are transformed at version 0,
  other tables at versions 1-3). `name` is known-tag index 5. Table offsets are accumulated over
  `transformLength` or `origLength` in the decompressed stream. The record decoding is correct
  (UTF-16BE for platforms 0/3, single-byte for Mac). It throws clearly on a non-WOFF2 file or a
  missing record, rather than passing silently. It does not handle WOFF2 font collections, which is
  irrelevant for the two single fonts. The test reads only the first name-ID-0 record. This is
  enough for the purpose.
- `notice.spec.ts`: the new test checks the NOTICE pointer and that the file exists. The existing
  "refers only to repository paths that exist" test also picks up the new `.../fonts/OFL.txt` path
  and checks it exists. `fonts;` is cut at the semicolon by the regex, as intended.
- Tests follow existing conventions (`process.cwd()` = packages/renderer, as in `no-network.spec.ts`),
  use only Node built-ins (no new dependencies), and stay fast enough for the unit check.
- Security: no secrets. The email address in the Share Tech Mono line is part of the rights holder's
  published copyright notice, which the OFL requires to be kept.

Limitation: in this session I could not run the test suite or decompress the woff2 name tables
myself (command execution beyond read-only inspection was denied). The verbatim-match conclusion
relies on the parser review above and the recorded runs in tests.md / fixes.md
(`ng test` focused 12 passed; `npm run check` passed after the fix).

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
