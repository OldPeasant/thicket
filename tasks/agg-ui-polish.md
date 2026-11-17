---
title: Aggregation builder: stage-named preview announcements, no previews in text mode
status: in_progress
owner: felix/agent-2
deps: [agg-ui]
touches: [packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T04:14:37Z
---
## Goal
Follow-ups from the agg-ui review (reviews/agg-ui/review.md CR-8, CR-9).

## Acceptance criteria
- [x] Component test: the per-stage preview live region names its stage ("Stage N: …") and stays silent while loading (CR-8)
  - verified (2026-11-17 04:53+0100 by felix/agent-2): cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts -> 104 passed; live-region tests assert 'Stage N: <count> from a sample' / 'Stage N: preview failed: …' and empty text while loading (incl. 3-stage reload with out-of-order answers)
- [x] Component test: no agg.preview requests are sent while the builder is in full-text mode, and returning to stage mode does not re-preview stages whose pipeline prefix did not change (CR-9)
  - verified (2026-11-17 04:53+0100 by felix/agent-2): same ng test run -> 104 passed; tests 'sends no previews in full-text mode and re-previews only changed stages on return' (Run + Create view in text mode send 0 agg.previewStage; return re-reads only $match $group and $match $group $sort) plus 9 edge tests; mutation (text-mode guard disabled) -> 7 of them fail

## Notes
See SPEC.md M3 and docs/ARCHITECTURE.md "Aggregation builder".
- ASSUMPTION (2026-11-17 04:46+0100 by felix/agent-2): CR-9: applyText() reuses existing stage ids by position (instead of always fresh ids), so stages whose prefix is unchanged keep their preview across a text-mode round trip; a reordered/edited stage simply gets a new preview key. Loading previews are aborted on entering text mode; finished ones are kept.
- ASSUMPTION (2026-11-17 04:46+0100 by felix/agent-2): CR-8: preview errors are announced as 'Stage N: preview failed: <msg>' (lower-case 'preview' after the prefix); loading is announced as empty text (the visible 'Loading preview…' note stays).
