# SCOUT — BUILD LIST

**Created 2026-08-20.** Seeded from the live-site audit and the current repo, **not** from `BUILD-PLAN.md` (19 April, four months stale — treat it as history).

**⚠ STANDING PROCEDURE: update this file after every push, alongside `CLAUDE.md`.**

**⚠ ANYTHING UNVERIFIED IS MARKED `UNKNOWN`.** An invented entry is worse than a gap: a gap gets asked about, an invention gets built.

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
| **Site-wide font: Saira** | Self-hosted variable woff2 (96.4 KB), dashboard + login, body 450, tabular numerals | shipped `284cfdb`/`39faa05`. Verified on the live site: face loads on both pages (registered count + proven control), weight 650 renders natively, no overflow, no login wrap, no nav collision at 1920 |

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
| **Mark a call "not a sales call"** | Excludes it from counting; **closer OR manager can set it** (Justin 2026-08-20, extends the earlier closer-only spec) | ~17 consumers; both halves (upstream filter + downstream exclusion) must ship in ONE commit |
| Customize View — the real feature | Let a manager choose what the team page shows | per-user, not per-org (no org entity needed) |
| **Login page + post-login animation — bring in line with the site** | Neither matches the swept product yet | ⚠ **Confirm Saira is actually rendering on BOTH**, using registered-face-count + a real-vs-bogus width control — **NOT `document.fonts.check`**, which returns true for a face that never loaded (it did exactly that for Montserrat here for months). ⚠ **Login body is still weight 300 while the site is 450** — the 300-forcing rule exists for a limitation that no longer applies (only two Montserrat weights were thought loaded; Saira ships 100–900), so it is now a **free choice nobody has made**. ⚠ The post-login animation's typography and motion were never checked against the swept site. |
| **Nav shows the wordmark, not just "Scout"** | The nav renders the text "Scout"; it should carry the logo lockup | ⚠⚠ **DEPENDS ON the small-size logo variant — see "New Scout Systems logo" above, which records that at nav size concentric rings vanish and a dot renders under a pixel, and the new mark has exactly that construction. Do not attempt the nav lockup before that variant exists.** |
| **Wordmark → Saira wide (`wdth 125`)** | Replace Archivo Expanded on the lockup so it echoes the new logo | ⚠ Needs **k re-derived to 10.321** (above every face the lockup has been sized for) and the lockup guard's weight/tracking/k pairing updated. The login capture shows what normal width costs in presence — Archivo is genuinely EXPANDED and Saira at `wdth 100` visibly shrinks the lockup. **FILED, NOT BUILT** |
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
| Blank graphs on refresh onto `#team` | Pre-existing, not a regression from `87f09d3` (proven by in-memory revert) | the guard that swallows it is still unidentified |
| Colour ramp collision at 8+ reps | 7 colours cycling, so rep 8 shares rep 1's hex | measurement deferred; options for Justin owed |
| Team sub-page hash gap | `#team-recs` / `#team-needs-work` / `#team-members` carry no range, so a refresh drops to the 7-day default | real, reproducible, unfixed |
| Date-picker focus trap | Tab leaves the open panel; panel stays open until an outside click | held deliberately — a naive blur handler fights the re-render |
| Login page: 5 unconfirmed renders | Chrome extension was down across 4 blocks | ⚠ `list_connected_browsers` returned `[]`; needs action on the machine. **Extension is working again as of this session — these are now checkable** |
| `8bd06ec` owed checks | Animation scrub narrowed (wrap fix confirmed by Justin); **ink sweep at the mark's new top position still outstanding** | |
| Bare-domain HTTPS | `https://scoutsystems.io` times out (Namecheap redirect has no 443) | needs Cloudflare DNS migration |
| Stripe billing | `SKIP_BILLING=true`; keys pending | needs the account/org entity first |
| UNKNOWN | Anything Justin is tracking that is not listed here | ⚠ this list was seeded from the repo and the live site; if he has items that live only in conversation, they are not here and should be added rather than assumed |
