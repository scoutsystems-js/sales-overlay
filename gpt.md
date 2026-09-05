# GPT updates — Scout

## Current approved work — 2026-09-05
Status: implementation in progress; this workspace update is not deployed yet.

Justin approved the page review and sidebar mockup. Keep the original wordmark and per-browser background artwork toggle.

- Compact header with team, date range and average score.
- Expandable Coaching Focus priorities; full supporting text remains available.
- Coachable Moments moves above strengths, with a closer selector and one selected coaching panel.
- Improvement content uses stored per-moment coaching, excludes positive moments, requires call excerpts, and keeps KB processing invisible. No new advice-generation prompt or backfill.
- Select the best-supported coaching area by distinct calls, then newest evidence; this is not a measured prediction of which change will increase closes most.
- Show the actual exchange, continuation, recorded outcome and call review link. Never derive the call outcome from moment resolution.
- Compact Team Strength summaries open the detailed exchange and outcome format Justin approved.
- Sidebar shows Team subpages from the existing route list; forthcoming features leave primary navigation. Existing access controls still govern visibility.
- Add functional and rendered checks, then verify the production commit before reporting live.

## Earlier changes verified live
- `58abde4`: Team Coaching structure with focus, strengths and rep evidence.
- `27d70cb`: transcript-matched strength exchanges and recorded outcomes.
- `8909310`: full-call review retains the cited closer's scope.

## Accuracy limits
The existing coaching generator reads team knowledge and manager corrections. This change reuses its stored output; it does not add an independent semantic KB validator or re-judge historical coaching against newly edited material. Transcript matching and explicit contradiction guards are mechanical checks, not proof of a causal claim. Missing or ambiguous evidence must not be invented.

## Verification and deployment
Pending. This section will be updated with actual results.

## Build result — 2026-09-05
Built locally in `.codex/team-coaching` on `codex/team-coaching-ready`. NOT DEPLOYED.

Implemented the approved page and sidebar structure. Original wordmark and background toggle retained. Desktop and mobile rendered checks cover 1400, 979 and 390 CSS pixels. The selected closer changes correctly, only one detail panel renders, and Fine Tune retains the selected call and highlight. The actual gather is executed against a fake database wire and rejects a quote absent from the transcript. Full backend suite: 2,477 passed, 0 failed. Inline dashboard scripts parse.

### Concrete blocker discovered while reading actual output
Call `99e6f117-562f-4b64-9473-04b02f58d682`, current `v47-2026-09-05` coaching, contains a note saying the closer merely acknowledged the concern without exploring it. The stored full closer turn continues into a question about the feared licensing result and what the prospect would do. The coaching also opens with 00:30:23, while its quoted prospect turn locates at 00:29:25. These are current records, not merely outdated historical coaching.

The previous progress note suggesting this might only be historical was corrected after reading the version. Do not publish this draft's new advice panel as verified. The current selection verifies quote location and excludes positive/unsupported moments, but that does not verify the advice's interpretation. `loadKbMaterial` reads the KB for generation; it is not an independent after-generation factual judge. This requires a semantic validation path that sees the fuller exchange and applicable material, plus real-output review. No extra model calls, backfill, production-data edits or deployment were performed for this build.

### Remaining before deployment
- Resolve the coaching interpretation gap; do not hide it by shortening text or relabeling advice.
- Verify new sidebar navigation and the full new panel against an authenticated local/staging session (rendered function checks are not that).
- Verify live data coverage: selecting an area before quote verification can leave no eligible example despite other candidate areas. Re-rank after verification when implementing the validator.
- Check the analysis drain separately, push only verified work, then verify Railway's deployed commit and live visible differences.

The local layout preview uses anonymized real call excerpts, illustrative priority headlines, and a visible content-review notice. It is a layout check, not validated production coaching.
