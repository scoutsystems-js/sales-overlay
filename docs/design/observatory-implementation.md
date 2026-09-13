# Observatory implementation record

**Date:** September 13, 2026 (Eastern)

**Status:** Implementation complete and locally verified; deployment verification pending.

The implementation is saved in the Observatory worktree at
`.codex/worktrees/observatory-pages`. It is based on origin commit
`4269494` and preserves the four newer design commits in this worktree. The
older canonical iCloud root is behind this work and must not be used as the
implementation source for this block.

The approved redesign covers exactly two dashboard pages: Team → Coaching and
Team → Performance. The server logic, intelligence, data contracts, routes,
and existing functionality remain unchanged. Coaching keeps the current
verified one focus item and one real supporting call; the retired stage grid is
not restored. Performance keeps its three existing trend charts and their
filters, even where those controls are absent from the static mockup.

Visual changes are scoped to the two approved views. Existing interactions,
filters, date ranges, rep selection, evidence links, chart drilldowns, and
loading and empty states remain on their existing paths.

The mesh is removed on both approved views. The forest gradient fills the
viewport; decorative HUD motion stays behind opaque panels and cannot receive
clicks. The existing background switch and reduced-motion preference remain
supported. The selected menu item and closer share the approved green treatment.
Page-scoped shape tokens use 20px panels on desktop, 16px on narrow screens,
and 11px selected controls. The remaining pages retain their current tokens.

The rail clearance follows the real menu height, including late navigation
updates and viewport changes. Lower panels span the page below it. On phones,
Coaching stacks the closer list above readable details; Performance stacks its
instruments and rep cards.

Review covered populated desktop and 390px phone layouts and expanded call
exchanges. Existing guards retain metric bands, fixed seven-day instruments,
selected report ranges, real evidence ownership, sorting, chart mounting, and
fetch counts. Appearance expectations were updated only where the approved
Observatory design supersedes them. No grader, prompt, route, database,
permission, metric-computation, or coaching-selection source changed.

Validation: all **2,815 tests passed**, with zero skipped, using
`node --test --test-concurrency=4 'test/*.test.js'` (39.9 seconds). Two
timing-sensitive checks failed under unrestricted machine contention, then
passed unchanged both in isolation and in the complete bounded-concurrency run.
The first run also exposed old visual expectations and extracted-fixture
assumptions, which were updated without weakening their behavior assertions.
Inline scripts parse, design archive hashes match, and the final diff check is clean.

Final suite and deployment receipts are saved in
`~/Desktop/scan-reports/observatory-2026-09-13/`. Deployment remains pending until
the exact Railway commit and served page markers have been checked.

Related design records:

- [Scout design standard](../../../SCOUT-DESIGN.md)
- [Approved Coaching Observatory preview](scout-coaching-observatory-preview.html)
- [Approved Performance Observatory preview](scout-performance-observatory-preview.html)
