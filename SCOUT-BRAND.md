# Scout — Brand Guide

**Who this is for.** Anyone making something that carries the Scout name: a page, a slide, a social
post, an email signature, a landing page. Human or model.

**What it is not.** It is not the engineering design system. That lives in `SCOUT-DESIGN.md` in this
same folder, which lists every rule, where it was ruled, and the test that pins it. **If you are
changing product code, read that file, not this one.** This file gives you the values and the
reasoning. That file gives you the law.

**One rule about these two files:** a rule is stated in one place. If something here contradicts
`SCOUT-DESIGN.md` or `CLAUDE.md §4e`, those win and this file is out of date. Fix it here.

---

## 1 · The idea behind the brand

Scout listens to every call and tells a closer the one thing that cost them the deal.

That gives the brand its posture: **quiet, precise, and certain.** A radar, not a dashboard. It sweeps,
it finds the thing, it points at it. It does not shout, decorate, or celebrate itself.

Everything below follows from that. When a choice is unclear, ask which option a calm, expert person
would make, and take that one.

---

## 2 · Colour

### The palette, as it actually ships

| token | hex | what it is |
|---|---|---|
| `--bg` | `#0a0a0a` | The one black. Every product surface sits on this. |
| `--bg-elevated` | `#131313` | A card or section lifted off the ground. |
| `--bg-hover` | `#1a1a1a` | Hover state. |
| `--bg-field` | `#1c1c1c` | Form field surface, one step lighter than a card. |
| `--bg-deep` | `#050505` | Deeper than the ground. Used sparingly. |
| `--border` | `#1f1f1f` | The default hairline. |
| `--border-strong` | `#2e2e2e` | Visible on both the ground and a card. Sections and fields. |
| `--border-hover` | `#2a2a2a` | Hover. |
| `--border-focus` | `#3b3b3b` | Focus. |
| `--edge-white` | `#ffffff` | The only white edge. See §5. |
| `--text` | `#ededed` | Body text. Not pure white. |
| **`--accent` / `--good` / `--green`** | **`#09e046`** | **Scout green.** The brand. See §3. |
| `--green-dark` | `#07af37` | The pressed state of a green fill. |
| `--mid` | `#fbbf24` | Amber. Middle of a band. |
| `--bad` | `#f87171` | Red. Bottom of a band. |
| `--purple` | `#c084fc` | Categorical only. Never semantic. |
| `--orange` | `#fb923c` | Categorical only. |
| `--cyan` | `#22d3ee` | Categorical only. |
| `--slate` | `#64748b` | Neutral. |

Marketing pages carry three extra text greys: `--text-soft` `#cccccc`, `--text-muted` `#8b8b8b`,
`--text-dim` `#5a5a5a`. On the product itself, **grey body text is not used at all** — dim by lowering
opacity on `--text` instead.

`--accent-rgb` is `9, 224, 70`. It exists because `rgba()` cannot read a hex token, and every green
tint is derived from it rather than hand-mixed. Do not invent a second green.

### Where the values live

The dashboard's `:root` block in `backend/web/dashboard.html` is the source. The shared file
`backend/web/css/style.css` and the landing page's own block in `backend/web/index.html` mirror it, and
a test executes all three against each other. **Change one, change all three, or the suite fails.**

---

## 3 · Scout green — the rules that matter most

Green is the brand, and green means a good outcome, and those two meanings reinforce each other. That
overlap is deliberate and is not a problem to be solved.

**It also means green has a job, and using it for anything else spends the brand.**

### Never use Scout green on something bad

Do not use green to highlight, box, underline, or draw attention to something because it is **weak, a
miss, a loss, a failure, or a problem.** Green says "this went well." Putting it on a low score, a
missed objection, a rep's worst area, or an error state tells the reader the opposite of the truth for
a fraction of a second, and that fraction is the whole impression.

If something is bad, it is `--bad`. If it is middling, it is `--mid`. If it needs attention but is not
a judgement, use weight, size, position or a rule — not colour.

### Never use it as decoration

