# Observatory implementation record

## Compact Visor size correction — September 13, 2026

**Implemented and verified: 2,885/2,885 tests pass, zero skipped; desktop and phone visual checks pass. Deployment status and the exact live commit are recorded in `~/Desktop/scan-reports/observatory-2026-09-13/visor-size/release-status.md`.** The exact approved Visor artwork is returned to its compact pre-expansion sizing: 216px standard gauges, 244px Overview Closing lead, 152px through 900px, and 216px for the stacked phone treatment (168px lead at the intermediate breakpoint). This is a size-only correction; geometry, colors, motion, layering, metrics, data loading and interactions remain unchanged. The two inline scripts are byte-identical to the previous release and parse successfully. The rendered reference-artwork comparison still passes; only the responsive display bounds changed.

## Exact Visor correction — September 13, 2026

**LIVE: implementation `ea4d5da3520cac5d01fbcc08e791ddc86eac32ec`, Railway deployment `7b617f67-80b4-4af0-b86e-c75662ee367c` SUCCESS; served-page markers verified.** Final integrated validation passes 2,885/2,885 tests, zero skipped, after preserving the newer calendar changes. Direct same-value archive comparison and desktop/phone visual reviews pass. All three phone gauges measure 300px without horizontal overflow. Fresh signed-in live reviews passed for personal 22%/15%/54 and Team 13%/15%/49.3 min, with all values, counts, controls and semantic colors intact. The six initial style-guard failures are retained in the evidence folder; their scoped expectations now follow the approved artwork. Justin rejected the first simplified live gauges beside the approved mockup. The source lost the 15-unit arc, white core, inner/outer hair rings, filled triangle, crosshairs, fine contour and exact glow. This correction copies those archived layers and proportions, restores the reference ground/card styling on personal Overview and Team Performance, and adds a direct reference comparison. Metric policies, real values, actions, content and fixed background behavior remain intact. Current authority is the first section of site-design.md (H778); the original Visor archive remains byte-identical.

Evidence and final release status: `~/Desktop/scan-reports/observatory-2026-09-13/visor-exact/release-status.md`.

## Calls visual rollout — September 13, 2026

**Status: implemented and verified live in `bb5e7aa`; receipt: `~/Desktop/scan-reports/observatory-2026-09-13/visor-calls/release-status.md`.** Calls uses the exact forest gradient and two pale fixed contours, translucent 14px panels with 1px mint borders, and the 42px × 1px mint light with a 14px inset on the header, verdict queue, list, loading and empty states. Rows remain transparent with hairlines and the list expands below the real sidebar; 390px controls and the verdict queue wrap without overflow, and the selected outcome filter retains its green border and fill. Existing rows, filters, drills, evidence, badges, actions, metrics, permissions, exclusions and data contracts are unchanged. Final test and deployment status belongs in `~/Desktop/scan-reports/observatory-2026-09-13/visor-calls/release-status.md`.


## EOD Report visual rollout — September 13, 2026

**Status: implemented; final deployment verification is recorded in `~/Desktop/scan-reports/observatory-2026-09-13/visor-eod/release-status.md`.** The first call sits directly below the header beside the measured rail; remaining calls span the page below the actual rail. The view uses the approved fixed forest gradient and two pale contours, translucent 14px panels with the mint top light and 14px inset, a 100px minimum-height editable Summary field on each call, and green edges for edited fields and focus. At 390px, controls and call content wrap without overflow. Existing ET single-day navigation and picker, blank saves, prospect-name confirmation, Slack copy, read-only canonical outcome, composed labels and sync-freshness note remain unchanged. The previously removed payment input stays absent; no new metric or logic change is included. Final tests and deployment status belong in `~/Desktop/scan-reports/observatory-2026-09-13/visor-eod/release-status.md`.

## Background control removal — September 13, 2026

**Implemented; final deployment verification for the first five views is recorded in** `~/Desktop/scan-reports/observatory-2026-09-13/visor-controls/release-status.md`; Daily Digest verification is recorded in `~/Desktop/scan-reports/observatory-2026-09-13/visor-digest/release-status.md`. Team Objections verification is recorded in `~/Desktop/scan-reports/observatory-2026-09-13/visor-objections/release-status.md`. My Team verification is recorded in `~/Desktop/scan-reports/observatory-2026-09-13/visor-members/release-status.md`. Overview, Team Performance, Team Coaching, Calls, EOD, Daily Digest, Team Objections and My Team no longer show the header background switch or Account Display checkbox. Older views retain the legacy header control until redesigned. The stored off preference, first-paint `data-bg="off"` application, background-off rendering and reduced-motion behavior are unchanged; this is a controls-only change.

## My Team visual rollout — September 13, 2026

**Implemented; final deployment verification is recorded in** `~/Desktop/scan-reports/observatory-2026-09-13/visor-members/release-status.md`. My Team (`team-members`) uses the approved Observatory ground, contours, glass panels and selected navigation. Preserve roster scope and permissions, active/inactive roles, add/move/deactivate/email/reset/delete handlers, team/date controls and the scoped Scheduled Appointments link. No auth, calendar or data change.

## Team Objections visual rollout — September 13, 2026

