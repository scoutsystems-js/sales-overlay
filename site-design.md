# Scout site design: Observatory HUD

Status: approved site standard, recorded 2026-09-12; implemented and live on Team Coaching and Team Performance as of 2026-09-13. Justin’s approval: “yeah i like Observatory best. update the .md file”. The byte-exact approved source is [docs/design/scout-coaching-observatory-approved.html](docs/design/scout-coaching-observatory-approved.html), SHA-256 `238f4c3800a190bfa624c191a0a2b5bca85229475440fe32c414cacd909b3c71`; wrapper: [docs/design/scout-coaching-observatory-preview.html](docs/design/scout-coaching-observatory-preview.html). Polished and Stark are historical; Atelier remains unapproved.

Current HUD visibility calibration: stroke alpha `.14`, dashed alpha `.12`, points alpha `.20`, and scan fill alpha `.17` at scan opacity `.45`—more noticeable, still quiet. Speeds, geometry, gradient, layering, and logic are unchanged; archive `.105`/`.095` values are historical.

## Production implementation scope

The saved implementation applies Observatory styling only to Team → Coaching
and Team → Performance. It preserves the existing server logic, intelligence,
routes, metrics, permissions, data contracts, interactions, and accessibility
behavior. Block 018's current Coaching behavior remains: one verified focus
item and one real supporting call, with no restoration of the retired stage
grid. Performance keeps its three existing trend charts and filters, even
where those controls are absent from the approved static mockup. All other
dashboard pages keep their existing production appearance. Justin confirmed on
2026-09-13 that the mesh must be removed from these redesigned pages: the
forest gradient is their background, with quiet HUD artwork behind opaque panels.

The implementation is saved in `.codex/worktrees/observatory-pages`. All 2,816
backend tests pass with test concurrency limited to four. Desktop and populated
390px phone layouts were reviewed. Release `456ebf5` was verified on Railway
and by raw/comment-stripped served-page markers; see
[the implementation record](docs/design/observatory-implementation.md).

September 13 refinement: implemented and verified live in commit
`9bdfa4e1cbb8322a8f36add576650bf3be6323c5`. The fixed viewport ground uses two
emerald pools separated by a dark center; the noninteractive HUD is fixed with
it. Desktop gutters are 24px and mobile gutters remain 18px. This does not
change page behavior, and the approved mockup archives remain untouched.

September 13 HUD restoration: LIVE and verified in `3cbab93ffa9047103f3b0c66e96dfbf770053f89`.
It restores the approved `1200×860` HUD: two arcs, two rings, four traces,
three points, and a scan. The fixed layer uses opacity `1`, pale `.105` / `.095`
strokes, and 82s orbit; points run at 67s, 91s, and 74s; the scan runs at 28s.
Background-off hides it and reduced motion stops it. The prior refinement remains
live and the approved mockup archives remain untouched.

## Approved visual standard

Team Coaching uses opaque, smooth near-black panels over one expansive forest-green Aurora ground, with pale-sage edges, smooth dark shadows, precise instrument detail, and slow white/gray HUD motion. Do not add fake telemetry, extra metrics, controls, or character/IP imagery. Product rules, metrics, permissions, data, and content remain unchanged.

Root scope is `#scout-coaching-observatory`. The actual source uses `ScoutPolishedSaira, Saira, sans-serif`, base `14px/1.35`, text `#ededed`. The embedded Saira variable payload is 98,760 bytes, SHA-256 `e59235a42c248cf5f9ee37cd8ec84e3e9a3edca1e2935d844845a11f2c600904`, weight 100–900, stretch 50–125%, `font-display:swap`. The wordmark remains archive-authoritative at 104px with its original `#09E046` fill.

The fixed page ground uses two emerald pools separated by a dark center; panels remain opaque. Panel radii are 20px desktop and 16px narrow, with low-contrast sage edges, one quiet inset highlight, and smooth dark shadows. Focus uses `#0f1412`; members/detail/strengths use `#0c0f10`. The selected nav/member state is exact: sage border, 2px `#09d543` left rail, 11px radius, `linear-gradient(100deg,#1b4527,#112617)`, white text, and `0 0 16px rgba(9,213,67,.24)` glow. Member secondary is `rgba(237,237,237,.55)`.

## Observatory hero

Title and filters sit above the hero. The Observatory hero is grid column 2 / row 4, `grid-template-columns:minmax(200px,.85fr) minmax(0,1.3fr)`, gap 22px. Its average instrument is centered in the left column as a vertical group with its label beneath; Coaching Focus sits beside it in the right column at minimum height 250px. The ring is 200px desktop and 140px at 700px or narrower. Its value is 50px at every width because `.sc-hero` specificity intentionally overrides the inherited 37px mobile rule; `/100` is 12px with an 8px gap. At 850px the hero becomes one column and the average becomes a row; at 700px it becomes block layout and the average returns to a column. The workspace begins 20px below the hero with 20px internal gap, reclaiming full width below the nav.

Amber `#fbbf24` remains semantic for the 69/100 ring and stage bars 69/61. The ring retains r48 quiet ticks, r43 track/arc, r34 inner ring, 3.2px main arc, 7px blur(5px) bloom at .4 opacity, and `stroke-dasharray="69 31"`. Green bars are 77, 73, and 80.

## Layout, motion, and content

Current production layout uses a 190px nav column, 22px rail gap, and 24px page gutters; under 900px it uses 18px gutters and stacks the page, and under 620px Coaching stacks the detail below the closer list. The earlier approved archive records a 16px grid gap and its historical phone breakpoints; those archive details remain reference-only. Preserve no horizontal overflow.