Green is not a texture. It is not a way to make a section look more Scout. A page with green in six
places has no accent, it has a colour scheme, and the eye stops finding the thing that matters.

Rule of thumb: **two green things per screen.** If there is a third, one of them is decoration.

### Colour a number only when it can change

A score gets a colour when it crosses a band. A number that can only ever be one colour should not be
coloured at all — a permanent green is not information, it is paint.

### Categorical is not semantic

Purple, orange and cyan exist to tell one category from another. They carry no judgement. Never borrow
`--good`, `--mid` or `--bad` for a categorical set, and never read meaning into a categorical colour.

### Legibility is answered by form

If green is hard to read somewhere, the fix is size, weight, spacing or background — never a different
hue. There is one Scout green.

---

## 4 · Typography

**Face: Saira.** Self-hosted variable font, weights 100–900, width 50–125%. Body sits at 450.
Everything on every surface is Saira. Nothing else, ever.

**Seven sizes. The scale is closed.**

| token | size | use |
|---|---|---|
| `--fs-display` | 48px | The one loud number on a page. |
| `--fs-number` | 20px | Supporting stats. |
| `--fs-title` | 18px | Page and section headings. |
| `--fs-body` | 14px | Default. |
| `--fs-secondary` | 13px | Supporting copy. |
| `--fs-label` | 12px | Field and row labels. |
| `--fs-eyebrow` | 11px | Uppercase section markers. |

**Three weights: 300 display · 400 everything · 500 emphasis. Nothing above 500.** Bold is not a
Scout thing. If something needs to stand out, make it bigger or give it room.

**Named exceptions, and they are named on purpose:** `--fs-gauge-value` 24 (the dials only),
`--fs-company` 24 (the company heading only), and on the landing page `--fs-hero` 58 and
`--fs-section` 32. A landing page is not a dashboard, so it gets its own two, declared on its own
block with the reason beside them. **A new thing landing on 24 re-opens the scale rather than adding
an eighth size.**

Use `tabular-nums` on numeric surfaces only, so figures line up in a column. Never on prose — it makes
body text look like a spreadsheet.

### The four styles

Four ways type is set in Scout. Everything on every surface is one of these. There is no fifth.

**Eyebrow.** 11px, weight 500, UPPERCASE, tracked out. Section markers and field labels — the small
words that tell you what a thing is. Uppercase always gets positive tracking, because capitals set at
their natural spacing read as a jam. This is the most-used style in the product after body.

**Display.** 48px at weight 300, line-height 1, tracked slightly tight. The one loud number on a page.
Large light type needs the tracking pulled in a little or the letters drift apart. Never uppercase, and
never above weight 300 — a heavy 48 is shouting.

**Body.** 14px at weight 400, line-height 1.5, no tracking adjustment. Sentence case. Everything a
person actually reads. Supporting copy drops to 13px and keeps 1.5.

**Quote.** *Italic*, at body size and weight. **Italic means one thing in Scout: someone said this out
loud on a call.** A prospect's words, a closer's words, the exchange around a coaching moment. Never
use italic for emphasis, for a caption, or for flavour — the moment it appears somewhere that isn't
speech, it stops meaning speech everywhere.

### Casing

Sentence case for anything a person reads. UPPERCASE only for the eyebrow style. Title Case is not
used anywhere — not on headings, not on buttons, not on nav.

### Tracking, in practice

Positive on uppercase, roughly 0.04em to 0.08em, with more on smaller and tighter-set labels. Slightly
negative on display type, around -0.01em to -0.02em. Nothing at body size.

⚠ **Finding, not a rule.** These ranges describe what ships; they are not a closed set the way the
seven sizes are. The product currently carries about a dozen distinct letter-spacing values and a
dozen line-heights, some written two ways for the same number. Nobody has ruled a scale for either.
Until Justin does, match the nearest existing value rather than inventing one, and do not treat the
ranges above as permission to pick anything inside them.

### Font loading

