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
