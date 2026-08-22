# SCOUT — BUILD LIST

**Created 2026-08-20.** Seeded from the live-site audit and the current repo, **not** from `BUILD-PLAN.md` (19 April, four months stale — treat it as history).

**⚠ STANDING PROCEDURE: update this file after every push, alongside `CLAUDE.md`.**

**⚠ ANYTHING UNVERIFIED IS MARKED `UNKNOWN`.** An invented entry is worse than a gap: a gap gets asked about, an invention gets built.

---

## 🚨 TOP OF THE LIST — ZOOM CALLS PRODUCE NO USABLE DATA (filed 2026-08-22)

**⚠⚠ FILED, NOT INVESTIGATED. Justin's ruling: recon happens AFTER this session, and Zoom stays PINNED until he lifts it. Do not measure, diagnose or fix any part of this from the entry below — it is a report of what he observed, not a set of findings.**

> **⚠ JUSTIN'S REQUIREMENT, and it is why this sits above everything else:**
> **"Zoom HAS TO work as good or better than Fathom, because not every closer is going to use Fathom."**

Since Josh connected Zoom, Zoom calls appear in the call library **alongside** Fathom ones, and three things are wrong at once:

| # | observed | note |
|---|---|---|
| **a** | **No prospect name.** Zoom rows are titled *"Josh's Zoom Meeting"* / *"Josh's Personal Meeting Room"* where Fathom rows carry the prospect's name. | ⚠ Cross-reference the **PMR title finding**: a Personal Meeting Room gives *every* call an identical, non-distinguishing title — which is very likely why no prospect name is resolved. The prospect-name resolver's precedence is grader → diarized → cleaned title → NULL, and a PMR title carries no candidate. |
| **b** | **No analysis.** A **57-minute call marked Closed** shows *"No highlights were extracted for this call"*, a section grade of **F on Intro**, and coaching text reading **"This recording contains no sales conversation to coach against."** | ⚠ Open: **is the transcript parsing at all, or arriving empty?** A grader returning "no sales conversation" on a real 57-minute sales call is being handed nothing — that reads as an ingestion or adapter failure, not a grading one. ⚠ Open: **does a re-analyse trigger fix existing rows, or is the ingestion itself broken?** |
| **c** | **BOTH sources are ingesting the same meetings.** | ⚠ This is exactly the duplicate exposure the **ONE ACTIVE SOURCE PER USER** ruling was written for — and that ruling was **never built**. See it in `CLAUDE.md`: prevent new dual connections, do not force-disconnect, provide a deliberate *Switch provider* action, and **if enforcement keeps the FIRST source active the incumbent always wins and the newcomer can never generate the evidence it is being asked for** — for Josh the active source must be **Zoom**. |

**⚠ Known-relevant context already on file, so recon does not rediscover it:** the VTT adapter has **never been exercised on a real-length call** (everything it has parsed is ≤120 seconds); the 3301 requeue has **never fired live**; and every Zoom row that existed before Josh connected belonged to the **security reviewer** and was a 2-minute test meeting. Check **whose** a Zoom row is and **how long** it is before drawing any conclusion from it.

---

## LIVE
Shipped, deployed, and verified on production.