Saira is **self-hosted**, not fetched from Google. One variable file,
`/fonts/saira-variable-latin.woff2`. Do not add a `<link>` to a font CDN on any Scout surface — it
adds a network dependency to first paint and gives the page a different failure mode from the rest of
the product.

---

## 5 · Shape and surface

**Three radii: 16 cards · 12 controls and dialogs · 8 small.** Pills (999px) and circles (50%) are
shapes rather than radii and are fine.

**One white edge.** `--edge-white` `#ffffff` belongs to the rep card and the background toggle's
track. The rep card has a white 1px edge and 16px corners because Justin's metaphor is a playing card,
and on that one surface the frame *is* the idea. **Do not add a second white edge somewhere else** and
do not "tidy" that one away.

**One dialog shell** for everything: elevated background, hairline border, 12px radius, 520 wide,
28px padding. What goes inside is each dialog's business.

**Text sits on an opaque ground, never on artwork.** If a background motif runs behind a section, the
ground goes down first and the text sits on the ground. Dimming the artwork is not a solution —
safety is layout, not faintness.

---

## 6 · The wordmark and the glyph

**The wordmark is a vector.** `scout-wordmark.svg`. It is an auto-trace of the original raster, not
type — there is no font involved and it cannot be re-set in Saira. The fill takes the colour token, so
it can be recoloured but not redrawn.

**The glyph is `scout-glyph.svg`** and is the favicon and app icon. It is the radar mark.

**Sizing.** In the product nav the wordmark is sized by its rendered cap height, 12.1px, not by a
height value on the box. Sizing it by box height makes it visually wrong next to the text beside it.

**The glow.** `--wordmark-glow` is a two-layer green drop shadow:
`drop-shadow(0 0 6px rgba(9,224,70,0.35)) drop-shadow(0 0 14px rgba(9,224,70,0.22))`.
It belongs on the **login screen, the set-password screen and the welcome overlay**. It is **never**
used in the nav — a glowing mark in a persistent bar reads as an alert.

**Never.** Do not stretch it, rotate it, add a second effect, place it on a busy photograph, put it
inside a box that gives it a competing edge, or recreate it in a typeface. If it needs to be smaller
than the cap height allows, use the glyph instead.

**Existing assets** live in `~/Library/Mobile Documents/com~apple~CloudDocs/Scout Brand Assets/`: app
icon, avatar, desktop and phone wallpapers, email signature, glyph, grade card, link preview, LinkedIn
banner, quote post, social square, three-modules, wordmark. Use these rather than remaking them.

---

## 7 · Numbers and words

**One loud number per page, and it is fixed per page.** Some pages honestly have none, and that is
correct — do not promote something to 48px just to fill the slot.

**Unmeasured is a sentence, never a zero and never a dash.** If there is no data, say there is no
data. A zero is a measurement and claiming one you do not have is a lie in a small font.

**A data problem never renders as good news**, and never as bad news about a person either.

**Anything a customer can see is written for them.** No internal vocabulary, no mechanism, no error
codes, nothing they cannot act on. If a closer reads it and cannot tell what happened or what to do,
it is not finished.

**Never diminish a closer's work.** No "but" hung off a number they earned.

**Banded metrics say which side of the band they are on.** Direction is a declared property of the
metric, never a comparison written at the place it is displayed.

---

## 8 · The short version

- One black `#0a0a0a`, one green `#09e046`, one face (Saira), seven sizes, three weights, three radii.
- Four type styles: eyebrow, display, body, quote. Italic means someone said it out loud.
- Sentence case everywhere. Uppercase only on the eyebrow. No Title Case, ever.
- Green means good and green means Scout. Never put it on something bad.
- Two green things per screen. A third is decoration.
- Nothing above weight 500.
- Text on an opaque ground, never on artwork.
- One loud number per page, or none.
- No data is a sentence, not a zero.
- Write for the customer, not about the system.

---

*Values verified against the shipped token blocks on 2026-09-05. Engineering rules, their history and
the tests that pin them: `SCOUT-DESIGN.md`, `CLAUDE.md §4e`, `SCOUT-HISTORY.md`.*
