# Observatory implementation record

**Date:** September 13, 2026 (Eastern)

**Status:** `456ebf5` is LIVE — implementation and production release verified
2026-09-13. The September 13 visual refinement is implemented locally and
awaits release verification.

The implementation is saved in the Observatory worktree at
`.codex/worktrees/observatory-pages`. It is based on origin commit
`4269494` and preserves the four newer design commits in this worktree. The
older canonical iCloud root is behind this work and must not be used as the
implementation source for this block.

The refinement localizes the green field into two emerald pools with a dark
center, fixes the viewport background and decorative HUD while page content
scrolls, and widens desktop content to 24px gutters while retaining 18px
gutters on mobile. It changes no behavior, data, metrics, permissions, or
interactions. The approved mockup archives are unchanged. Release `456ebf5`
remains live until this refinement is verified in production.

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

The refinement passes all **2,816 tests**, zero skipped, with concurrency four
(36.1 seconds); its 78 focused checks also pass. Rendered checks prove both
backgrounds and HUDs remain fixed while actual cards scroll, and both lower
panels reach the 1920px viewport gutters. Desktop and 390px phone previews
were reviewed. All page scripts and markup outside the stylesheet are byte
identical to the prior release. Release verification remains pending.

Final suite and deployment receipts are saved in
`~/Desktop/scan-reports/observatory-2026-09-13/`. Release `456ebf5109a37d5b196a7478563dbd6a80da58ca` was pushed after three
standalone drain checks showed processing zero and pending static at 45.
Railway deployment `1bb4ffa0-a782-42aa-bb23-95e911741f2d` reported SUCCESS at
04:21 UTC on September 13. All six served-page markers matched in both raw and
comment-stripped output. The live Performance and Coaching pages were reviewed;
date-picker opening, Grade/Closing sorting, chart filters, closer selection,
and real call-evidence expansion were exercised. The existing background
switch was turned on in the review tab to show the requested gradient.

The verified page still uses its existing score bands, fixed seven-day gauge
window, selected report range, and underlying live data. These are styling
changes, not a metric reset or re-analysis.

Related design records:

- [Scout design standard](../../../SCOUT-DESIGN.md)
- [Approved Coaching Observatory preview](scout-coaching-observatory-preview.html)
- [Approved Performance Observatory preview](scout-performance-observatory-preview.html)