| item | one line | notes |
|---|---|---|
| Fathom OAuth + auto-sync | Connect Fathom, 2-hourly GitHub-Actions cron syncs calls | 381 calls synced on Josh |
| Post-call analysis pipeline | Grader + highlight extractor per call, 2 Claude calls | `ANALYSIS_PROMPT_VERSION` currently v17-era |
| Call library + call review | List of analysed calls; per-call grades, highlights, follow-up email | |
| Coaching Dashboard | Glance tiles, coach summary, what-needs-work, performance summary | default landing for all roles |
| Objections view | Metrics, per-category breakdown, moment feed, coaching synthesis | synthesis is a ~34s model call, cached per day |
| EOD Report | Per-call editable report + copy-for-Slack | |
| Knowledge Base | Upload/list/delete, auto-harvest from closed calls (Phase 7b) | manual Add-to-KB removed 2026-08-18 |
| Team layer | Team view, rep cards, rep line graphs, team averages gauges, daily digest | |
| Prospects + close rate | Prospect entity, merge/unmerge, closed-prospects ÷ total | |
| Date-range picker | Calendar picker; every view owns its own range | |
| Welcome sequence | One-shot dial animation after fresh login | never a gate; 6s watchdog |
| Site-wide background | Team raster on every view, `cover`, `50% 50%`, **opacity 1**; eased smoothstep ramp 22%→96% | shipped `9d297a8`, faded `6adb774`, **banding fixed `9f5d2d9`** — no line visible at 1440 or 1920 |
| Objection focus states | `insufficient` split into no_volume / thin_types / even_performance; focus_set + full ranking | shipped `9f5d2d9`; thresholds untouched |
| Sync Now in Connections | Manual sync for both providers in #account, verified by clicking | shipped `6adb774`; healthy dashboard cards removed with it |
| Week labels in Scout green | Weekly team-graph axis labels `#09e046` | shipped `864bd49` |
| Rep filter dropdown | Custom multi-select listbox: stays open across picks, colour swatches, keyboard + focus | shipped `9265131`, capture-phase fix `0fbde98`; **verified by clicking** — 3 reps toggled without reopening, persistence across reload |
| Zoom OAuth + deauthorization | Connect/disconnect, deauth endpoint live | |
| Zoom speaker identity | Byte-identical display-name match, collision detector | `lib/zoom-identity.js` |
| Welcome emails / set-password | Invite flow via Resend | |
| Account page | Profile, password, billing badge, Connections | |
| **Mark a call "not a sales call"** | Closer on their own call, manager on a team call; excluded from every metric, stays visible and flagged | shipped `6129fed`, library rows `ae19d22`. Verified by clicking on BOTH surfaces: mark from a row in place, opens, un-mark from either side, no row overflow at 1440/1920. ✅ **DONE** (`87383ab`). Marked row recoloured to Justin's ruling: red badge = state, green button = action. Hover states + un-dim shipped `2f6514f`: unmarked hovers RED (previewing the state the click produces), marked hovers a brighter green; the row dim moved to `.library-card-main` so badge and button render at full strength. Earlier (`eceb31c`): Button inverted to Justin's ruling (neutral unmarked / red marked); the cache question closed — entries accumulate, so the pre-mark entry is neither evicted nor overwritten and the hash round-trips exactly. Not structural; no cache behaviour changed. |
| **Site-wide font: Saira** | Self-hosted variable woff2 (96.4 KB), dashboard + login, body 450, tabular numerals | shipped `284cfdb`/`39faa05`. Verified on the live site: face loads on both pages (registered count + proven control), weight 650 renders natively, no overflow, no login wrap, no nav collision at 1920 |
| **Wordmark is the logo image** | `web/scout-wordmark.png` (1038x138, 71.8 KB) replaces the text lockup on login AND in the welcome overlay | shipped `0073af9`. Source plate keyed out on GREENNESS not brightness — the slide-background arcs peak BRIGHTER than the glow, so no luminance cut could separate them; arcs end at alpha 3-9, glow preserved at 41. One constant colour, alpha carries the shape (224KB → 71.8KB). Dead `archivo-expanded-700.woff2` + both `@font-face` blocks + every derived lockup constant DELETED. Verified on production: both pages carry it, asset serves 200, dead font 404s, no upscaling, no overflow at 8 viewports (420x720 → 1920x1080). ⚠ Motion untouched; the title now fades rather than settling its tracking, because an image has no letter-spacing — reported, not worked around |
| **`/team/why-prose` fixed** | It had never worked — `getAdminClient()` is undefined in `team.js`, and the args to `resolveTeam` were reversed | shipped `1d8ae80`. Failing test first, over HTTP through the real handler; it reproduced the exact production symptom `500 "Failed to load rep summaries"`. Post-fix assertion is **503 (not configured)** because the route cannot reach `getAdmin()` while it is dying on an undefined symbol — the two codes separate precisely what is under test. **Verified on production with content:** 5 rep summaries, Josh's reads *"closed 11 of 41 prospects (27%) … partner objections unhandled in all 7 cases … weakest section discovery (42)"*, cross-checking his rep card exactly |
| **Manager is on their own team board** | `resolveTeam` returns `memberIds` (reps + the board owner); the rule had been hand-rolled at 2 of 10 endpoints and absent from the other 8 | shipped `9a27979`. Josh was missing from rep cards, totals, trends, why-prose, recommendations, needs-work, highlights and digest — present only on the gauges and the rep graphs. **Verified on production:** per_rep 4→5, calls_analyzed 6→60, cash 7,500→66,300; Josh's card reads 54 calls, 27% closing (11 of 41), 7% objection handling. Field renamed `repIds`→`memberIds` so a stale reader fails loudly rather than silently dropping the manager |
| **Team objection drilldown (steps 1+2)** | Instance list + per-closer × per-category grid, manager-only, under `/team/objections` | shipped `23dc454`, note `b265626`, `board_size` `9d58911`. **NOT the coaching summary** — that is a separate block. Justin's 3 rulings honoured: manager view only (gated by `teamGate`, forged-closer 403 pinned over HTTP), the EXISTING date picker (range rides the hash, no new component), closers NAMED. **`lib/real-calls.js` is the load-bearing piece** — without it the grid shows Josh 4× under demo names. **Verified on production by clicking:** category 177→55 moments matching the grid's Timing cell `4/55`; range 7d 28 → 90d 177 with buckets reconciling to ALL exactly (65+23+55+34=177); 177 clip links, **171 Fathom "▶ Clip" / 6 Zoom "▶ Open Recording", 0 mislabelled**. This view was the LAST hardcoded `▶ Watch Clip` in the file |
| **Drilldown refinements (Justin's six)** | Routing, in-card controls, reused picker, team-average row, no Manage Members / Customize View, bare labels | shipped `3c1e3a5`. **Verified by clicking on production, 3 clicks delivered:** the averages gauge and the focus card both land on `#team-objections` (the gauge carrying its fixed 7-day window); the picker is the SAME component and its selection survives leaving and returning; controls sit inside the card; the two team-only buttons are gone; badges elsewhere in the app kept their fills. ⚠ The personal objection surfaces are **deliberately not retargeted** — the drilldown is manager-only, so retargeting them would 403 every closer. ⚠ Team average is **omitted with a stated reason below two closers** ("with one, it would just repeat the row above") |
| **Coaching summary (drilldown step 3)** | Per-closer "Why", named at any team size, explaining the MECHANISM behind the rate — not restating it | shipped `991b597`, output budget `966d963`. One Claude call for the whole board; state model from `team-needs-work` so a data shortage never reads as good news; reads through `computeTeamObjections` so the grid and the paragraph cannot disagree and the not-a-sales-call/synthetic filters are inherited rather than rebuilt. **Verified on production by looking at the panel**, and the cache proven both directions: mark → `cached:false`, 55→53, text regenerated; un-mark → `cached:true`, 55 back with the original text byte-identical. **Cost: miss ~10.6s, cached ~1.8s, of which ~1.8s is the query the cache cannot skip** — ~1,360 input tokens for one closer, ~960 more per additional closer |
| **Login body weight 450** | Login was the last surface still at 300; it now matches the site | shipped `31c446d`. **Edited in place, not overridden** — one weight declaration per selector, so the file cannot acquire a third contradiction. Verified on production: **57 elements compute 450, zero offenders**, 450 comes from Saira's real axis (inside the declared `100 900`, ink mass distinct from 300 and 900), advance unchanged so nothing reflows. The trailing `.brand-name` 700 was removed as **redundant** — it holds 700 by specificity `(0,2,0)` vs the catch-all's `(0,1,0)`, confirmed in the browser after removal |

## IN FLIGHT
Started this session.

| item | one line | state |
|---|---|---|

| **Customize View (team page)** | `soon` tag in the team controls row, where the real control will live | **tag SHIPPED `4d6d9e6`** and verified in the render (SPAN, tabIndex -1, dimmed). The feature itself is not started — see AGREED, NOT STARTED |

## BLOCKED ON JUSTIN
Built or scoped, waiting on a decision — not on work.

| item | one line | what is needed |
|---|---|---|
| Objection-handling name collision | "Objection Handling" names 3 different metrics on the team page | observation filed 2026-08-18, with Justin |
| EOD divergence | Parked deliberately | do not touch without a ruling |

## AGREED, NOT STARTED
Ruled on, nobody has begun.

| item | one line | depends on |
|---|---|---|
| **Delete a user even when they have data** | Justin: users must be deletable regardless of whether calls or analyses exist | ⚠⚠ **TODAY'S BEHAVIOUR IS THE OPPOSITE BY DESIGN.** `admin.js:73` counts a user's calls to **BLOCK** deletion, and that count is deliberately left **UNFILTERED** by not-a-sales-call precisely so a fully-marked user cannot be reported as empty and wiped. That guard is recorded in `CLAUDE.md`. **This ruling supersedes it, and the guard's reasoning must be REVISITED, not silently removed** — whatever replaces it has to answer the same question the guard was protecting against. ⚠ **OPEN: what happens to their calls, analyses, prospects and KB rows** — deleted, orphaned, or reassigned? **Deleting a MANAGER is a different case from deleting a REP** (their reps' `managed_by` points at them). ⚠ **OPEN: reversible, or final?** **AGREED, NOT STARTED — no part of this was built.** |
| Customize View — the real feature | Let a manager choose what the team page shows | per-user, not per-org (no org entity needed) |
| **Login page + post-login animation — bring in line with the site** | Two of the three open items are now CLOSED | ✅ **(1) the wordmark ruling shipped** — it is Justin's logo image on both surfaces (`0073af9`). ✅ **(2) login body weight 450 shipped** (`31c446d`). ➡ **REMAINING: only (3)**, and it is a recorded choice rather than work — the animation's motion vocabulary is deliberately unlike the site's (420–760ms and expo + 1.8 overshoot, against the site's 0.15s `cubic-bezier(0.4,0,0.2,1)`). **Recommended UNCHANGED: correct for a ceremony, wrong for a button.** ⚠ Standing observation: the three surfaces use three different geometries — concentric arcs (login), a radar dial (welcome), a node mesh (dashboard) — and only the first is the brand mark |
| **Nav shows the wordmark, not just "Scout"** | Blocked on a redrawn small-size mark — **SPEC BELOW, not built** | ⚠⚠ **SCALING CANNOT FIX THIS — it is a resolution-of-construction limit.** Measured on the shipped asset: the smallest dot is **8px at native 1038px**, so **2.5px at the welcome overlay's 327px** and **0.2px at nav size**. **SPEC FOR A DESIGNER: (1) at most THREE elements** — one outer arc, one inner arc, one dot; drop the middle ring and the two smaller dots. **(2) stroke >= 1/8 of the mark's height**, so it survives at 16px as a 2px line. **(3) the single dot >= 1/5 of the height** (>=3px at 16px) — a filled dot stops reading below ~2-3px. **(4) minimum usable size 16px tall**; below that drop to the outer arc alone. **(5) no glow** — it is invisible under ~24px and only muddies the edges. ⚠ Deliver as **SVG**, not a raster: at these sizes a raster cannot be shared across 1x and 2x. ⚠ Same limit already bites the welcome title below ~618px vmin, where its smallest dot goes under 2px |
| ~~Wordmark → Saira wide (`wdth 125`)~~ | **RETIRED 2026-08-21** — superseded by the image ruling | The wordmark is Justin's logo image; the mark replaces the O, so no typeface can draw it. ⚠ Kept as a line rather than deleted so the next reader does not re-open it: the A/B/C typeface question is CLOSED, not deferred, and its measured k values live in `CLAUDE.md` as history |
| **Harvest gate — capture from almost every call** | Justin 2026-08-20: *"there's always a coaching moment you can take from a call"* | ⚠⚠ **SUPERSEDES KB RULING 4**, which gates auto-harvest on `outcome='closed'` ALONE. ⚠ OPEN: extra model calls per call? ⚠⚠ OPEN: **what stops a weak moment being kept once the closed filter goes** — if that filter was the de facto quality gate, removing it needs a replacement, not just a wider net. ⚠ The KB counter card copy ("Scout only collects from calls that close") becomes FALSE and must change in the same commit |
| **New Scout Systems logo** | Bold square wordmark, ring-and-dot mark replacing the O | ⚠ **SHIPS AS SVG, not text in a font** — removes the identification and licensing questions entirely. ⚠ The **"5." in the source image is a SLIDE NUMBER**, not part of the logo. ⚠⚠ **SMALL-SIZE VARIANT NEEDED FIRST**: the Logo sweep ruling records that at nav size concentric rings vanish and a dot renders under a pixel — **this mark has exactly that construction**. ⚠ Also fixes the **missing favicon**: measured 2026-08-20, `rel="icon"` appears in ZERO of the served pages |

