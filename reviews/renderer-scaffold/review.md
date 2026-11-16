# Code Review

Date: 2026-11-16

Task: renderer-scaffold (M0: Angular renderer workspace)

Scope: `git diff 177498f..HEAD -- . ':!tasks' ':!reviews'` at the committed HEAD, second review on the final code. I checked package-lock.json only for unintended version changes and for the engines entry. Uncommitted test-writer edits in the working tree were not reviewed.

Requirements:
- tasks/renderer-scaffold.md acceptance criteria and recorded assumptions
- SPEC.md (section 6 security: strict CSP, no remote content; section 7 testing)
- docs/ARCHITECTURE.md (stack, renderer, install, coverage)
- AGENTS.md, docs/QUALITY.md, parent agent instructions
- Previous review (CR-1, CR-2) and reviews/renderer-scaffold/fixes.md

Git range:
- Branch: main
- HEAD: 775834532a404883faa46707bea88318bd04c7c5
- Base/start: 177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f
- Commits reviewed: 4 task commits (7b0d988, b52fc6e, 36fd6cc, 7758345). The range also holds claim/heartbeat commits and a2604f3 (`.claude/settings.json` denies ScheduleWakeup). a2604f3 is TFP infrastructure, not part of this task, and was not reviewed as task code.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Verification of earlier findings

- CR-1 (root `engines` too loose): fixed. `package.json:9` now reads `"node": ">=24.15.0 <25"`. The lockfile root entry (`package-lock.json:31`) matches. docs/ARCHITECTURE.md "Install (development)" and the install table now say Node 24.15.0+ and give the reason. This matches the `^24.15.0` requirement of `@angular/core`, `@angular/build` and `jsdom` 31 that I found in the first review.
- CR-2 (no-network guard misses bindings and `srcset`): fixed. In `packages/renderer/src/no-network.spec.ts:19-20`, `REMOTE` now accepts an optional `]` before `=` and an optional single quote after the opening quote, so it matches `[src]="'https://...'"` and `[attr.href]="'//...'"`. A separate `srcset` alternative matches a remote URL in the first or a later candidate. I traced the regex by hand. The lazy `[^"'>]*?` cannot cross a quote or `>`, so a URL in another attribute after a local `srcset` is not flagged. Binding to a field (`[src]="logoUrl"`) and a local literal are not flagged either. The spec adds positive and negative fixtures for each new pattern. No existing fixture was removed or weakened.

## Notes (not findings)

- Whole-task re-review: angular.json (`baseHref: "./"`, `outputPath.browser: ""`, `optimization.fonts: false`, unit-test builder with the Vitest runner), the zoneless `appConfig`, the OnPush root component with a signal, `index.html` with the CSP meta tag, the tsconfig split (app/spec with `strictTemplates`), the root `test` script chaining `ng test`, and the removal of the renderer from the root Vitest projects all match the task, the recorded assumptions and docs/ARCHITECTURE.md. The fix commit introduced no regressions.
- The root component test (`app.spec.ts`) runs through `npm run test`, which `npm run check` runs. That satisfies criterion 3.
- Criterion 1 (file://): as in the first review, only the build structure has been verified, not an Electron load (assumption #2). Record the evidence that way.
- Criterion 2 (`ng serve`): the evidence must come from an actual run of `npm run dev -w packages/renderer`. I could not run it in this review.
- docs/ARCHITECTURE.md says the no-network spec covers `src`/`href`/`url()`/`@import`. It now also covers `srcset` and Angular bindings. The doc only lists fewer cases, and nothing in it is wrong, so this is not a finding.
- This pass ran no commands beyond read-only git inspection. The fixer reports `npm run check` passing (2 renderer spec files, 40 tests). I did not re-run it, because a test-writer was editing the working tree at the same time.

## Review conclusion

No material issues found.
