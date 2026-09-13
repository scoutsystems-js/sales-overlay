# Scout site design: Polished HUD

Status: approved site standard, recorded 2026-09-12. This is not deployed. The byte-exact source is [docs/design/scout-coaching-polished-approved.html](docs/design/scout-coaching-polished-approved.html), SHA-256 `9a41142cac8430dc21029e2173160d91369fe165162b58cfbb2537117a149a58`; wrapper: [docs/design/scout-coaching-polished-preview.html](docs/design/scout-coaching-polished-preview.html). Observatory and Atelier are unapproved explorations.

## Approved visual standard

Justin's approval of this exact refinement: “ok save this as the new standard.” This supersedes the earlier Stark appearance after his feedback that it was not as clean and smooth as the finance-dashboard reference. Preserve the actual embedded font, quieter panel edges, more generous spacing, and crisp focal ring that distinguish Polished HUD. The older [Stark source](docs/design/scout-coaching-stark-approved.html) and [Stark preview](docs/design/scout-coaching-stark-preview.html) are retained for history only. The visual materials are the site-wide direction; only Team Coaching has been mocked in detail.

Team Coaching uses opaque, smooth near-black panels over one expansive forest-green Aurora background. Fine pale-sage 1px edges, a single quiet top inset, careful spacing, and slow white/gray HUD geometry create the engineered feel. Do not add Iron Man logos, fake telemetry, controls, or metrics. This changes visual treatment only; Scout product, metric, permission, data, and content rules remain in force.

Root scope is `#scout-coaching-polished`; text is `#ededed`; base is `14px/1.35`. The real embedded variable face is `ScoutPolishedSaira, Saira, sans-serif`, weight 100–900, stretch 50–125%, `font-display:swap`. Its archived payload is 98,760 bytes, SHA-256 `e59235a42c248cf5f9ee37cd8ec84e3e9a3edca1e2935d844845a11f2c600904`. The inline wordmark stays byte-exact at 104px, with its original `#09E046` fill.

The page Aurora is `radial-gradient(ellipse 86% 88% at 9% 49%,rgba(20,109,52,.29),transparent 71%)`, `radial-gradient(ellipse 74% 70% at 92% 18%,rgba(13,82,41,.23),transparent 71%)`, and `linear-gradient(136deg,#0b1210,#090a0b 57%,#0a120e)`. This is the only broad green glow. The top bar is 51px and `#090a0b`.

Panels use 20px radius desktop, 16px narrow, opaque fills, low-contrast sage edge, and smooth dark shadow only: `#0f1412` focus; `#0c0f10` members/detail/strengths; supporting wells are quiet flat dark surfaces. Focus padding is 22px/24px; members/detail 20px; strengths 22px/24px; workspace column gap and section top margins 20px; the inner strengths grid retains a 12px gap. The shared selected nav/member state is exact: `border:1px solid rgba(211,237,217,.52)`, `border-left:2px solid #09d543`, `border-radius:11px`, `linear-gradient(100deg,#1b4527,#112617)`, white text, `0 0 16px rgba(9,213,67,.24)`; member secondary is `rgba(237,237,237,.55)`.

Amber `#fbbf24` is semantic: Team Average 69/100 and stage bars 69/61. The ring is 152px desktop / 112px narrow. Value is 40px / 32px; `/100` stacks below at 12px with 8px gap. It has r48 quiet ticks, r43 track and 69% amber arc, r34 inner ring, 3.2px round arc, and a 7px bloom at blur(5px), opacity .4; both arc layers use `stroke-dasharray="69 31"`. Scout accent is `#09d543`; preserve green stage bars at 77/73/80.

Desktop geometry is a 190px nav column plus flexible content, 16px column gap, page padding 0 18px 26px. The lower Coachable Moments workspace and Team Strengths are full width below the upper nav. At 700px the page is block layout: nav two columns, workspace one, members two, scores two, strengths one; at 380px scores one. No horizontal overflow.

The decorative HUD is `aria-hidden`, noninteractive, below opaque content, visible only in intentional gaps. White/gray orbit is 82s; scan is 28s; markers 67–91s. Reduced motion disables all HUD animations. Opaque reading panels separate their text from the artwork; retain that separation when implementing.

The exact mockup content and semantics remain unchanged: Admin/My Account/toggle; Sober Living Riches and date controls; three Coaching Focus rows; all named closers and no-calls disclosure; Gabriel Ocasio detail and evidence; five stage values/counts; and two Team Strengths rows. Native `details` expands; all other controls are visual until wired to approved existing behavior. The source’s inactive pseudo selectors must not be promised as rendered content.

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