## QUEUED
Agreed direction, no date, no owner.

| item | one line | depends on |
|---|---|---|
| Fathom → `call_connections` cutover | Move Fathom's 8 connection sites onto the unified store, drop `fathom_connections` | ⛔ held while a security reviewer is mid-assessment |
| Reviewer demo-data cleanup | Remove `demo-rv-*` rows | ⛔ same hold |
| Shared constants module | Payment-structure allowlist + sync-cap constants are duplicated across route files | hardening pass |
| `/kb/upload` batch embeddings | Still embeds chunk-by-chunk; `getVoyageEmbeddings` drops straight in | ⚠ becomes load-bearing the moment similarity search surfaces harvested moments |
| Section drilldown surfacing | Surface harvested KB moments under their weakest section | needs the batch-embedding fix first |
| Forced password change on first login | Welcome emails currently carry a permanent credential | front-door arc |
| Self-serve forgot/reset | No reset UI exists anywhere | front-door arc |
| Onboarding sequence for a first-run user | | front-door arc |
| Slack connect | EOD one-click send + manager digests | |
| CRM integration (GHL, Close.io) | Read then write, diff-then-confirm on writes | after call analysis is proven |
| Account/org entity | Real billing needs it (seats, one invoice) | ⚠ per-user customisation does NOT wait on this — ruled 2026-08-20 |
| Modals for user-management confirms | Email-change + delete still use `prompt()` | polish |
| Settings toggle — turn the background off | Per-user; plain black instead of the raster | ⚠ per-user by the 2026-08-20 ruling that customisation needs no org entity |
| Cash tile → EOD | Retarget once EOD accepts a pivoted user | EOD is self-only today |
| Delete orphan auth accounts | 6 abandoned public-signup rows | accepted as-is; needs an explicit go |
| DMG notarization gap | Every release needs manual DMG sign+notarize+staple | electron-builder config |

