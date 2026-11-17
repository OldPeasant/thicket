# Fix Report

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: current task; findings CR-1, CR-3, CR-4, CR-5 from `reviews/validator/review.md` (CR-2 resolved by the committed unit tests, per the parent worker)

## Fixed findings

### CR-1 — A failing validator check is silent and looks like "all documents pass"

Files changed:
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`ValidatorMarks.error()` was set when `coll.validator.check` failed but never rendered, so a failed check looked the same as "no document fails".

Fix:
The results area now shows `validator.error()` as a quiet notice (`<p class="message" data-testid="validator-check-error" role="status">Could not check the documents against the validator: …</p>`). It uses the existing muted `.message` style, so no CSS changes were needed. A successful check clears `error`, which removes the notice.

Validation:
- New spec "says why when the check fails, and drops the notice after a successful check" (collection-view.spec.ts) — Pass

### CR-3 — Ctrl+Enter saves even when Save is disabled

Files changed:
- `packages/renderer/src/app/validator/validator-view.ts`
- `packages/renderer/src/app/validator/validator-view.spec.ts`

Problem:
`save()` only checked `saving()`. On unchanged text it sent a no-op `collMod` (and asked for confirmation on production profiles). On read-only profiles it showed a READ_ONLY error.

Fix:
`save()` now returns early when `saving()`, `!dirty()`, or `ProfileSafetyService.readOnly(profileId)()`, matching the conditions that disable the Save button. `WriteGuard` still enforces read-only as a second layer.

Validation:
- New specs: "Ctrl+Enter without a change sends nothing, like the disabled Save button", "Ctrl+Enter without a change asks nothing" (production profile) — Pass
- I replaced the read-only spec "refuses a save called directly before anything is sent". It expected the old behaviour, a READ_ONLY message after a direct `save()`. The new spec, "Ctrl+Enter and a direct save do nothing, like the disabled Save button", checks the required behaviour instead: nothing is sent, no message appears, and the edit is kept — Pass

### CR-4 — Edits typed while a save runs are overwritten

Files changed:
- `packages/renderer/src/app/validator/validator-view.html`
- `packages/renderer/src/app/validator/validator-view.spec.ts`

Problem:
The editor stayed editable while saving. `reload()` then overwrote anything typed in the meantime.

Fix:
While `saving()`, the textarea is `readOnly`, and the level/action selects and the "Start a $jsonSchema" button are disabled.

Validation:
- New specs "locks the editor while saving, so nothing typed is lost to the reload" and "locks the template button while saving" — Pass

### CR-5 — Any validator change re-checks every open collection tab

Files changed:
- `packages/renderer/src/app/validator/validator-marks.service.ts`
- `packages/renderer/src/app/validator/validator-marks.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`ValidatorChanges.version(target)` read one signal holding the whole map, so every collection tab's check effect re-ran on any save.

Fix:
`ValidatorChanges` now keeps a Map from namespace key to a writable number signal, with one signal per namespace key, created lazily. `version(target)` reads only that collection's signal. The public API (`version`, `changed`) is unchanged.

Validation:
- New spec "notifies readers of the changed collection only" (validator-marks.service.spec.ts): a computed that reads `version(T)` does not re-run when another collection changes — Pass
- Strengthened "keeps this tab's marks when the validator of another collection changes" (collection-view.spec.ts) to assert that no new `coll.validator.check` is sent — Pass

## Not fixed

### CR-2 — New renderer and backend logic has no unit tests

Status:
Invalid (already resolved)

Reason:
The parent worker reports that the unit tests committed in 129f5d6 resolve this finding. This fixer took no action on it.

## Validation summary

Focused tests:
- `npx ng test --include src/app/validator --include src/app/collection/collection-view.spec.ts` (in packages/renderer) — 4 files, 135 tests passed

Full test suite:
- `npm run check` — Pass (lint and prettier clean, typecheck clean, root vitest 75 files / 4100 tests passed, renderer 87 files / 2736 tests passed)

Lint/type-check/build:
- Included in `npm run check` — Pass
- `npm run test:e2e -- test/e2e/validator.e2e.ts` — 1 passed

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.
