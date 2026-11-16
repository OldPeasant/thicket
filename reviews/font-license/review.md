# Code Review

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: task commit a7c0898 (`git diff bec07cb..a7c0898`), committed changes only

Requirements:
- tasks/font-license.md acceptance criteria
- reviews/explorer-copy/review.md findings CR-1 / CR-2 (background)
- docs/ARCHITECTURE.md, AGENTS.md, NOTICE, docs/QUALITY.md
- SIL Open Font License 1.1 (canonical text, condition 2: each copy must contain the copyright notice and the licence)

Git range:
- Branch: main
- HEAD: a7c0898a0f8140dbee470d2ed7f6e2616577b2a3 (task commit; the working copy has since moved on with task-state-only commits)
- Base/start: bec07cbd7a9529b987170bccd01d84fd1f1060e5
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## What was checked

- `packages/renderer/src/assets/fonts/OFL.txt`: the header names each font file with its copyright line and
  Reserved Font Name. The Orbitron line ("Copyright 2018 The Orbitron Project Authors ... Reserved Font
  Name: \"Orbitron\".") and the Share Tech Mono line ("Copyright (c) 2012, Carrois Type Design, Ralph du
  Carrois ... Reserved Font Name 'Share'.") match the upstream OFL notices for those families. The
  licence body (Preamble, Definitions, Permission & Conditions 1-5, Termination, Disclaimer) was read in
  full and matches the canonical OFL 1.1 text word for word. The standard "This Font Software is licensed
  under ..." header is present. The extra provenance paragraph (JSON Canopy 0.4.0) does not alter the
  licence. I could not decompress the woff2 `name` tables in this read-only session to re-extract the
  copyright strings, so that cross-check relies on the upstream notices.
- `packages/renderer/angular.json`: the new assets entry `{ glob: "OFL.txt", input: "src/assets/fonts",
  output: "media" }` sits in the build options, so it applies to production and development builds and
  to `ng serve`. The existing build output in `packages/renderer/dist/` contains `media/OFL.txt`, and it
  is byte-identical to the source file (`cmp`). It sits next to `media/orbitron-*.woff2` and
  `media/share-tech-mono-*.woff2`, which the built `styles-*.css` references by `./media/...`. Criterion 1
  is met.
- `docs/ARCHITECTURE.md:41-45`: the outdated note ("fonts come from npm packages") is replaced. The new
  text gives the committed woff2 location (`src/assets/fonts/`), how the fonts are referenced
  (`styles.css` relative `url()`), where the build puts them (`dist/media/`), and where the licence is
  copied. This matches `src/styles.css` and the actual build output. Criterion 2 is met.
- `NOTICE`: now points to the OFL.txt location. It is consistent with the rest of the file.
- `packages/renderer/src/font-license.spec.ts`: it checks the exact copyright lines, the licence title,
  the section headings, conditions 1-5 and the closing disclaimer sentence, plus the angular.json assets
  entry. Its path handling (`process.cwd()` = packages/renderer) follows `src/no-network.spec.ts`. The spec
  checks the build configuration, not a real build, which is a reasonable unit-level guard. The build
  output was checked separately (above).
- `no-network.spec.ts` scans only `.html/.css/.scss/.ts`, so the `http://scripts.sil.org/OFL` URL in
  OFL.txt does not trip it, and it is not a fetched resource.
- Security: no secrets. The email address in the Share Tech Mono copyright line is part of the
  rights holder's published copyright notice, and the OFL requires it to be kept.

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