The decorative HUD is fixed to the viewport, `aria-hidden`, noninteractive, below opaque content, and visible only in designed gaps/negative space. Orbit is 82s, scan 28s, markers 67–91s; reduced motion disables them. Motion must not cross readable content.

The exact content inventory and semantics remain unchanged: Admin/My Account/toggle; Sober Living Riches and date controls; three Coaching Focus rows; all named closers and the no-calls disclosure; Gabriel Ocasio detail/evidence; five stage score values/counts; and two Team Strengths rows. Native `details` expands; every other control is visual until wired to existing approved behavior.

## Exact approved page content

These are the snapshot values and words, not constants for production. “What to coach next” and “What is already working” are hidden in the approved view; all other listed content remains in its original role.

- Header actions: `Admin`, `My Account`, toggle.
- Nav label: `YOUR WORKSPACE`; items `Coaching Dashboard`, `Calls`, `EOD Report`, `Team⌄`, nested `Daily Digest`, `Performance`, selected `Coaching`, `Objections`, `My Team`, `Customize`; footer `Knowledge Base`.
- Breadcrumb/title: `TEAM / COACHING`, `Team Coaching`.
- Gauge: `TEAM AVERAGE SCORE`, `69`, `/100`, accessible labels `Team average score 69 out of 100` and `69 out of 100`.
- Filters: `Sober Living Riches`; `Sober Living Riches (11)⌄`; white date control `Sep 7 – Sep 11`.
- Focus: `COACHING FOCUS`, `What to coach next`, `3 focus areas`. Rows: `01` “Partner objections are the team's most poorly handled category at 5% resolved, and the pattern…”; `02` “Closing is the weakest section at 67 and the team consistently stops working the deal the moment…”; `03` “The team's recurring one-thing gap is allowing calls to drift or end without locking a specific…”.
- Members: `COACHABLE MOMENTS`, `12 closers`; selected `Gabriel Ocasio` / `Discovery · 18 calls`; `Godwin Ona` / `Discovery · 18 calls`; `Josh P` / `Discovery · 22 calls`; `Nathan Mathura` / `Discovery · 19 calls`; `Nick O'Neal` / `Discovery · 13 calls`; `Preston DeSousa` / `Not enough to judge · 11`; `Yazan Younis` / `Objection Handling · 28`; details summary `No calls · 0`, body `Andrew Lamb · Daniel Lizarazo · Dre Wisam · Drew Clement · Josh N`.
- Detail: `COACHING OVERVIEW`, `Gabriel Ocasio`, `Sep 7–Sep 11`, `LOWEST-SCORING AREA`, `Discovery 73/100`; evidence `DISCOVERY`, “Discovery is the lowest-scoring area, but there is not yet enough reviewed evidence to identify a reliable coaching pattern.”; `CALL EXAMPLE`, `No reviewed call in Discovery to show for these dates.`; `OTHER COACHING FROM THESE CALLS`, `1`.
- Scores: `STAGE SCORES THIS PERIOD`; Intro `77` / `17 graded calls`; Discovery `73` / `16 graded calls`; Pitch `80` / `12 graded calls`; Objection Handling `69` / `7 graded calls · not enough to judge`; Close `61` / `8 graded calls · not enough to judge`.
- Strengths: `TEAM STRENGTHS`, `What is already working`, `2 strengths`; Josh P: “The team’s pitch mechanics are the strongest section on the board, with closers framing the…” / `Closed` / `View exchange →`; Yazan Younis: “Decision-maker awareness is showing up early in the call on winning conversations, with reps…” / `Closed` / `View exchange →`.

## Approved Performance page — 2026-09-12

Justin’s approval: “yo this is perfect save it”. This approves Performance within the Observatory standard; the archive is a saved snapshot, while the production implementation is live. The [byte-exact approved source](docs/design/scout-performance-observatory-approved.html) is authoritative for the exact CSS, SVG, JS, and font; SHA-256 `322a9ce6516731c2c6537e5bfa1ee96045e6591a0652af784f8db7f85481f5ad`. The [standalone preview](docs/design/scout-performance-observatory-preview.html) is the rendered archive.

Performance is active in the approved snapshot, with three glow rings fixed to the last 7 days against a report range of Aug 15–Sep 13. The page uses full-width two-column rep cards below a short nav, with 7 measured and 5 ungraded reps; actual grade, weakest objection, and stage bars; local Closing, Objections, and Grade sort with a direction toggle; responsive behavior from 320px up; and optional glow/HUD tweaks that respect reduced motion. The production implementation retains its existing three trend charts and filters below this approved snapshot composition; the static mockup does not depict those controls.

No trend series are fabricated. The static archive excludes the lower charts;
the implementation preserves the three existing live charts and their controls
in an Observatory panel. Metrics, permissions, and data remain unchanged.


## Implementation boundary

Preserve backend metrics, access rules, active-user filtering, real-call exclusions, and accessibility behavior. Use clean production markup and shared tokens rather than exploratory wrapper nesting. Do not treat historical Polished or Stark CSS as active authority.

## Exact Observatory CSS appendix

All current Observatory source style blocks follow in source order. Font bytes are represented by the archive marker; use the approved archive for their exact payload.