## Implementation boundary

Preserve current backend metrics, access rules, active-user filtering, and real-call exclusions. Use clean production markup/tokens rather than copying exploratory wrapper nesting. The earlier Stark work is historical only and is not authoritative.

Keep existing sticky-header behavior, background preference controls, accessible labels, working navigation, date/company filtering, coaching actions, and member selection when applying these materials to production. The mockup's static controls are not permission to remove those capabilities. Preserve the white date-range control. Keep score colors driven by the existing bands: the amber 69/100 is this snapshot, not a permanent color for every score. Do not add target captions or substitute invented metrics. Browser review confirmed no horizontal overflow at 1024px and 390px viewport widths. Before shipping, verify the real data states, narrow layouts, reduced-motion preference, and each migrated page's readable surfaces.

The CSS appendix is a lossless record of style-block order, except for the explicitly omitted font payload. Earlier declarations in that appendix are superseded by later applicable declarations and are not additional design options. The approved HTML archive retains every source byte, including the wordmark, font, markup, and gauge artwork. Consolidate styles only while preserving the final resolved appearance.

## Exact current CSS appendix

All latest Polished source style blocks follow in source order. The font payload is replaced below by its archive marker only; use the approved archive for its bytes.

```css
/* style block 1 */
#scout-coaching-polished{font:14px/1.35 Saira,sans-serif;color:#ededed}#scout-coaching-polished *{box-sizing:border-box}#scout-coaching-polished .page{position:relative;isolation:isolate;min-height:860px;overflow:hidden;border:1px solid #ffffff17;border-radius:16px;background:radial-gradient(ellipse 70% 55% at 58% 28%,#09d54317,transparent 66%),radial-gradient(ellipse at 96% 73%,#0b58253a,transparent 52%),#0a0a0a}#scout-coaching-polished .page:before{content:"";position:absolute;z-index:-1;inset:51px 0 0;background-image:linear-gradient(#ffffff07 1px,transparent 1px),linear-gradient(90deg,#ffffff07 1px,transparent 1px);background-size:56px 56px;mask-image:linear-gradient(90deg,#000,transparent 68%)}#scout-coaching-polished .top{height:51px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;border-bottom:1px solid #ffffff15;background:#0a0a0aef}#scout-coaching-polished .brand{display:block;width:104px}#scout-coaching-polished .actions{display:flex;align-items:center;gap:16px;color:#edededaa;font-size:11px}#scout-coaching-polished .switch{width:30px;height:16px;padding:2px;border-radius:99px;background:#ffffff28}#scout-coaching-polished .switch i{display:block;width:12px;height:12px;transform:translateX(14px);border-radius:50%;background:#ededed}#scout-coaching-polished .sc-nav{position:absolute;top:68px;bottom:14px;left:14px;width:170px;padding:14px 10px;border:1px solid #ffffff18;border-radius:16px;background:#0a0a0ad9;box-shadow:0 18px 45px #0000003d}#scout-coaching-polished .sc-nav p,#scout-coaching-polished label{margin:0;color:#ededed8c;font-size:11px;font-weight:500;letter-spacing:.13em}#scout-coaching-polished .sc-nav a,#scout-coaching-polished .sc-nav b{display:block;padding:7px 8px;color:#edededbb;font-size:12px;font-weight:400}#scout-coaching-polished .sc-nav .in{padding-left:18px}#scout-coaching-polished .sc-nav .sel{border-left:2px solid #09d543;background:#09d5431c;color:#ededed}#scout-coaching-polished .sc-nav footer{position:absolute;left:10px;right:10px;bottom:15px;padding:9px 8px 0;border-top:1px solid #ffffff14;font-size:12px}#scout-coaching-polished main{max-width:1180px;margin-left:202px;padding:29px 42px 42px}#scout-coaching-polished .title,#scout-coaching-polished .filters,#scout-coaching-polished .panel>header,#scout-coaching-polished .detail>footer,#scout-coaching-polished .strength article{display:flex;justify-content:space-between;gap:15px}#scout-coaching-polished .title{align-items:end}#scout-coaching-polished .title h1{margin:4px 0 0;font-size:30px;line-height:1;font-weight:400;letter-spacing:-.04em}#scout-coaching-polished .avg{display:flex;gap:10px;align-items:center}#scout-coaching-polished .avg b{font-size:25px;font-weight:300}#scout-coaching-polished .avg small{color:#ededed88;font-size:11px;letter-spacing:.1em}#scout-coaching-polished .filters{align-items:center;margin:23px 0 16px;padding:11px 0;border-block:1px solid #ffffff16}#scout-coaching-polished .company{font-size:15px}#scout-coaching-polished .picks{display:flex;gap:8px}#scout-coaching-polished .pick{padding:7px 10px;border:1px solid #ffffff20;border-radius:8px;color:#edededc7;font-size:11px}#scout-coaching-polished .white{border-color:#ededed;background:#ededed;color:#0a0a0a}#scout-coaching-polished .panel{border:1px solid #ffffff19;border-radius:16px;background:#0d110edb;box-shadow:inset 0 1px #ffffff08,0 18px 45px #0000003d}#scout-coaching-polished .panel>header h2{margin:3px 0 0;font-size:18px;font-weight:400;line-height:1.1}#scout-coaching-polished .panel>header>small{color:#ededed82;font-size:11px}#scout-coaching-polished .focus{padding:17px 19px;background:linear-gradient(115deg,#0d1e12f2,#0b0e0bf0)}#scout-coaching-polished .focus>div{display:grid;grid-template-columns:28px 1fr 16px;gap:8px;align-items:center;padding:11px 0;border-top:1px solid #ffffff14}#scout-coaching-polished .focus>div:first-of-type{margin-top:12px}#scout-coaching-polished .focus b{color:#09d543;font-size:11px}#scout-coaching-polished .focus p{margin:0;color:#edededda;font-size:13px}#scout-coaching-polished .focus i{font-style:normal;color:#ededed88;font-size:17px}#scout-coaching-polished .workspace{display:grid;grid-template-columns:205px 1fr;gap:16px;margin-top:16px}#scout-coaching-polished .members{padding:15px 9px}#scout-coaching-polished .members header{padding:0 6px 10px}#scout-coaching-polished .members button{width:100%;padding:8px;border:0;border-radius:8px;background:transparent;color:#ededed;text-align:left;font:inherit}#scout-coaching-polished .members button strong,#scout-coaching-polished .members button small{display:block}#scout-coaching-polished .members button strong{font-weight:400;font-size:12px}#scout-coaching-polished .members button small,#scout-coaching-polished .members details{color:#ededed80;font-size:11px}#scout-coaching-polished .members .chosen{background:#09d54317;box-shadow:inset 2px 0 #09d543}#scout-coaching-polished .members details{margin:12px 6px 0;padding-top:10px;border-top:1px solid #ffffff14}#scout-coaching-polished .members details p{line-height:1.55}#scout-coaching-polished .detail{padding:19px}#scout-coaching-polished .lowest{text-align:right}#scout-coaching-polished .lowest b{display:block;margin-top:4px;font-size:14px;font-weight:400}#scout-coaching-polished .lowest em{color:#fbbf24;font-style:normal}#scout-coaching-polished .detail header small{color:#ededed88;font-size:11px}#scout-coaching-polished .evidence{margin-top:18px;padding:15px;border-block:1px solid #ffffff14;background:#00000024}#scout-coaching-polished .evidence>p{max-width:640px;margin:7px 0 13px;color:#edededd5}#scout-coaching-polished .evidence div{display:flex;gap:9px;margin-top:6px;font-size:11px}#scout-coaching-polished .evidence b{min-width:176px;color:#ededed8c;font-size:11px;letter-spacing:.1em}#scout-coaching-polished .evidence span{color:#edededb8}#scout-coaching-polished .scores{margin-top:17px}#scout-coaching-polished .scoregrid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:10px}#scout-coaching-polished .score{position:relative;min-height:91px;padding:10px 8px 11px;overflow:hidden;border:1px solid #ffffff14;border-radius:8px;background:#ffffff06}#scout-coaching-polished .score:after{content:"";position:absolute;bottom:0;left:0;width:var(--bar);height:2px;background:var(--color)}#scout-coaching-polished .score span{display:block;color:#ededed9a;font-size:11px}#scout-coaching-polished .score b{display:block;margin-top:3px;font-size:20px;font-weight:300}#scout-coaching-polished .score small{display:block;margin-top:2px;color:#ededed78;font-size:9px;line-height:1.25}#scout-coaching-polished .detail>footer{align-items:center;margin-top:16px}#scout-coaching-polished .detail>footer span{color:#edededbe;font-size:12px}#scout-coaching-polished .strengths{margin-top:16px;padding:17px 19px}#scout-coaching-polished .strength{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}#scout-coaching-polished .strength article{padding:13px;border:1px solid #ffffff14;border-radius:10px;background:#00000020}#scout-coaching-polished .strength p{margin:5px 0 0;color:#edededb5;font-size:12px}#scout-coaching-polished .strength aside{display:grid;align-content:space-between;text-align:right;color:#ededed7a;font-size:11px}#scout-coaching-polished .strength a{color:#09d543;font-size:11px}@media(max-width:700px){#scout-coaching-polished .page{min-height:0}#scout-coaching-polished .sc-nav{position:relative!important;inset:auto!important;width:auto!important;margin:12px;display:flex;flex-wrap:wrap;gap:1px}#scout-coaching-polished .sc-nav p,#scout-coaching-polished .sc-nav b,#scout-coaching-polished .sc-nav footer{display:none!important}#scout-coaching-polished .sc-nav a,#scout-coaching-polished .sc-nav .in{padding:5px 7px}#scout-coaching-polished main{margin:0;padding:22px 15px 30px}#scout-coaching-polished .filters,#scout-coaching-polished .title{align-items:start;flex-direction:column}#scout-coaching-polished .picks{flex-wrap:wrap}#scout-coaching-polished .workspace{grid-template-columns:1fr}#scout-coaching-polished .members{display:grid;grid-template-columns:1fr 1fr;gap:1px}#scout-coaching-polished .members header,#scout-coaching-polished .members details{grid-column:1/-1}#scout-coaching-polished .scoregrid{grid-template-columns:1fr 1fr}#scout-coaching-polished .strength{grid-template-columns:1fr}#scout-coaching-polished .detail header{flex-direction:column}#scout-coaching-polished .lowest{text-align:left}#scout-coaching-polished .evidence div{display:block}#scout-coaching-polished .evidence b{display:block;margin-bottom:2px}}@media(max-width:380px){#scout-coaching-polished .scoregrid{grid-template-columns:1fr}}


/* style block 2 */

#scout-coaching-polished .page{background:radial-gradient(ellipse 60% 65% at 31% 46%,rgba(16,100,43,.22),transparent 73%),radial-gradient(ellipse 55% 55% at 88% 12%,rgba(9,213,67,.08),transparent 64%),linear-gradient(140deg,#101b13,#0a0a0a 57%,#0a0c0a)}
#scout-coaching-polished main{padding-top:24px}
#scout-coaching-polished .focus,#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{background:linear-gradient(145deg,rgba(17,25,18,.94),rgba(10,11,10,.99));box-shadow:inset 0 1px rgba(9,213,67,.32),0 24px 55px rgba(0,0,0,.33)}
#scout-coaching-polished .focus{background:linear-gradient(130deg,rgba(20,45,27,.85),rgba(12,16,12,.98))}
#scout-coaching-polished .members .chosen{background:linear-gradient(100deg,rgba(9,213,67,.18),rgba(9,213,67,.05));box-shadow:inset 2px 0 #09d543,0 0 20px rgba(9,213,67,.10)}
#scout-coaching-polished .score[style*="09e046"]:after{box-shadow:0 0 8px rgba(9,213,67,.85)}


/* style block 3 */
#scout-coaching-polished .sc-nav{display:block;bottom:auto;height:auto}#scout-coaching-polished .sc-nav footer{position:static;margin-top:8px}#scout-coaching-polished .lowest em{color:#ededed}#scout-coaching-polished .focus>header h2,#scout-coaching-polished .strengths>header h2{display:none}#scout-coaching-polished .page{background:radial-gradient(ellipse 60% 65% at 31% 46%,rgba(16,100,43,.28),transparent 73%),radial-gradient(ellipse 55% 55% at 88% 12%,rgba(9,213,67,.1),transparent 64%),linear-gradient(140deg,#101b13,#0a0a0a 57%,#0a0c0a)}#scout-coaching-polished .members .chosen{background:linear-gradient(100deg,rgba(9,213,67,.18),rgba(9,213,67,.05));box-shadow:inset 2px 0 #09d543,0 0 20px rgba(9,213,67,.10)}#scout-coaching-polished .score[style*="09e046"]:after{box-shadow:0 0 8px rgba(9,213,67,.85)}@media(max-width:700px){#scout-coaching-polished .sc-nav{display:grid;grid-template-columns:1fr 1fr;height:auto;gap:2px}#scout-coaching-polished .sc-nav footer{display:block!important;grid-column:1/-1}}

/* style block 4 */

#scout-coaching-polished .page{display:grid;grid-template-columns:190px minmax(0,1fr);grid-template-rows:51px auto auto auto auto auto;gap:0 16px;min-height:0;padding:0 18px 26px;background:radial-gradient(ellipse 66% 72% at 26% 44%,rgba(16,100,43,.304),transparent 70%),radial-gradient(ellipse 62% 62% at 88% 10%,rgba(9,213,67,.1425),transparent 65%),linear-gradient(140deg,#101b13,#0a0a0a 58%,#0a0e0b)}
#scout-coaching-polished .top{grid-column:1/-1;margin:0 -18px}
#scout-coaching-polished .sc-nav{position:static;grid-column:1;grid-row:2 / span 3;align-self:stretch;width:auto;height:auto;margin:17px 0 0;border-color:rgba(218,255,228,.24);box-shadow:inset 0 1px 0 rgba(230,255,238,.42),0 0 0 1px rgba(9,213,67,.10),0 0 30px rgba(9,213,67,.12),0 24px 52px rgba(0,0,0,.38);background:linear-gradient(160deg,rgba(14,25,17,.97),rgba(10,10,10,.98))}
#scout-coaching-polished .sc-nav footer{position:static;margin-top:18px}
#scout-coaching-polished main{display:contents}
#scout-coaching-polished .title{grid-column:2;grid-row:2;margin-top:22px}
#scout-coaching-polished .filters{grid-column:2;grid-row:3;margin:17px 0 13px}
#scout-coaching-polished .focus{grid-column:2;grid-row:4;margin:0;padding:17px 19px;border-color:rgba(218,255,228,.25);background:linear-gradient(130deg,rgba(22,53,31,.88),rgba(12,16,12,.98));box-shadow:inset 0 1px 0 rgba(236,255,241,.46),0 0 0 1px rgba(9,213,67,.12),0 0 34px rgba(9,213,67,.18),0 24px 52px rgba(0,0,0,.28)}
#scout-coaching-polished .workspace{grid-column:1/-1;grid-row:5;grid-template-columns:205px minmax(0,1fr);gap:16px;margin:16px 0 0}
#scout-coaching-polished .strengths{grid-column:1/-1;grid-row:6;margin:16px 0 0}
#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{border-color:rgba(218,255,228,.21);box-shadow:inset 0 1px 0 rgba(236,255,241,.36),0 0 0 1px rgba(9,213,67,.08),0 0 28px rgba(9,213,67,.11),0 24px 48px rgba(0,0,0,.31)}
#scout-coaching-polished .members .chosen{border:1px solid rgba(220,255,230,.40);background:linear-gradient(100deg,rgba(9,213,67,.23),rgba(9,213,67,.065));box-shadow:inset 2px 0 #09d543,0 0 18px rgba(9,213,67,.22)}
#scout-coaching-polished .score{border-color:rgba(220,255,230,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.11),0 0 15px rgba(9,213,67,.045)}
#scout-coaching-polished .score[style*="09e046"]{border-color:rgba(175,255,198,.26);box-shadow:inset 0 1px 0 rgba(230,255,236,.3),0 0 16px rgba(9,213,67,.12)}
#scout-coaching-polished .avg{gap:12px}
#scout-coaching-polished .ring-gauge{position:relative;display:grid;place-items:center;width:86px;height:86px;flex:0 0 86px;border-radius:50%;background:radial-gradient(circle,rgba(251,191,36,.09),transparent 56%),radial-gradient(circle,rgba(9,213,67,.16),transparent 70%);box-shadow:0 0 36px rgba(9,213,67,.25)}
#scout-coaching-polished .ring-gauge svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
#scout-coaching-polished .ring-gauge circle{fill:none}
#scout-coaching-polished .ring-track{stroke:rgba(237,237,237,.15);stroke-width:5}
#scout-coaching-polished .ring-bloom{stroke:#fbbf24;stroke-width:11;stroke-linecap:round;filter:blur(8px);opacity:.55}
#scout-coaching-polished .ring-arc{stroke:#fbbf24;stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 3px rgba(255,237,178,.96)) drop-shadow(0 0 9px rgba(251,191,36,.85))}
#scout-coaching-polished .ring-gauge span{position:relative;font-size:22px;font-weight:300;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
#scout-coaching-polished .ring-gauge em{font-size:11px;font-style:normal;color:rgba(237,237,237,.62)}
#scout-coaching-polished .avg small{max-width:72px}
@media(max-width:700px){#scout-coaching-polished .page{display:block;padding:0;min-height:0}#scout-coaching-polished .top{margin:0}#scout-coaching-polished .sc-nav{display:grid;grid-template-columns:1fr 1fr;height:auto;margin:12px;gap:2px}#scout-coaching-polished .sc-nav footer{display:block!important;grid-column:1/-1}#scout-coaching-polished main{display:block}#scout-coaching-polished .title,#scout-coaching-polished .filters,#scout-coaching-polished .focus,#scout-coaching-polished .workspace,#scout-coaching-polished .strengths{margin-left:0;margin-right:0}#scout-coaching-polished .ring-gauge{width:72px;height:72px;flex-basis:72px}}


/* style block 5 */
@media(max-width:700px){#scout-coaching-polished .workspace{grid-template-columns:minmax(0,1fr);width:100%;min-width:0}#scout-coaching-polished .detail,#scout-coaching-polished .members{min-width:0}}

/* style block 6 */

#scout-coaching-polished .top{background:#0a0a0a}
#scout-coaching-polished .sc-nav{background:#0c0e0c!important}
#scout-coaching-polished .panel,#scout-coaching-polished .focus,#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{background:#101210!important}
#scout-coaching-polished .evidence,#scout-coaching-polished .stage,#scout-coaching-polished .strength article{background:#0c0e0c!important}
#scout-coaching-polished .ring-gauge{background:#0c0e0c!important;box-shadow:0 0 36px rgba(9,213,67,.25),0 0 72px rgba(9,213,67,.11)}
#scout-coaching-polished .sc-nav .sel,#scout-coaching-polished .members .chosen{border:1px solid #09d543!important;border-left:4px solid #067d28!important;border-radius:8px!important;background:#09d543!important;color:#0a0a0a!important;box-shadow:inset 3px 0 0 #067d28,0 0 18px rgba(9,213,67,.32)!important}
#scout-coaching-polished .sc-nav .sel *,#scout-coaching-polished .members .chosen *{color:#0a0a0a!important}


/* style block 7 */

#scout-coaching-polished .sc-nav .sel,#scout-coaching-polished .members .chosen{border:1px solid rgba(218,255,228,.52)!important;border-left:2px solid #09d543!important;border-radius:11px!important;background:linear-gradient(100deg,#1b4527,#112617)!important;color:#ededed!important;font-weight:400!important;box-shadow:0 0 16px rgba(9,213,67,.24)!important}
#scout-coaching-polished .sc-nav .sel *,#scout-coaching-polished .members .chosen *{color:#ededed!important;font-weight:400!important}
#scout-coaching-polished .members .chosen small{color:rgba(237,237,237,.55)!important}
#scout-coaching-polished .score{background:#171917!important}


/* style block 8 */

#scout-coaching-polished .sc-hud{position:absolute;z-index:0;inset:51px 0 0;overflow:hidden;pointer-events:none}
#scout-coaching-polished .sc-hud svg{width:100%;height:100%;display:block}
#scout-coaching-polished .sc-hud-arc,#scout-coaching-polished .sc-hud-ring,#scout-coaching-polished .sc-hud-traces path{fill:none;stroke:rgba(237,237,237,.11);stroke-width:1}
#scout-coaching-polished .sc-hud-dash{stroke-dasharray:3 13;stroke:rgba(237,237,237,.095)}
#scout-coaching-polished .sc-hud-orbit{transform-origin:600px 420px;animation:scout-polished-hud-orbit 82s linear infinite}
#scout-coaching-polished .sc-hud-markers circle{fill:rgba(237,237,237,.15);filter:drop-shadow(0 0 3px rgba(237,237,237,.25));animation:scout-polished-hud-marker 67s ease-in-out infinite alternate}
#scout-coaching-polished .sc-hud-markers circle:nth-child(2){animation-duration:91s;animation-delay:-19s}
#scout-coaching-polished .sc-hud-markers circle:nth-child(3){animation-duration:74s;animation-delay:-37s}
#scout-coaching-polished .sc-hud-scan{fill:rgba(237,237,237,.14);filter:blur(.35px);animation:scout-polished-hud-scan 28s linear infinite}
#scout-coaching-polished .top,#scout-coaching-polished .sc-nav,#scout-coaching-polished .title,#scout-coaching-polished .filters,#scout-coaching-polished .focus,#scout-coaching-polished .workspace,#scout-coaching-polished .strengths{position:relative;z-index:1}
@keyframes scout-polished-hud-orbit{to{transform:rotate(360deg)}}
@keyframes scout-polished-hud-scan{0%{transform:translateY(-10px)}100%{transform:translateY(880px)}}
@keyframes scout-polished-hud-marker{0%{transform:translate(0,0)}100%{transform:translate(13px,-9px)}}
@media(prefers-reduced-motion:reduce){#scout-coaching-polished .sc-hud-orbit,#scout-coaching-polished .sc-hud-markers circle,#scout-coaching-polished .sc-hud-scan{animation:none!important}}


/* style block 9 */
#scout-coaching-polished .sc-nav{inset:auto}

/* style block 10 */

@font-face{font-family:ScoutPolishedSaira;src:url(data:font/woff2;base64,[ARCHIVED-SAIRA-SHA-e59235a42c248cf5f9ee37cd8ec84e3e9a3edca1e2935d844845a11f2c600904]) format("woff2");font-weight:100 900;font-stretch:50% 125%;font-display:swap}
#scout-coaching-polished{font-family:ScoutPolishedSaira,Saira,sans-serif}
#scout-coaching-polished .page{background:radial-gradient(ellipse 86% 88% at 9% 49%,rgba(20,109,52,.29),transparent 71%),radial-gradient(ellipse 74% 70% at 92% 18%,rgba(13,82,41,.23),transparent 71%),linear-gradient(136deg,#0b1210,#090a0b 57%,#0a120e)}
#scout-coaching-polished .top{background:#090a0b;border-bottom-color:rgba(219,239,226,.13)}
#scout-coaching-polished .sc-nav,#scout-coaching-polished .focus,#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{border:1px solid rgba(215,236,222,.17)!important;border-radius:20px!important;background:#0d1011!important;box-shadow:inset 0 1px 0 rgba(245,255,248,.09),0 28px 58px rgba(0,0,0,.42)!important}
#scout-coaching-polished .focus{background:#0f1412!important;border-color:rgba(215,236,222,.21)!important;box-shadow:inset 0 1px 0 rgba(247,255,249,.13),0 28px 58px rgba(0,0,0,.43)!important}
#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{background:#0c0f10!important}
#scout-coaching-polished .focus:before,#scout-coaching-polished .detail:before,#scout-coaching-polished .strengths:before,#scout-coaching-polished .focus:after,#scout-coaching-polished .detail:after,#scout-coaching-polished .strengths:after{opacity:.36}
#scout-coaching-polished .workspace{gap:20px;margin-top:20px}
#scout-coaching-polished .strengths{margin-top:20px;padding:22px 24px}
#scout-coaching-polished .focus{padding:22px 24px}
#scout-coaching-polished .members,#scout-coaching-polished .detail{padding:20px}
#scout-coaching-polished .score{background:#111416!important;border-color:rgba(215,236,222,.11)!important;box-shadow:none!important}
#scout-coaching-polished .evidence{background:#0a0c0d!important;border-color:rgba(215,236,222,.10)!important}
#scout-coaching-polished .strength article{background:#101315!important;border-color:rgba(215,236,222,.10)!important;box-shadow:none!important}
#scout-coaching-polished .scoregrid{gap:8px}
#scout-coaching-polished .title{margin-top:29px;padding-bottom:10px}
#scout-coaching-polished .title h1{font-size:34px;letter-spacing:-.05em}
#scout-coaching-polished .avg{gap:16px}
#scout-coaching-polished .ring-gauge{width:152px;height:152px;flex-basis:152px;background:#0b0f0e!important;box-shadow:0 0 0 1px rgba(215,236,222,.10),inset 0 0 32px rgba(251,191,36,.045),0 24px 58px rgba(0,0,0,.38)!important}
#scout-coaching-polished .ring-gauge:before{inset:-10px;background:repeating-conic-gradient(from -90deg,rgba(221,238,227,.34) 0 1deg,transparent 1deg 7deg);mask:radial-gradient(transparent 66%,#000 67% 68%,transparent 69%);-webkit-mask:radial-gradient(transparent 66%,#000 67% 68%,transparent 69%)}
#scout-coaching-polished .ring-gauge:after{content:"";position:absolute;inset:15px;border:1px solid rgba(221,238,227,.11);border-radius:50%;box-shadow:0 0 0 8px rgba(251,191,36,.018)}
#scout-coaching-polished .ring-gauge span{font-size:40px;z-index:1}
#scout-coaching-polished .ring-gauge em{font-size:12px;margin-top:7px}
#scout-coaching-polished .avg small{max-width:84px;line-height:1.3}
#scout-coaching-polished .sc-nav .sel,#scout-coaching-polished .members .chosen{border:1px solid rgba(211,237,217,.52)!important;border-left:2px solid #09d543!important;border-radius:11px!important;background:linear-gradient(100deg,#1b4527,#112617)!important;color:#ededed!important;box-shadow:0 0 16px rgba(9,213,67,.24)!important}
#scout-coaching-polished .sc-nav .sel *,#scout-coaching-polished .members .chosen *{color:#ededed!important}
#scout-coaching-polished .members .chosen small{color:rgba(237,237,237,.55)!important}
#scout-coaching-polished .sc-hud-arc,#scout-coaching-polished .sc-hud-ring,#scout-coaching-polished .sc-hud-traces path{stroke:rgba(227,238,233,.105)}
#scout-coaching-polished .sc-hud-scan{opacity:.45}
@media(max-width:700px){#scout-coaching-polished .sc-nav,#scout-coaching-polished .focus,#scout-coaching-polished .members,#scout-coaching-polished .detail,#scout-coaching-polished .strengths{border-radius:16px!important}#scout-coaching-polished .workspace{gap:16px;margin-top:16px}#scout-coaching-polished .ring-gauge{width:112px;height:112px;flex-basis:112px}#scout-coaching-polished .ring-gauge span{font-size:32px}#scout-coaching-polished .title h1{font-size:29px}}

/* style block 11 */

#scout-coaching-polished small{font-size:11px!important}
#scout-coaching-polished .stage{min-height:98px}
#scout-coaching-polished .strength article aside{min-width:102px}
#scout-coaching-polished .strength article aside a{white-space:nowrap}


/* style block 12 */

#scout-coaching-polished .ring-gauge span{display:flex;flex-direction:column;align-items:center;line-height:1;letter-spacing:-.05em}
#scout-coaching-polished .ring-gauge em{display:block;margin-top:8px;font-size:12px;letter-spacing:.08em}
#scout-coaching-polished .ring-ticks{fill:none;stroke:rgba(221,238,227,.30);stroke-width:.65;stroke-dasharray:.45 2.05}
#scout-coaching-polished .ring-inner{fill:none;stroke:rgba(221,238,227,.15);stroke-width:.7}
#scout-coaching-polished .ring-arc{stroke-width:3.2}
#scout-coaching-polished .ring-bloom{stroke-width:7;filter:blur(5px);opacity:.4}

```

