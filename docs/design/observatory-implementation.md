# Observatory implementation record

**Date:** September 13, 2026 (Eastern)

Current HUD visibility calibration: stroke alpha `.14`, dashed alpha `.12`, points alpha `.20`, and scan fill alpha `.17` at scan opacity `.45`—more noticeable, still quiet. Speeds, geometry, gradient, layering, and logic are unchanged; archive `.105`/`.095` values are historical.

**Previous verified release:** `3cbab93ffa9047103f3b0c66e96dfbf770053f89` — HUD restoration
verified 2026-09-13. The later visibility calibration passes all 36 focused
checks; production verification is recorded in
`~/Desktop/scan-reports/observatory-2026-09-13/visibility/release-status.md`.

### Coaching Dashboard extension — September 13 implementation

The approved third Observatory page is the personal Coaching Dashboard
(`body[data-view="overview"]`). It retains every existing data load, metric,
date/user/pivot control, source/onboarding control, lazy optional rep graph,
drill target, permission, and lower panel. Closing % remains the existing
dominant prospect-close value and counts; its SVG ring reads the existing
`prospect_close_rate` only and introduces no target or band and no metric calculation.
The upper hero shares the fixed ground/HUD and real rail-clearance observer;
compact existing support cards sit beside the instrument, while lower focus
panels reclaim the full width below the actual menu. The header remains clear
over the gradient, background-off hides HUD art, and reduced motion stops it.

The extension is recorded in the Observatory worktree. Release verification:
`~/Desktop/scan-reports/observatory-2026-09-13/overview/release-status.md`. Inline script parsing and the final diff check pass. Focused rendered coverage for populated,
loading, and no-prospect states passes; the full backend suite passes 2,852/2,852.

The implementation is saved in the Observatory worktree at
`.codex/worktrees/observatory-pages`. It is based on origin commit
`4269494` and preserves the four newer design commits in this worktree. The
older canonical iCloud root is behind this work and must not be used as the
implementation source for this block.

The refinement localizes the green field into two emerald pools with a dark
center, fixes the viewport background and decorative HUD while page content
scrolls, and widens desktop content to 24px gutters while retaining 18px
gutters on mobile. It changes no behavior, data, metrics, permissions, or
interactions. The approved mockup archives are unchanged. The prior `456ebf5`
release remains the historical Observatory release record.

The September 13 HUD restoration is LIVE and verified. It restores the approved `1200×860` geometry: two arcs, two
rings, four traces, three points, and a scan. Its fixed layer is opacity `1`
with pale `.105` / `.095` strokes; the orbit is 82s, the points are 67s, 91s,
and 74s, and the scan is 28s. Background-off hides the layer and reduced motion
stops it. The mobile navigation stays above the artwork without changing its
normal position or width. The prior `9bdfa4e1cbb8322a8f36add576650bf3be6323c5` refinement
is the prior release; the approved archives remain unchanged.

HUD restoration validation: all **2,818 tests passed**, zero skipped, with
concurrency four (39.5 seconds). Rendered checks cover real orbit movement,
background-off, fixed scrolling, wide gutters, and mobile navigation painting
above the artwork. Desktop and phone previews were reviewed. Only stylesheet
and decorative HUD markup changed; all other page logic is byte-identical.
Receipts: `~/Desktop/scan-reports/observatory-2026-09-13/animation/`.

The live redesign covers Team → Coaching and Team → Performance; the approved
third page, personal Coaching Dashboard, is recorded as a September 13
implementation; release verification: `~/Desktop/scan-reports/observatory-2026-09-13/overview/release-status.md`. Server logic, intelligence, data contracts, routes, and existing
functionality remain unchanged. Coaching keeps the verified one-focus-item and
one-real-supporting-call behavior; Performance keeps its trend charts and
filters; Overview keeps its existing controls, loading paths, and drilldowns.

Visual changes are scoped to these three approved views. Existing interactions,
filters, date ranges, rep selection, evidence links, chart drilldowns, and
loading and empty states remain on their existing paths.

The mesh is removed on both approved views. The forest gradient fills the
viewport; decorative HUD motion stays behind opaque panels and cannot receive
clicks. The existing background switch and reduced-motion preference remain
supported. The selected menu item and closer share the approved green treatment.
Page-scoped shape tokens use 20px panels on desktop, 16px on narrow screens,
and 11px selected controls. The remaining pages retain their current tokens.

The rail clearance follows the real menu height, including late navigation
updates and viewport changes. Lower panels span the page below it. Overview uses
the same observer so short rails do not leave a fixed gap; its lower focus panels
are two columns when space permits and one column on phones. On phones, Coaching
stacks the closer list above readable details; Performance stacks its instruments
and rep cards.

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
identical to the prior release.

Final suite and deployment receipts are saved in
`~/Desktop/scan-reports/observatory-2026-09-13/refinement/`. Commit
`9bdfa4e1cbb8322a8f36add576650bf3be6323c5` was pushed after processing drained
from 2 to 1 to 0 while pending stayed static at 45; error count was 310.
Railway deployment `2a102b7e-d8e3-4004-a6fe-d4a3504710f3` reported SUCCESS at
04:36:57 UTC on September 13. All nine served-page markers matched in both raw and
comment-stripped output. The live Performance and Coaching pages were reviewed;
date-picker opening, Grade/Closing sorting, chart filters, closer selection,
and real call-evidence expansion were exercised. The existing background
switch was turned on in the review tab to show the requested gradient.

The verified page still uses its existing score bands, fixed seven-day gauge
window, selected report range, and underlying live data. These are styling
changes, not a metric reset or re-analysis.

HUD release receipt: Railway deployment `1a96adb0-b066-4a5a-a668-dad171ee4a5b`
reported SUCCESS for `3cbab93ffa9047103f3b0c66e96dfbf770053f89` at
04:53:16 UTC. All 13 served-page markers match in raw and comment-stripped
output. The push followed separate drain checks: processing zero, pending
static at 45, errors 310. Evidence is saved in
`~/Desktop/scan-reports/observatory-2026-09-13/animation/`.

Related design records:

- [Scout design standard](../../../SCOUT-DESIGN.md)
- [Approved Coaching Observatory preview](scout-coaching-observatory-preview.html)
- [Approved Performance Observatory preview](scout-performance-observatory-preview.html)