```css
/* style block 1 */
#scout-coaching-observatory{font:14px/1.35 Saira,sans-serif;color:#ededed}#scout-coaching-observatory *{box-sizing:border-box}#scout-coaching-observatory .page{position:relative;isolation:isolate;min-height:860px;overflow:hidden;border:1px solid #ffffff17;border-radius:16px;background:radial-gradient(ellipse 70% 55% at 58% 28%,#09d54317,transparent 66%),radial-gradient(ellipse at 96% 73%,#0b58253a,transparent 52%),#0a0a0a}#scout-coaching-observatory .page:before{content:"";position:absolute;z-index:-1;inset:51px 0 0;background-image:linear-gradient(#ffffff07 1px,transparent 1px),linear-gradient(90deg,#ffffff07 1px,transparent 1px);background-size:56px 56px;mask-image:linear-gradient(90deg,#000,transparent 68%)}#scout-coaching-observatory .top{height:51px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;border-bottom:1px solid #ffffff15;background:#0a0a0aef}#scout-coaching-observatory .brand{display:block;width:104px}#scout-coaching-observatory .actions{display:flex;align-items:center;gap:16px;color:#edededaa;font-size:11px}#scout-coaching-observatory .switch{width:30px;height:16px;padding:2px;border-radius:99px;background:#ffffff28}#scout-coaching-observatory .switch i{display:block;width:12px;height:12px;transform:translateX(14px);border-radius:50%;background:#ededed}#scout-coaching-observatory .sc-nav{position:absolute;top:68px;bottom:14px;left:14px;width:170px;padding:14px 10px;border:1px solid #ffffff18;border-radius:16px;background:#0a0a0ad9;box-shadow:0 18px 45px #0000003d}#scout-coaching-observatory .sc-nav p,#scout-coaching-observatory label{margin:0;color:#ededed8c;font-size:11px;font-weight:500;letter-spacing:.13em}#scout-coaching-observatory .sc-nav a,#scout-coaching-observatory .sc-nav b{display:block;padding:7px 8px;color:#edededbb;font-size:12px;font-weight:400}#scout-coaching-observatory .sc-nav .in{padding-left:18px}#scout-coaching-observatory .sc-nav .sel{border-left:2px solid #09d543;background:#09d5431c;color:#ededed}#scout-coaching-observatory .sc-nav footer{position:absolute;left:10px;right:10px;bottom:15px;padding:9px 8px 0;border-top:1px solid #ffffff14;font-size:12px}#scout-coaching-observatory main{max-width:1180px;margin-left:202px;padding:29px 42px 42px}#scout-coaching-observatory .title,#scout-coaching-observatory .filters,#scout-coaching-observatory .panel>header,#scout-coaching-observatory .detail>footer,#scout-coaching-observatory .strength article{display:flex;justify-content:space-between;gap:15px}#scout-coaching-observatory .title{align-items:end}#scout-coaching-observatory .title h1{margin:4px 0 0;font-size:30px;line-height:1;font-weight:400;letter-spacing:-.04em}#scout-coaching-observatory .avg{display:flex;gap:10px;align-items:center}#scout-coaching-observatory .avg b{font-size:25px;font-weight:300}#scout-coaching-observatory .avg small{color:#ededed88;font-size:11px;letter-spacing:.1em}#scout-coaching-observatory .filters{align-items:center;margin:23px 0 16px;padding:11px 0;border-block:1px solid #ffffff16}#scout-coaching-observatory .company{font-size:15px}#scout-coaching-observatory .picks{display:flex;gap:8px}#scout-coaching-observatory .pick{padding:7px 10px;border:1px solid #ffffff20;border-radius:8px;color:#edededc7;font-size:11px}#scout-coaching-observatory .white{border-color:#ededed;background:#ededed;color:#0a0a0a}#scout-coaching-observatory .panel{border:1px solid #ffffff19;border-radius:16px;background:#0d110edb;box-shadow:inset 0 1px #ffffff08,0 18px 45px #0000003d}#scout-coaching-observatory .panel>header h2{margin:3px 0 0;font-size:18px;font-weight:400;line-height:1.1}#scout-coaching-observatory .panel>header>small{color:#ededed82;font-size:11px}#scout-coaching-observatory .focus{padding:17px 19px;background:linear-gradient(115deg,#0d1e12f2,#0b0e0bf0)}#scout-coaching-observatory .focus>div{display:grid;grid-template-columns:28px 1fr 16px;gap:8px;align-items:center;padding:11px 0;border-top:1px solid #ffffff14}#scout-coaching-observatory .focus>div:first-of-type{margin-top:12px}#scout-coaching-observatory .focus b{color:#09d543;font-size:11px}#scout-coaching-observatory .focus p{margin:0;color:#edededda;font-size:13px}#scout-coaching-observatory .focus i{font-style:normal;color:#ededed88;font-size:17px}#scout-coaching-observatory .workspace{display:grid;grid-template-columns:205px 1fr;gap:16px;margin-top:16px}#scout-coaching-observatory .members{padding:15px 9px}#scout-coaching-observatory .members header{padding:0 6px 10px}#scout-coaching-observatory .members button{width:100%;padding:8px;border:0;border-radius:8px;background:transparent;color:#ededed;text-align:left;font:inherit}#scout-coaching-observatory .members button strong,#scout-coaching-observatory .members button small{display:block}#scout-coaching-observatory .members button strong{font-weight:400;font-size:12px}#scout-coaching-observatory .members button small,#scout-coaching-observatory .members details{color:#ededed80;font-size:11px}#scout-coaching-observatory .members .chosen{background:#09d54317;box-shadow:inset 2px 0 #09d543}#scout-coaching-observatory .members details{margin:12px 6px 0;padding-top:10px;border-top:1px solid #ffffff14}#scout-coaching-observatory .members details p{line-height:1.55}#scout-coaching-observatory .detail{padding:19px}#scout-coaching-observatory .lowest{text-align:right}#scout-coaching-observatory .lowest b{display:block;margin-top:4px;font-size:14px;font-weight:400}#scout-coaching-observatory .lowest em{color:#fbbf24;font-style:normal}#scout-coaching-observatory .detail header small{color:#ededed88;font-size:11px}#scout-coaching-observatory .evidence{margin-top:18px;padding:15px;border-block:1px solid #ffffff14;background:#00000024}#scout-coaching-observatory .evidence>p{max-width:640px;margin:7px 0 13px;color:#edededd5}#scout-coaching-observatory .evidence div{display:flex;gap:9px;margin-top:6px;font-size:11px}#scout-coaching-observatory .evidence b{min-width:176px;color:#ededed8c;font-size:11px;letter-spacing:.1em}#scout-coaching-observatory .evidence span{color:#edededb8}#scout-coaching-observatory .scores{margin-top:17px}#scout-coaching-observatory .scoregrid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:10px}#scout-coaching-observatory .score{position:relative;min-height:91px;padding:10px 8px 11px;overflow:hidden;border:1px solid #ffffff14;border-radius:8px;background:#ffffff06}#scout-coaching-observatory .score:after{content:"";position:absolute;bottom:0;left:0;width:var(--bar);height:2px;background:var(--color)}#scout-coaching-observatory .score span{display:block;color:#ededed9a;font-size:11px}#scout-coaching-observatory .score b{display:block;margin-top:3px;font-size:20px;font-weight:300}#scout-coaching-observatory .score small{display:block;margin-top:2px;color:#ededed78;font-size:9px;line-height:1.25}#scout-coaching-observatory .detail>footer{align-items:center;margin-top:16px}#scout-coaching-observatory .detail>footer span{color:#edededbe;font-size:12px}#scout-coaching-observatory .strengths{margin-top:16px;padding:17px 19px}#scout-coaching-observatory .strength{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}#scout-coaching-observatory .strength article{padding:13px;border:1px solid #ffffff14;border-radius:10px;background:#00000020}#scout-coaching-observatory .strength p{margin:5px 0 0;color:#edededb5;font-size:12px}#scout-coaching-observatory .strength aside{display:grid;align-content:space-between;text-align:right;color:#ededed7a;font-size:11px}#scout-coaching-observatory .strength a{color:#09d543;font-size:11px}@media(max-width:700px){#scout-coaching-observatory .page{min-height:0}#scout-coaching-observatory .sc-nav{position:relative!important;inset:auto!important;width:auto!important;margin:12px;display:flex;flex-wrap:wrap;gap:1px}#scout-coaching-observatory .sc-nav p,#scout-coaching-observatory .sc-nav b,#scout-coaching-observatory .sc-nav footer{display:none!important}#scout-coaching-observatory .sc-nav a,#scout-coaching-observatory .sc-nav .in{padding:5px 7px}#scout-coaching-observatory main{margin:0;padding:22px 15px 30px}#scout-coaching-observatory .filters,#scout-coaching-observatory .title{align-items:start;flex-direction:column}#scout-coaching-observatory .picks{flex-wrap:wrap}#scout-coaching-observatory .workspace{grid-template-columns:1fr}#scout-coaching-observatory .members{display:grid;grid-template-columns:1fr 1fr;gap:1px}#scout-coaching-observatory .members header,#scout-coaching-observatory .members details{grid-column:1/-1}#scout-coaching-observatory .scoregrid{grid-template-columns:1fr 1fr}#scout-coaching-observatory .strength{grid-template-columns:1fr}#scout-coaching-observatory .detail header{flex-direction:column}#scout-coaching-observatory .lowest{text-align:left}#scout-coaching-observatory .evidence div{display:block}#scout-coaching-observatory .evidence b{display:block;margin-bottom:2px}}@media(max-width:380px){#scout-coaching-observatory .scoregrid{grid-template-columns:1fr}}


/* style block 2 */

#scout-coaching-observatory .page{background:radial-gradient(ellipse 60% 65% at 31% 46%,rgba(16,100,43,.22),transparent 73%),radial-gradient(ellipse 55% 55% at 88% 12%,rgba(9,213,67,.08),transparent 64%),linear-gradient(140deg,#101b13,#0a0a0a 57%,#0a0c0a)}
#scout-coaching-observatory main{padding-top:24px}
#scout-coaching-observatory .focus,#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{background:linear-gradient(145deg,rgba(17,25,18,.94),rgba(10,11,10,.99));box-shadow:inset 0 1px rgba(9,213,67,.32),0 24px 55px rgba(0,0,0,.33)}
#scout-coaching-observatory .focus{background:linear-gradient(130deg,rgba(20,45,27,.85),rgba(12,16,12,.98))}
#scout-coaching-observatory .members .chosen{background:linear-gradient(100deg,rgba(9,213,67,.18),rgba(9,213,67,.05));box-shadow:inset 2px 0 #09d543,0 0 20px rgba(9,213,67,.10)}
#scout-coaching-observatory .score[style*="09e046"]:after{box-shadow:0 0 8px rgba(9,213,67,.85)}


/* style block 3 */
#scout-coaching-observatory .sc-nav{display:block;bottom:auto;height:auto}#scout-coaching-observatory .sc-nav footer{position:static;margin-top:8px}#scout-coaching-observatory .lowest em{color:#ededed}#scout-coaching-observatory .focus>header h2,#scout-coaching-observatory .strengths>header h2{display:none}#scout-coaching-observatory .page{background:radial-gradient(ellipse 60% 65% at 31% 46%,rgba(16,100,43,.28),transparent 73%),radial-gradient(ellipse 55% 55% at 88% 12%,rgba(9,213,67,.1),transparent 64%),linear-gradient(140deg,#101b13,#0a0a0a 57%,#0a0c0a)}#scout-coaching-observatory .members .chosen{background:linear-gradient(100deg,rgba(9,213,67,.18),rgba(9,213,67,.05));box-shadow:inset 2px 0 #09d543,0 0 20px rgba(9,213,67,.10)}#scout-coaching-observatory .score[style*="09e046"]:after{box-shadow:0 0 8px rgba(9,213,67,.85)}@media(max-width:700px){#scout-coaching-observatory .sc-nav{display:grid;grid-template-columns:1fr 1fr;height:auto;gap:2px}#scout-coaching-observatory .sc-nav footer{display:block!important;grid-column:1/-1}}

/* style block 4 */

#scout-coaching-observatory .page{display:grid;grid-template-columns:190px minmax(0,1fr);grid-template-rows:51px auto auto auto auto auto;gap:0 16px;min-height:0;padding:0 18px 26px;background:radial-gradient(ellipse 66% 72% at 26% 44%,rgba(16,100,43,.304),transparent 70%),radial-gradient(ellipse 62% 62% at 88% 10%,rgba(9,213,67,.1425),transparent 65%),linear-gradient(140deg,#101b13,#0a0a0a 58%,#0a0e0b)}
#scout-coaching-observatory .top{grid-column:1/-1;margin:0 -18px}
#scout-coaching-observatory .sc-nav{position:static;grid-column:1;grid-row:2 / span 3;align-self:stretch;width:auto;height:auto;margin:17px 0 0;border-color:rgba(218,255,228,.24);box-shadow:inset 0 1px 0 rgba(230,255,238,.42),0 0 0 1px rgba(9,213,67,.10),0 0 30px rgba(9,213,67,.12),0 24px 52px rgba(0,0,0,.38);background:linear-gradient(160deg,rgba(14,25,17,.97),rgba(10,10,10,.98))}
#scout-coaching-observatory .sc-nav footer{position:static;margin-top:18px}
#scout-coaching-observatory main{display:contents}
#scout-coaching-observatory .title{grid-column:2;grid-row:2;margin-top:22px}
#scout-coaching-observatory .filters{grid-column:2;grid-row:3;margin:17px 0 13px}
#scout-coaching-observatory .focus{grid-column:2;grid-row:4;margin:0;padding:17px 19px;border-color:rgba(218,255,228,.25);background:linear-gradient(130deg,rgba(22,53,31,.88),rgba(12,16,12,.98));box-shadow:inset 0 1px 0 rgba(236,255,241,.46),0 0 0 1px rgba(9,213,67,.12),0 0 34px rgba(9,213,67,.18),0 24px 52px rgba(0,0,0,.28)}
#scout-coaching-observatory .workspace{grid-column:1/-1;grid-row:5;grid-template-columns:205px minmax(0,1fr);gap:16px;margin:16px 0 0}
#scout-coaching-observatory .strengths{grid-column:1/-1;grid-row:6;margin:16px 0 0}
#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{border-color:rgba(218,255,228,.21);box-shadow:inset 0 1px 0 rgba(236,255,241,.36),0 0 0 1px rgba(9,213,67,.08),0 0 28px rgba(9,213,67,.11),0 24px 48px rgba(0,0,0,.31)}
#scout-coaching-observatory .members .chosen{border:1px solid rgba(220,255,230,.40);background:linear-gradient(100deg,rgba(9,213,67,.23),rgba(9,213,67,.065));box-shadow:inset 2px 0 #09d543,0 0 18px rgba(9,213,67,.22)}
#scout-coaching-observatory .score{border-color:rgba(220,255,230,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.11),0 0 15px rgba(9,213,67,.045)}
#scout-coaching-observatory .score[style*="09e046"]{border-color:rgba(175,255,198,.26);box-shadow:inset 0 1px 0 rgba(230,255,236,.3),0 0 16px rgba(9,213,67,.12)}
#scout-coaching-observatory .avg{gap:12px}
#scout-coaching-observatory .ring-gauge{position:relative;display:grid;place-items:center;width:86px;height:86px;flex:0 0 86px;border-radius:50%;background:radial-gradient(circle,rgba(251,191,36,.09),transparent 56%),radial-gradient(circle,rgba(9,213,67,.16),transparent 70%);box-shadow:0 0 36px rgba(9,213,67,.25)}
#scout-coaching-observatory .ring-gauge svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
#scout-coaching-observatory .ring-gauge circle{fill:none}
#scout-coaching-observatory .ring-track{stroke:rgba(237,237,237,.15);stroke-width:5}
#scout-coaching-observatory .ring-bloom{stroke:#fbbf24;stroke-width:11;stroke-linecap:round;filter:blur(8px);opacity:.55}
#scout-coaching-observatory .ring-arc{stroke:#fbbf24;stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 3px rgba(255,237,178,.96)) drop-shadow(0 0 9px rgba(251,191,36,.85))}
#scout-coaching-observatory .ring-gauge span{position:relative;font-size:22px;font-weight:300;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
#scout-coaching-observatory .ring-gauge em{font-size:11px;font-style:normal;color:rgba(237,237,237,.62)}
#scout-coaching-observatory .avg small{max-width:72px}
@media(max-width:700px){#scout-coaching-observatory .page{display:block;padding:0;min-height:0}#scout-coaching-observatory .top{margin:0}#scout-coaching-observatory .sc-nav{display:grid;grid-template-columns:1fr 1fr;height:auto;margin:12px;gap:2px}#scout-coaching-observatory .sc-nav footer{display:block!important;grid-column:1/-1}#scout-coaching-observatory main{display:block}#scout-coaching-observatory .title,#scout-coaching-observatory .filters,#scout-coaching-observatory .focus,#scout-coaching-observatory .workspace,#scout-coaching-observatory .strengths{margin-left:0;margin-right:0}#scout-coaching-observatory .ring-gauge{width:72px;height:72px;flex-basis:72px}}


/* style block 5 */
@media(max-width:700px){#scout-coaching-observatory .workspace{grid-template-columns:minmax(0,1fr);width:100%;min-width:0}#scout-coaching-observatory .detail,#scout-coaching-observatory .members{min-width:0}}

/* style block 6 */

#scout-coaching-observatory .top{background:#0a0a0a}
#scout-coaching-observatory .sc-nav{background:#0c0e0c!important}
#scout-coaching-observatory .panel,#scout-coaching-observatory .focus,#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{background:#101210!important}
#scout-coaching-observatory .evidence,#scout-coaching-observatory .stage,#scout-coaching-observatory .strength article{background:#0c0e0c!important}
#scout-coaching-observatory .ring-gauge{background:#0c0e0c!important;box-shadow:0 0 36px rgba(9,213,67,.25),0 0 72px rgba(9,213,67,.11)}
#scout-coaching-observatory .sc-nav .sel,#scout-coaching-observatory .members .chosen{border:1px solid #09d543!important;border-left:4px solid #067d28!important;border-radius:8px!important;background:#09d543!important;color:#0a0a0a!important;box-shadow:inset 3px 0 0 #067d28,0 0 18px rgba(9,213,67,.32)!important}
#scout-coaching-observatory .sc-nav .sel *,#scout-coaching-observatory .members .chosen *{color:#0a0a0a!important}


/* style block 7 */

#scout-coaching-observatory .sc-nav .sel,#scout-coaching-observatory .members .chosen{border:1px solid rgba(218,255,228,.52)!important;border-left:2px solid #09d543!important;border-radius:11px!important;background:linear-gradient(100deg,#1b4527,#112617)!important;color:#ededed!important;font-weight:400!important;box-shadow:0 0 16px rgba(9,213,67,.24)!important}
#scout-coaching-observatory .sc-nav .sel *,#scout-coaching-observatory .members .chosen *{color:#ededed!important;font-weight:400!important}
#scout-coaching-observatory .members .chosen small{color:rgba(237,237,237,.55)!important}
#scout-coaching-observatory .score{background:#171917!important}


/* style block 8 */

#scout-coaching-observatory .sc-hud{position:absolute;z-index:0;inset:51px 0 0;overflow:hidden;pointer-events:none}
#scout-coaching-observatory .sc-hud svg{width:100%;height:100%;display:block}
#scout-coaching-observatory .sc-hud-arc,#scout-coaching-observatory .sc-hud-ring,#scout-coaching-observatory .sc-hud-traces path{fill:none;stroke:rgba(237,237,237,.11);stroke-width:1}
#scout-coaching-observatory .sc-hud-dash{stroke-dasharray:3 13;stroke:rgba(237,237,237,.095)}
#scout-coaching-observatory .sc-hud-orbit{transform-origin:600px 420px;animation:scout-observatory-hud-orbit 82s linear infinite}
#scout-coaching-observatory .sc-hud-markers circle{fill:rgba(237,237,237,.15);filter:drop-shadow(0 0 3px rgba(237,237,237,.25));animation:scout-observatory-hud-marker 67s ease-in-out infinite alternate}
#scout-coaching-observatory .sc-hud-markers circle:nth-child(2){animation-duration:91s;animation-delay:-19s}
#scout-coaching-observatory .sc-hud-markers circle:nth-child(3){animation-duration:74s;animation-delay:-37s}
#scout-coaching-observatory .sc-hud-scan{fill:rgba(237,237,237,.14);filter:blur(.35px);animation:scout-observatory-hud-scan 28s linear infinite}
#scout-coaching-observatory .top,#scout-coaching-observatory .sc-nav,#scout-coaching-observatory .title,#scout-coaching-observatory .filters,#scout-coaching-observatory .focus,#scout-coaching-observatory .workspace,#scout-coaching-observatory .strengths{position:relative;z-index:1}
@keyframes scout-observatory-hud-orbit{to{transform:rotate(360deg)}}
@keyframes scout-observatory-hud-scan{0%{transform:translateY(-10px)}100%{transform:translateY(880px)}}
@keyframes scout-observatory-hud-marker{0%{transform:translate(0,0)}100%{transform:translate(13px,-9px)}}
@media(prefers-reduced-motion:reduce){#scout-coaching-observatory .sc-hud-orbit,#scout-coaching-observatory .sc-hud-markers circle,#scout-coaching-observatory .sc-hud-scan{animation:none!important}}


/* style block 9 */
#scout-coaching-observatory .sc-nav{inset:auto}

/* style block 10 */

@font-face{font-family:ScoutPolishedSaira;src:url(data:font/woff2;base64,[ARCHIVED-SAIRA-SHA-e59235a42c248cf5f9ee37cd8ec84e3e9a3edca1e2935d844845a11f2c600904]) format("woff2");font-weight:100 900;font-stretch:50% 125%;font-display:swap}
#scout-coaching-observatory{font-family:ScoutPolishedSaira,Saira,sans-serif}
#scout-coaching-observatory .page{background:radial-gradient(ellipse 86% 88% at 9% 49%,rgba(20,109,52,.29),transparent 71%),radial-gradient(ellipse 74% 70% at 92% 18%,rgba(13,82,41,.23),transparent 71%),linear-gradient(136deg,#0b1210,#090a0b 57%,#0a120e)}
#scout-coaching-observatory .top{background:#090a0b;border-bottom-color:rgba(219,239,226,.13)}
#scout-coaching-observatory .sc-nav,#scout-coaching-observatory .focus,#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{border:1px solid rgba(215,236,222,.17)!important;border-radius:20px!important;background:#0d1011!important;box-shadow:inset 0 1px 0 rgba(245,255,248,.09),0 28px 58px rgba(0,0,0,.42)!important}
#scout-coaching-observatory .focus{background:#0f1412!important;border-color:rgba(215,236,222,.21)!important;box-shadow:inset 0 1px 0 rgba(247,255,249,.13),0 28px 58px rgba(0,0,0,.43)!important}
#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{background:#0c0f10!important}
#scout-coaching-observatory .focus:before,#scout-coaching-observatory .detail:before,#scout-coaching-observatory .strengths:before,#scout-coaching-observatory .focus:after,#scout-coaching-observatory .detail:after,#scout-coaching-observatory .strengths:after{opacity:.36}
#scout-coaching-observatory .workspace{gap:20px;margin-top:20px}
#scout-coaching-observatory .strengths{margin-top:20px;padding:22px 24px}
#scout-coaching-observatory .focus{padding:22px 24px}
#scout-coaching-observatory .members,#scout-coaching-observatory .detail{padding:20px}
#scout-coaching-observatory .score{background:#111416!important;border-color:rgba(215,236,222,.11)!important;box-shadow:none!important}
#scout-coaching-observatory .evidence{background:#0a0c0d!important;border-color:rgba(215,236,222,.10)!important}
#scout-coaching-observatory .strength article{background:#101315!important;border-color:rgba(215,236,222,.10)!important;box-shadow:none!important}
#scout-coaching-observatory .scoregrid{gap:8px}
#scout-coaching-observatory .title{margin-top:29px;padding-bottom:10px}
#scout-coaching-observatory .title h1{font-size:34px;letter-spacing:-.05em}
#scout-coaching-observatory .avg{gap:16px}
#scout-coaching-observatory .ring-gauge{width:152px;height:152px;flex-basis:152px;background:#0b0f0e!important;box-shadow:0 0 0 1px rgba(215,236,222,.10),inset 0 0 32px rgba(251,191,36,.045),0 24px 58px rgba(0,0,0,.38)!important}
#scout-coaching-observatory .ring-gauge:before{inset:-10px;background:repeating-conic-gradient(from -90deg,rgba(221,238,227,.34) 0 1deg,transparent 1deg 7deg);mask:radial-gradient(transparent 66%,#000 67% 68%,transparent 69%);-webkit-mask:radial-gradient(transparent 66%,#000 67% 68%,transparent 69%)}
#scout-coaching-observatory .ring-gauge:after{content:"";position:absolute;inset:15px;border:1px solid rgba(221,238,227,.11);border-radius:50%;box-shadow:0 0 0 8px rgba(251,191,36,.018)}
#scout-coaching-observatory .ring-gauge span{font-size:40px;z-index:1}
#scout-coaching-observatory .ring-gauge em{font-size:12px;margin-top:7px}
#scout-coaching-observatory .avg small{max-width:84px;line-height:1.3}
#scout-coaching-observatory .sc-nav .sel,#scout-coaching-observatory .members .chosen{border:1px solid rgba(211,237,217,.52)!important;border-left:2px solid #09d543!important;border-radius:11px!important;background:linear-gradient(100deg,#1b4527,#112617)!important;color:#ededed!important;box-shadow:0 0 16px rgba(9,213,67,.24)!important}
#scout-coaching-observatory .sc-nav .sel *,#scout-coaching-observatory .members .chosen *{color:#ededed!important}
#scout-coaching-observatory .members .chosen small{color:rgba(237,237,237,.55)!important}
#scout-coaching-observatory .sc-hud-arc,#scout-coaching-observatory .sc-hud-ring,#scout-coaching-observatory .sc-hud-traces path{stroke:rgba(227,238,233,.105)}
#scout-coaching-observatory .sc-hud-scan{opacity:.45}
@media(max-width:700px){#scout-coaching-observatory .sc-nav,#scout-coaching-observatory .focus,#scout-coaching-observatory .members,#scout-coaching-observatory .detail,#scout-coaching-observatory .strengths{border-radius:16px!important}#scout-coaching-observatory .workspace{gap:16px;margin-top:16px}#scout-coaching-observatory .ring-gauge{width:112px;height:112px;flex-basis:112px}#scout-coaching-observatory .ring-gauge span{font-size:32px}#scout-coaching-observatory .title h1{font-size:29px}}

/* style block 11 */

#scout-coaching-observatory small{font-size:11px!important}
#scout-coaching-observatory .stage{min-height:98px}
#scout-coaching-observatory .strength article aside{min-width:102px}
#scout-coaching-observatory .strength article aside a{white-space:nowrap}


/* style block 12 */

#scout-coaching-observatory .ring-gauge span{display:flex;flex-direction:column;align-items:center;line-height:1;letter-spacing:-.05em}
#scout-coaching-observatory .ring-gauge em{display:block;margin-top:8px;font-size:12px;letter-spacing:.08em}
#scout-coaching-observatory .ring-ticks{fill:none;stroke:rgba(221,238,227,.30);stroke-width:.65;stroke-dasharray:.45 2.05}
#scout-coaching-observatory .ring-inner{fill:none;stroke:rgba(221,238,227,.15);stroke-width:.7}
#scout-coaching-observatory .ring-arc{stroke-width:3.2}
#scout-coaching-observatory .ring-bloom{stroke-width:7;filter:blur(5px);opacity:.4}


/* style block 13 */

#scout-coaching-observatory .title{min-height:224px;align-items:center;margin-top:22px;padding:0 10px 0 2px}
#scout-coaching-observatory .title h1{font-size:38px}
#scout-coaching-observatory .avg{gap:24px}
#scout-coaching-observatory .ring-gauge{width:196px;height:196px;flex-basis:196px}
#scout-coaching-observatory .ring-gauge span{font-size:48px}
#scout-coaching-observatory .ring-gauge em{font-size:12px}
#scout-coaching-observatory .filters{margin-top:0}
#scout-coaching-observatory .focus{margin-top:8px}
#scout-coaching-observatory .workspace{margin-top:24px;gap:20px}
#scout-coaching-observatory .strengths{margin-top:20px}
@media(max-width:700px){#scout-coaching-observatory .title{min-height:0;padding:0;margin-top:22px}#scout-coaching-observatory .title h1{font-size:30px}#scout-coaching-observatory .ring-gauge{width:130px;height:130px;flex-basis:130px}#scout-coaching-observatory .ring-gauge span{font-size:37px}}

/* style block 14 */
#scout-coaching-observatory .strength article aside{min-width:102px}#scout-coaching-observatory .strength article aside a{white-space:nowrap}

/* style block 15 */

#scout-coaching-observatory .title{min-height:0;align-items:start;margin-top:26px;padding:0}
#scout-coaching-observatory .title h1{font-size:32px}
#scout-coaching-observatory .filters{margin:16px 0}
#scout-coaching-observatory .sc-hero{grid-column:2;grid-row:4;display:grid;grid-template-columns:minmax(200px,.85fr) minmax(0,1.3fr);gap:22px;align-items:stretch}
#scout-coaching-observatory .sc-hero .avg{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;min-height:250px}
#scout-coaching-observatory .sc-hero .avg small{max-width:150px;text-align:center}
#scout-coaching-observatory .sc-hero .ring-gauge{width:200px;height:200px;flex-basis:200px}
#scout-coaching-observatory .sc-hero .ring-gauge span{font-size:50px}
#scout-coaching-observatory .sc-hero .focus{grid-column:auto;grid-row:auto;margin:0;min-height:250px;align-self:stretch}
#scout-coaching-observatory .sc-hero .focus>div{padding:14px 0}
#scout-coaching-observatory .workspace{grid-row:5;margin-top:20px}
@media(max-width:850px){#scout-coaching-observatory .sc-hero{grid-template-columns:1fr}#scout-coaching-observatory .sc-hero .avg{min-height:0;flex-direction:row;justify-content:start}#scout-coaching-observatory .sc-hero .focus{min-height:0}}@media(max-width:700px){#scout-coaching-observatory .sc-hero{display:block;margin-top:16px}#scout-coaching-observatory .sc-hero .avg{margin-bottom:16px;justify-content:center;flex-direction:column}#scout-coaching-observatory .sc-hero .ring-gauge{width:140px;height:140px;flex-basis:140px}}

```