## SCOPED, NOT STARTED
Design exists in `CLAUDE.md`; no code.

| item | one line | note |
|---|---|---|
| Zoom clip extraction (sub-stage 3) | download → ffmpeg-cut → discard source → store clips | the only part needing hosted storage |
| Zoom webhook + polling + connect UI (sub-stage 4) | `recording.completed` ingestion, paid-plan detection messaging | ⚠ connect-flow must tell a user WHICH Zoom setting is wrong on an empty sync |
| 8c/8d barrier → uncovered-ground link | "the lender approved $5k and financial qualification was never established" | ⛔ held on DATA: needs ≥2 uncovered areas per call; currently 0/1/1 |
| Role-inversion detector | Deterministic closer-question-share threshold | ⛔ held on DATA: n=2 labelled calls |
| Shape (b) missed cue | "the closer DID dig and the prospect had nothing" | needs a purpose-built signal + a KB-harvest-gate ruling |
| Adaptive Learning Engine (desktop) | Post-call pattern extraction into the KB | desktop app dormant |
| Desktop persistent-login parity | Proactive refresh timer, 401 retry, transient-vs-genuine re-auth | ships with the next DMG |
| Teleprompter section-mode | Prompt only during objection/close | architecture preserved, unscheduled |

## TRIGGERED
Deliberately deferred with the condition that makes them due.