**Implemented; final deployment verification is recorded in** `~/Desktop/scan-reports/observatory-2026-09-13/visor-objections/release-status.md`. Team Objections uses the approved Observatory fixed ground, contours and glass outer panels. Preserve the handling grid and counts, existing date/team/rep/category filters, Why before moments, recording/call-review/Fine Tune actions, grid-before-summary loading and transparent inner evidence rows. No metric, intelligence or data-contract change.

## Daily Digest visual rollout — September 13, 2026

**Implemented; final deployment verification is recorded in** `~/Desktop/scan-reports/observatory-2026-09-13/visor-digest/release-status.md`. Daily Digest uses the approved fixed forest gradient, two pale contours and glass panels. Its fixed-day cached report, selected team, counts, notable evidence links, focus text and bounded Previous/Next navigation remain unchanged. No gauge or date-range picker is added.

## Visor standard — approved September 13, 2026

**Status: approved and implemented. Integrated validation passes 2,885/2,885 tests, zero skipped, after preserving the latest calendar release. Desktop, tablet and phone visual reviews pass. Live review caught decimal call-time text crowding its brackets; the final compact readout preserves all digits and units within the 132-unit aperture, tested with 49.3 and 120.5 minutes. Production deployment status is recorded in the release receipt below.** The current specification is the first section of `site-design.md`. Approved motion source is archived as `docs/design/scout-visor-motion-approved.html`; prior archives remain unchanged.

Scope: personal Coaching Dashboard and Team Performance share free-floating Visor horseshoes, semantic color, slow independent outer rotation, and translucent green-tinted cards. Background/HUD remains the approved fixed viewport design. Team Coaching keeps its current cards/ring in this release. Personal Closing and OHR read a metadata-only `gauge_policy` projection from the already-loaded analytics response, sourced from canonical Team `METRICS`; no extra fetch is introduced. They use the existing Team metric policy, superseding the earlier unbanded appearance; average scores keep the existing 70/50 bands. Team Performance retains Closing/OHR/call time, real scales, band calibration, counts, seven-day window and existing drills. No metric definition, grading, intelligence or permissions change is authorized by this design request.

Release evidence: `~/Desktop/scan-reports/observatory-2026-09-13/visor-standard/release-status.md`; clean full-suite receipt: `full-suite-final.txt` in that directory. The two original card-appearance failures are preserved separately as historical evidence; their expectations now match the approved glass treatment.

## Earlier release records


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
loading, no-prospect, and first-load states passes; the full backend suite passes 2,856/2,856. The direct Overview loader stamps `data-view="overview"` before it inserts the fixed HUD, preserving the scoped ground during its analytics wait.

### Compact Dashboard refinement — September 13 implementation

The personal Dashboard now presents its same four top values as SVG instruments: dominant Closing %, Calls analyzed against the actual in-range total, Avg score with its existing score color and trend, and Objection handle rate with its existing rate and counts. No target, band, metric calculation, load, or drill target changed. Missing values remain neutral with no arc or glow. Coach Summary now occupies the real rail-height upper area; below the rail, the long What Needs Work panel sits at left while Objection Handling Focus and the existing Performance Summary link stack independently at right. Desktop support gauges are centered and compact; phones use a bounded two-by-two gauge grid. Release verification: `~/Desktop/scan-reports/observatory-2026-09-13/compact/release-status.md`. Inline parsing and the final diff check pass; rendered focused coverage and the full backend suite pass 2,856/2,856.

### Overview glass refinement — September 13 implementation

Justin revised personal `overview` only: its lower sections now use dark translucent green tint, modest backdrop blur, sage edges, and restrained emerald bloom so the existing fixed ground and HUD remain visible without weakening text contrast. The major surface is `rgba(7,23,14,.78)` with 4px blur; nested cards use `rgba(14,40,24,.42)` with 3px blur; the edge is `rgba(196,231,207,.30)` and bloom `rgba(21,161,71,.10)`. The four top gauges are free-floating in balanced desktop columns and a two-by-two phone grid; they retain their existing interactions and the dominant Closing hierarchy. Team Coaching and Team Performance retain opaque panels. Background-off, fixed HUD geometry/timing, pointer behavior, and reduced motion are unchanged. Release verification: `~/Desktop/scan-reports/observatory-2026-09-13/glass/release-status.md`. Focused rendered coverage and the full backend suite pass 2,858/2,858.

### Three-gauge Overview refinement — September 13 implementation

Personal `overview` now presents only three free-floating existing-data gauges, ordered Closing %, Objection handle rate, then Avg call score. Calls analyzed is removed; Closing is a native link to the regular, unfiltered Calls page. The focus grid now begins below the hero in the main column beside the rail, while Coach Summary is the final full-width section after both focus panels; the optional rep graph remains in its existing upper flow. No calculation, metric definition, load, permission, or lazy behavior changes. Release verification: `~/Desktop/scan-reports/observatory-2026-09-13/three-gauges/release-status.md`.

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
viewport; decorative HUD motion stays behind opaque Team panels and cannot receive
clicks. Personal Overview is the approved exception: its dark translucent green-tinted
panels use modest blur and restrained sage/emerald edges so the fixed ground and HUD
remain visible behind readable text. The existing background switch and reduced-motion
preference remain supported. The selected menu item and closer share the approved green treatment.
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