## Exact structural markup

The archive is authoritative for complete markup and embedded wordmark. These current source fragments pin the HUD, instrument, and Observatory hero structure.

```html
<div class="sc-hud" aria-hidden="true"><svg viewBox="0 0 1200 860" preserveAspectRatio="xMidYMid slice"><g class="sc-hud-orbit"><path class="sc-hud-arc" d="M-80 700 A650 650 0 0 1 800 -70"/><path class="sc-hud-arc sc-hud-dash" d="M168 820 A690 690 0 0 1 1040 35"/><circle class="sc-hud-ring" cx="600" cy="420" r="318"/><circle class="sc-hud-ring sc-hud-dash" cx="600" cy="420" r="280"/></g><g class="sc-hud-traces"><path d="M38 196 H300 L342 154 H502"/><path d="M774 735 H1030 L1072 693 H1160"/><path d="M896 222 H1120"/><path d="M77 612 H202"/></g><g class="sc-hud-markers"><circle cx="214" cy="195" r="3"/><circle cx="903" cy="735" r="3"/><circle cx="1020" cy="222" r="2.5"/></g><rect class="sc-hud-scan" x="0" y="-5" width="1200" height="1"/></svg></div>

<!-- gauge -->
<div class="ring-gauge" aria-label="Team average score 69 out of 100"><svg viewBox="0 0 100 100" role="img" aria-label="69 out of 100"><circle class="ring-ticks" cx="50" cy="50" r="48" pathLength="100"></circle><circle class="ring-track" cx="50" cy="50" r="43" pathLength="100"></circle><circle class="ring-inner" cx="50" cy="50" r="34"></circle><circle class="ring-bloom" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle><circle class="ring-arc" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle></svg><span>69<em>/100</em></span></div><small>TEAM AVERAGE SCORE</small>

<!-- hero -->
<div class="sc-hero"><div class="avg"><div class="ring-gauge" aria-label="Team average score 69 out of 100"><svg viewBox="0 0 100 100" role="img" aria-label="69 out of 100"><circle class="ring-ticks" cx="50" cy="50" r="48" pathLength="100"></circle><circle class="ring-track" cx="50" cy="50" r="43" pathLength="100"></circle><circle class="ring-inner" cx="50" cy="50" r="34"></circle><circle class="ring-bloom" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle><circle class="ring-arc" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle></svg><span>69<em>/100</em></span></div><small>TEAM AVERAGE SCORE</small></div><section class="panel focus"><header><div><label>COACHING FOCUS</label><h2>What to coach next</h2></div><small>3 focus areas</small></header><div><b>01</b><p>Partner objections are the team's most poorly handled category at 5% resolved, and the pattern…</p><i>+</i></div><div><b>02</b><p>Closing is the weakest section at 67 and the team consistently stops working the deal the moment…</p><i>+</i></div><div><b>03</b><p>The team's recurring one-thing gap is allowing calls to drift or end without locking a specific…</p><i>+</i></div></section></div>
```