## Exact background HUD markup

The SVG below is decorative and hidden from assistive technology. Its complete paths, geometry, marker positions, and scan rectangle are preserved here.

```html
<div class="sc-hud" aria-hidden="true"><svg viewBox="0 0 1200 860" preserveAspectRatio="xMidYMid slice"><g class="sc-hud-orbit"><path class="sc-hud-arc" d="M-80 700 A650 650 0 0 1 800 -70"/><path class="sc-hud-arc sc-hud-dash" d="M168 820 A690 690 0 0 1 1040 35"/><circle class="sc-hud-ring" cx="600" cy="420" r="318"/><circle class="sc-hud-ring sc-hud-dash" cx="600" cy="420" r="280"/></g><g class="sc-hud-traces"><path d="M38 196 H300 L342 154 H502"/><path d="M774 735 H1030 L1072 693 H1160"/><path d="M896 222 H1120"/><path d="M77 612 H202"/></g><g class="sc-hud-markers"><circle cx="214" cy="195" r="3"/><circle cx="903" cy="735" r="3"/><circle cx="1020" cy="222" r="2.5"/></g><rect class="sc-hud-scan" x="0" y="-5" width="1200" height="1"/></svg></div>
```

## Exact score instrument markup

This is the approved 69/100 snapshot; production must use the live value and existing score-band rules.

```html
<div class="ring-gauge" aria-label="Team average score 69 out of 100"><svg viewBox="0 0 100 100" role="img" aria-label="69 out of 100"><circle class="ring-ticks" cx="50" cy="50" r="48" pathLength="100"></circle><circle class="ring-track" cx="50" cy="50" r="43" pathLength="100"></circle><circle class="ring-inner" cx="50" cy="50" r="34"></circle><circle class="ring-bloom" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle><circle class="ring-arc" cx="50" cy="50" r="43" pathLength="100" stroke-dasharray="69 31"></circle></svg><span>69<em>/100</em></span></div>
```