| item | trigger |
|---|---|
| **Exposure-sweep guard** | ⚠ **See OPEN below — currently unguarded.** Due before another full-bleed/brightness change |
| Zoom VTT adapter validation on a real call | Josh records a cloud call with transcription on |
| Zoom 3301 requeue live-exercise | A transcript fetch actually races |
| Non-English prospect-name handling | A non-English account is onboarded |
| Empirical grader calibration | 50+ outcome-tagged calls exist |
| Objection handle-rate drift watch | Rate falling below ~20% and continuing = real failure, not the v17 narrowing |

## OPEN
Known gaps, no agreed plan.

| item | one line | cost |
|---|---|---|
| **⚠⚠ The exposure sweep is unguarded** | Nothing re-runs it, so a NEW view whose text sits outside an opaque container lands on a full-brightness photograph with no test catching it | **Not cheap.** A faithful sweep needs computed styles across 15 *rendered* views — i.e. a headless-browser devDependency this repo does not have (`node --test` only), plus a harness that boots the dashboard and drives all 15 views. The four carded classes are pinned statically, which covers today's containers but cannot cover a class that does not exist yet. A "border but no background" heuristic was considered and rejected — it fires on badges, buttons and inputs that are legitimately inside carded parents. |
| **The `[team]` catch shape cannot distinguish a programmer error from an operational one** | All 13 catch blocks in `routes/team.js` log `err.message` without a stack and return a generic 500. A `ReferenceError` and a DB timeout are indistinguishable to both the client and the log | **Reported, not rewritten** — 13 blocks is its own blast radius. `/team/why-prose` sat broken since it was written because of this. ⚠ The generic CLIENT message is correct and should stay; the fix is to make programmer errors loud on the SERVER — log the stack, and consider classing `ReferenceError` / `TypeError` separately from operational failures. ⚠ Same shape almost certainly exists in the other route files |
| **⚠ Synthetic rows are identified by an ID PREFIX, and for `demo-` rows that is the ONLY signal there is** | `lib/real-calls.js` filters `seed-` / `demo-` prefixes. Measured 2026-08-22: real 420 calls / 420 recording_url / genuine grader versions; seed 102 / 0 / `seed-2026-08-16`; **demo 33 / 33 / v4,v5,v8 — byte-level COPIES of Josh's analyses, so nothing in the row says "synthetic" except the id we gave it** | **The durable fix is an `is_synthetic boolean` column on `fathom_calls`**, written at insert time by the seeding scripts — then the filter reads a property instead of parsing a name, and a seed row that forgets the prefix stops being invisible. ⚠ `recording_url IS NULL` was considered as a second mechanism for seed rows and **rejected**: two mechanisms for one concept is two things to keep in sync, and that property is a coincidence of today's data — a genuine call that failed to sync a `recording_url` would be silently discarded as synthetic. Until the column exists, **the prefixes ARE the contract** |
| Team page `<h1>` reads "Team" on a deep link, "My team" when reached via the Team page | The heading comes from the team-overview lane, which a deep link never loads | ⚠ cosmetic and **pre-existing**, not introduced by the drilldown. Noticed while fixing the drilldown's own version of this (its grid note had the same dependency and now carries `board_size` in its own payload). Same fix shape if it is ever wanted: have the view read a value its own request returns |
| **⚠⚠ `loadTeamWindow` counts SYNTHETIC rows — three lanes affected** | The chokepoint feeding **team-needs-work, team-digest and team-synthesis** filters `not_a_sales_call` but has no `realCallsOnly`. Measured on Josh's board over 90 days: **177 real objection moments, 87 seeded, 20 demo — 38% of the input is fabricated**, and the demo share is Josh's own calls counted again under other names | **Found 2026-08-22 while comparing the old Objection Handling Focus panel against the new drilldown; filed, not fixed.** The fix belongs at the chokepoint (one filter, three lanes) and needs `fathom_call_id` added to that select — so it is a contained change but it lands on three surfaces at once and wants its own verification. ⚠ The drilldown is unaffected: it has its own filter |
| **Old "Objection Handling Focus" panel — NOT archived, deliberately** | Nothing links to it any more (all team entry points now open the drilldown), but the view still exists and works if reached directly | It carries **three things the drilldown does not**: an LLM surface-label taxonomy ("Spouse / partner approval", "Needs time / think it over") rather than the 4 stored categories; a **true-objection denominator** that excludes disqualifications and logistical barriers **and says so**; and clickable bucket → per-call evidence. ⚠ The card on the team page stays too — it is the only place that context line renders there. **Justin's call whether to fold any of it into the drilldown or restore an entry point** |
| Blank graphs on refresh onto `#team` | Pre-existing, not a regression from `87f09d3` (proven by in-memory revert) | the guard that swallows it is still unidentified |
| Colour ramp collision at 8+ reps | 7 colours cycling, so rep 8 shares rep 1's hex | measurement deferred; options for Justin owed |
| Team sub-page hash gap | `#team-recs` / `#team-needs-work` / `#team-members` carry no range, so a refresh drops to the 7-day default | real, reproducible, unfixed |
| Date-picker focus trap | Tab leaves the open panel; panel stays open until an outside click | held deliberately — a naive blur handler fights the re-render |
| ~~Login page: 5 unconfirmed renders~~ | ✅ **CLOSED 2026-08-20** | All five looked at on the real login document (fetched same-origin into an exact-sized iframe with only `checkExistingSession()` neutralised, because a signed-in browser redirects away from `/login`). 1 no faux-bold — every element computes 300, a weight Saira's 100–900 axis really has · 2 mark box derived, `--mark-top` = 0 and height = viewport − gap at all 8 sizes · 3 viewBox cropped to ink (`0.464 2.464 19.072 17.105`, intrinsic 400×359, aspect matches) · 4 already confirmed by Justin · 5 first ring at the top confirmed at every viewport |
| ~~`8bd06ec` owed checks~~ | ✅ **CLOSED 2026-08-20 — the ink sweep is done and the answer did not move** | Swept 8 viewports at the raised position: 11 exposed elements enumerated **from the DOM**, worst case **4.58:1 on `--muted` every time**, AA holds, **0.21 stands for the fourth time**. ⚠ The sweep's floor check caught an instrument fault first — walking ancestors to `<html>` found BODY's opaque background and marked all 11 "shielded", reporting a flawless **zero exposed while looking at nothing** |
| **⚠⚠ The published privacy policy describes Zoom clip handling that does not exist** | `privacy.html` states Scout downloads the Zoom recording, extracts clips and deletes the full recording. **None of it is built** — Scout downloads a VTT transcript and never touches the video; there is no ffmpeg anywhere | **Justin's call: build it or correct the policy.** ⚠ Also corrects the scoping premise — *neither* the download nor the cutting step exists, so Zoom clip extraction is a bigger item than "add ffmpeg". ⚠ Zoom Marketplace review reads this document |
| Bare-domain HTTPS | `https://scoutsystems.io` times out (Namecheap redirect has no 443) | needs Cloudflare DNS migration |
| Stripe billing | `SKIP_BILLING=true`; keys pending | needs the account/org entity first |
| UNKNOWN | Anything Justin is tracking that is not listed here | ⚠ this list was seeded from the repo and the live site; if he has items that live only in conversation, they are not here and should be added rather than assumed |

