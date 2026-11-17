---
title: Aggregation builder: stage-named preview announcements, no previews in text mode
status: in_progress
owner: felix/agent-2
deps: [agg-ui]
touches: [packages/renderer/src/app/aggregation]
prio: 2
lease_until: 2026-11-17T04:04:31Z
---
## Goal
Follow-ups from the agg-ui review (reviews/agg-ui/review.md CR-8, CR-9).

## Acceptance criteria
- [ ] Component test: the per-stage preview live region names its stage ("Stage N: …") and stays silent while loading (CR-8)
- [ ] Component test: no agg.preview requests are sent while the builder is in full-text mode, and returning to stage mode does not re-preview stages whose pipeline prefix did not change (CR-9)

## Notes
See SPEC.md M3 and docs/ARCHITECTURE.md "Aggregation builder".
- ASSUMPTION (2026-11-17 04:46+0100 by felix/agent-2): CR-9: applyText() reuses existing stage ids by position (instead of always fresh ids), so stages whose prefix is unchanged keep their preview across a text-mode round trip; a reordered/edited stage simply gets a new preview key. Loading previews are aborted on entering text mode; finished ones are kept.
- ASSUMPTION (2026-11-17 04:46+0100 by felix/agent-2): CR-8: preview errors are announced as 'Stage N: preview failed: <msg>' (lower-case 'preview' after the prefix); loading is announced as empty text (the visible 'Loading preview…' note stays).
