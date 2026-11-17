---
title: Aggregation builder: stage-named preview announcements, no previews in text mode
status: todo
owner:
deps: [agg-ui]
touches: [packages/renderer/src/app/aggregation]
prio: 2
---
## Goal
Follow-ups from the agg-ui review (reviews/agg-ui/review.md CR-8, CR-9).

## Acceptance criteria
- [ ] Component test: the per-stage preview live region names its stage ("Stage N: …") and stays silent while loading (CR-8)
- [ ] Component test: no agg.preview requests are sent while the builder is in full-text mode, and returning to stage mode does not re-preview stages whose pipeline prefix did not change (CR-9)

## Notes
See SPEC.md M3 and docs/ARCHITECTURE.md "Aggregation builder".
