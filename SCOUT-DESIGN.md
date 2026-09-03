# Scout — the design system (rules and pointers, not history)

**This file is the one place the design system is listed.** Every rule below is *stated* once, where it was ruled, and this file *points* at it — CLAUDE.md §4e for the rulings, the token blocks for the values, `SCOUT-HISTORY.md` (`H###`) for the reasoning, and `backend/test/` for what pins it. **Do not restate a rule here that is written there; add a pointer.** Two documents describing one system is the defect this codebase keeps paying for. Keep this file under 12,000 characters (`wc -c SCOUT-DESIGN.md`).

**Where the values live:** the dashboard's token block `backend/web/dashboard.html` `:root` (lines ~78–240: sizes 85–91, the two named exceptions 102 and 114, `--edge-white` 128, weights 162–164, colours 175–211, radii 237–239); the shared file the outside pages load, `backend/web/css/style.css` `:root` (line 4); the landing page's own block, `backend/web/index.html` (self-contained by ruling). **They must agree, and a guard says so** — `style-tokens-mirror.test.js` executes the shared and index blocks against the dashboard's.

---

## 1 · Type

| rule | stated in | pinned by |
|---|---|---|
| **Seven sizes, closed:** display 48 · number 20 · title 18 · body 14 · secondary 13 · label 12 · eyebrow 11 | CLAUDE.md §4e "Type scale" (H288, H508, H497); `dashboard.html:85–91` | `type-scale.test.js` (exactly seven, both copies identical); `style-tokens-mirror.test.js` |
| **Two named exceptions, declared AS exceptions:** `--fs-gauge-value` 24 (the dials only) · `--fs-company` 24 (the company heading only). A third landing on 24 re-opens the scale rather than adding a fourth | `dashboard.html:102, 114` (the reasons sit beside the tokens) | `type-scale.test.js` ("the two sub-scale values are NAMED exemptions") |
| **Three weights: 300 display · 400 everything · 500 emphasis. Nothing above 500** — the 600 nav and the 700 family came down on 2026-09-03 | CLAUDE.md §4e "Weights" (H689) | `scale-literals-ratchet.test.js` (literal weights at zero in the dashboard, the modal's CSS string and the shared file); `type-scale.test.js` |
| **Face: Saira, self-hosted, variable** (`/fonts/saira-variable-latin.woff2`, weight 100–900, width 50–125%); body 450; `tabular-nums` on numeric surfaces only | CLAUDE.md §4e "Typeface" (H345, H349); `dashboard.html:3749` @font-face | `font-coverage.test.js` (Saira covers every string it sets); `style-tokens-mirror.test.js` (every outside page's `--font` leads with Saira) |
| **Controls inherit by capability, never by enumeration** — every control inherits the face and size; a per-type list is how an email box became white Arial | CLAUDE.md §4d (H688) | `controls-inherit-rendered.test.js` (rendered, with the inverse check) |
| **The wordmark is a VECTOR, `/scout-wordmark.svg`** (an auto-trace of the old raster — not Saira, no font involved — fill = the token), on all four surfaces; the nav sized by its rendered CAP (12.1px), not a height value; the glow is the `--wordmark-glow` filter on login, set-password and the welcome overlay, never the nav; `/scout-glyph.svg` is the favicon | CLAUDE.md §4e (H695; the measurement H691–H694) | `wordmark-vector.test.js` (rendered cap, four surfaces, no manifest, every page's icon); `style-tokens-mirror.test.js` (the glow token) |

## 2 · Shape and surface

| rule | stated in | pinned by |
|---|---|---|
| **Three radii: 16 cards (`--radius-lg`) · 12 controls and dialogs (`--radius`) · 8 small (`--radius-sm`). Pills (99/999px) and circles (50%) are shapes, not radii, and stay** | CLAUDE.md §4e (H689); `dashboard.html:237–239` | `scale-literals-ratchet.test.js`; `type-scale.test.js` |
| **One dialog shell** — the KB dialog's: `--bg-elevated`, a `--border` hairline, `--radius`, 520 wide, 28px padding. The Need-help card, the confirm/prompt dialog and the card picker wear it; what each puts inside is its own | CLAUDE.md §4e (H689) | `dialog-shell-rendered.test.js` (all four rendered and compared) |
| **The modal treatment, never `confirm()`/`prompt()`** — `scoutConfirm`/`scoutPrompt`, always awaited; the typed confirmation on destructive flows | CLAUDE.md §4c (H283) | `modals.test.js` |
| **One green button treatment** (`.btn-fathom-primary`: the accent fill, dark text) | `dashboard.html` `.btn-fathom-primary` (~2052) | **no guard** — a second green fill can ship unnoticed (finding) |
| **Safety is layout, not faintness** — text sits on an opaque ground (`--bg`), never on dimmed artwork; the ground goes on before the cards come off; every per-view list must name a new view | CLAUDE.md §4e (H286, H292, H637, H559) | `team-background.test.js` (the three carded containers), `page-treatment-pages.test.js`, `call-review-treatment.test.js`, `background-motifs.test.js` |
| **New markup inherits nothing** — the ground list and the cards-off list are per view, so a new view or control starts with browser defaults; add it to every per-view list and check it rendered | CLAUDE.md §4e (H559, H687) | `controls-inherit-rendered.test.js` for controls; **no guard** for a new view's ground (finding) |

## 3 · Colour

| rule | stated in | pinned by |
|---|---|---|
| **One black:** `--bg` #0a0a0a across the product; the shared file's `--bg2`/`--bg3` are the dashboard's elevated and field surfaces | CLAUDE.md §4e (H688); `style.css:4` | `style-tokens-mirror.test.js` |
| **One white edge:** `--edge-white` #ffffff — the rep card and the background toggle's track share it; never declare a second white | `dashboard.html:128` (H686, H696) | `rep-card-border-rendered.test.js`, `background-switch.test.js` |
| **The top bar is 51px by declaration** — the rail top, the ground and the sidebar derive from it; its contents cannot move it | CLAUDE.md §4e (H697, H700) | `background-switch.test.js`, `wordmark-vector.test.js` (rendered bar) |
| **Scout green #09e046 carries three meanings at once — good, brand, and the association between them — BY DESIGN.** Never raise it as a collision again; the only green question is legibility, answered by form, never hue. `--accent-rgb` exists because `rgba()` cannot read a hex token; every tint derives from it. The shared file spells it `--green` and declares no `--accent` | CLAUDE.md §4e (H364, H321, H326) | `accent-palette.test.js` (one spelling, tints derived); `login-brand.test.js` (the shared file declares no `--accent`); the three-meanings ruling itself needs no guard |
| **`--good` / `--mid` / `--bad`** are semantic; the categorical rep-line ramp borrows no hue from them | CLAUDE.md §4e (H327, H052) | `team-averages-palette.test.js` |
| **No grey body text on the dashboard** — `--muted` is not referenced for text; dim with opacity on `--text` | CLAUDE.md §4e (H280, H119) | `no-grey-text.test.js` |
| **`--muted` on the outside pages stays grey BY RULING** (#8a9aaa is the measured ceiling for the login and landing marks' opacity) | CLAUDE.md §4e (H690) | `login-brand.test.js` |
| **A score is coloured only when it crosses a band; a colour that cannot vary is not a colour** | CLAUDE.md §4a (H657, H650) | `score-bands.test.js`, `rep-card.test.js` (grades uncoloured) |

## 4 · Numbers and words

| rule | stated in | pinned by |
|---|---|---|
| **One loud number per page, fixed per page, at 48/300; some pages honestly have none** — Objections: the handle rate; Knowledge Base: the counter | CLAUDE.md §4e (H653, H690) | `loud-numbers.test.js` (those two pages, executed); **no page-wide guard** that a view renders at most one 48 (finding) |
| **Banded metrics state which side they are on; direction is a declared property, never a call-site comparison** | CLAUDE.md §4a (H518, H521, H125) | `metric-band-mirror.test.js`, `call-time-ranking-band.test.js` |
| **Unmeasured is a sentence, never a zero or a dash** | CLAUDE.md §4a (H189, H247); §4e rep cards (H705) | `rep-card.test.js`, `team-averages.test.js`, `widget-render-mirror.test.js` |
| **Anything a customer can see is written for them** — no internal words, ever | CLAUDE.md §4d (H064, H591) | `customer-language.test.js` |

## 5 · The ruled exemptions — each with its reason, so the next sweep does not "finish" it

| exemption | reason | pinned by |
|---|---|---|
| **The call-review verdict border** (`.review-why` keeps its outcome colour and left border) | the one place semantic colour is correct — a `border: 0` shorthand once removed it with nothing failing (H267, H650) | `call-review-treatment.test.js` (rendered) |
| **The rep card's white 1px edge and 16px corners** | Justin: a playing card — the one surface where the frame IS the metaphor (H686) | `rep-card-border-rendered.test.js` (rendered under the host view) |
| **The landing page's `--fs-hero` 58 and `--fs-section` 32** | a landing page is not a dashboard; under the scale its h2 sat below its own lede (H690); declared on `index.html`'s own `:root` with the reason | `loud-numbers.test.js` |
| **The KB scope badge (GLOBAL / TEAM / PERSONAL) and the review speaker badge (PROSPECT / CLOSER) render their stored words** | machine words that ARE the product's words (H673) | **no guard** — a label-map sweep could "finish" them (finding) |
| **The white date-range button and calendar** | Justin's own ruling: "white box, black text, both the trigger and the panel" (H688) | `date-picker.test.js` pins the tokens; **not the whiteness** (finding) |
| **The mesh in both gutters, the floating opaque rail, the sticky top bar with the wordmark as its only logo** | H537, H700 | `mesh-band.test.js`, `team-background.test.js`, `background-motifs.test.js` |

## 6 · Findings — rules with no guard

The green button treatment · a new view's ground · at-most-one-48 per view · the badge words · the picker's whiteness. Each is a rule a sweep could break with the suite green. Filed in `BUILD-LIST.md`.