## AGREED, NOT STARTED — BOTTOM OF THE LIST

| item | one line | notes |
|---|---|---|
| **Role hierarchy — rename all roles and add Director** | Justin's ruling. Top-down: **Executive** (currently `admin`) > **Director** (NEW TIER) > **Manager** (unchanged in kind, but multiple managers AND closers can sit under one Director) > **Closer** (currently `user`) | ⚠⚠ **THIS IS A DATA MIGRATION, NOT A RELABEL.** The role strings `admin` and `user` are **stored values, not display text** — every permission check, every query that filters or branches on role, every test that asserts a role, and every stored row carries them. ⚠⚠ **DIRECTOR IS A GENUINELY NEW TIER, not a rename.** Manager today is a flat "manager of a team"; Director introduces **managers-under-a-director**, a second level of hierarchy the data model has never had. **OPEN: does a Director see every team beneath them aggregated, each separately, or both?** ⚠ **TOUCHES THE PERMISSION WORK SHIPPED 2026-08-20** — `canMarkNotSalesCall` and `canTagOutcome` **deliberately differ and must not be unified**; both branch on role and both need revisiting under a four-tier model. **Whoever picks this up must read that ruling first.** ⚠ **OPEN QUESTIONS, carried so they are not rediscovered:** does a Director inherit a Manager's permissions exactly, or a superset? · can a Director sit above another Director? · does "Executive" still mean account-wide, or organisation-wide? · what happens to existing rows during the rename — a mapping migration, or dual-read during a transition? ⚠ **AGREED, NOT STARTED — Justin has said the team objection drilldown is the priority.** |
