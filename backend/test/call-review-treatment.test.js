'use strict';
/**
 * ⚠⚠ GUARD THE RENDERED RESULT, NOT THE RULE.
 *
 * The call-review verdict border is a RULED EXEMPTION — the one place on this
 * page where colour genuinely encodes something (red on a loss, green on a
 * close, amber on a follow-up) and no heading repeats it. **The design sweep has
 * already destroyed it once**, via a `border: 0` shorthand in the very edit that
 * was sparing it: the shorthand kills border-LEFT, the `.review-why.loss` rule
 * that restores it has LOWER specificity, and nothing failed. The rendered
 * border width was 0px while the source looked entirely correct.
 *
 * So this asserts what a browser would COMPUTE, by resolving the cascade in
 * source order the way CSS does, rather than asserting that a rule exists.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ COMMENTS OUT FIRST, LINE BEFORE BLOCK. Without this the selector text of
   every rule carries the comment that precedes it — `[^{}]+` grabs everything
   since the last `}` — so an exact selector match never fires and the resolver
   silently returns null for a rule that is plainly there. This bit inside a
   guard written to enforce a different rule; it is the same trap either way. */
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/.exec(HTML)[1]
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Resolve one longhand for an element, cascading in source order over the rules
 * whose selector is in `selectors`. Shorthands are expanded, which is the whole
 * point — `border: 0` must be seen to clear `border-left-width`.
 */
/* ⚠⚠ SPECIFICITY FIRST, THEN SOURCE ORDER — a pure source-order cascade gets
   this exactly backwards and I wrote one first. The cards-off rule
   `body[data-view="call-review"] .section` (0,2,1) sits LATER in the file than
   `body[data-view="call-review"] .review-why.loss` (0,3,1), so a source-order
   model reports the border as cleared while the browser draws it at 3px.
   ⚠ The tell was that the verdict contradicted a measurement already in hand:
   the rendered element read `border 0/0/0/3`. A result that disagrees with
   something you can already see is a statement about the instrument. */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+/g) || []).length
            + (sel.match(/\[[^\]]+\]/g) || []).length
            + (sel.match(/:(?!:)[\w-]+/g) || []).length;
  const el = (sel.replace(/\[[^\]]+\]/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
  return ids * 10000 + cls * 100 + el;
}

function resolve(selectors, prop) {
  const decls = [];
  const rx = /([^{}]+)\{([^{}]*)\}/g;
  let m, order = 0;
  while ((m = rx.exec(STYLE))) {
    order++;
    const sels = m[1].split(',').map((x) => x.trim());
    const hit = sels.filter((x) => selectors.indexOf(x) !== -1);
    if (!hit.length) continue;
    const spec = Math.max(...hit.map(specificity));
    const body = m[2];
    const sh = /(?:^|;)\s*border\s*:\s*([^;]+)/.exec(body);
    if (sh) decls.push({ spec, order, value: /^(0|none)\b/.test(sh[1].trim()) ? '0' : sh[1].trim() });
    const lh = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body);
    if (lh) decls.push({ spec, order, value: lh[1].trim() });
  }
  if (!decls.length) return null;
  decls.sort((a, b) => (a.spec - b.spec) || (a.order - b.order));
  return decls[decls.length - 1].value;
}

test('the verdict border survives the cards-off sweep — RENDERED, not declared', () => {
  const base = ['body[data-view="call-review"] .section', 'body[data-view="call-review"] .review-why'];
  for (const [cls, token] of [['loss', '--bad'], ['win', '--good'], ['pending', '--mid']]) {
    const sel = base.concat(['body[data-view="call-review"] .review-why.' + cls]);
    const v = resolve(sel, 'border-left');
    assert.ok(v && v !== '0',
      cls + ': the verdict border resolved to "' + v + '" — a `border: 0` shorthand kills border-left '
      + 'and the .review-why rule cannot restore it from lower specificity');
    assert.ok(v.indexOf(token) !== -1,
      cls + ' must use ' + token + ', got: ' + v);
  }
});

test('the four sides other than the verdict border ARE cleared', () => {
  /* The exemption is one side, not a licence to keep the box. */
  const sel = ['body[data-view="call-review"] .section', 'body[data-view="call-review"] .review-why'];
  for (const prop of ['border-top', 'border-right', 'border-bottom']) {
    const v = resolve(sel, prop);
    assert.ok(v === '0' || v === null || /^0/.test(v),
      'call-review .review-why ' + prop + ' should be cleared, got: ' + v);
  }
});

/**
 * ⚠⚠ A CONTROL THAT IS RENDERED BUT HAS NO RULE OF OURS FALLS BACK TO THE
 * BROWSER'S DEFAULT BUTTON — measured live on 2026-09-01: `rgb(239,239,239)`
 * background, `2px outset black` border, black text, on a near-black page.
 * It shipped that way for three days because the CSS was archived with the
 * button on 18 Aug and the button was re-added on 29 Aug without it.
 * ⚠ No presence check can see this. The rule has to be asserted to EXIST and to
 * be LIVE — not sitting inside an archive comment.
 */
test('every KB control on the review page has a rule of ours, not the UA default', () => {
  /* line comments FIRST, then block — a `/*` inside a `//` line is a false opener. */
  const live = STYLE;   // already comment-stripped at the top of this file
  for (const cls of ['.review-kb-btn']) {
    const rendered = new RegExp('class="' + cls.slice(1) + '\\b').test(HTML)
      || new RegExp("'" + cls.slice(1) + "\\b").test(HTML);
    assert.ok(rendered, cls + ' is not rendered anywhere — remove this assertion or the control');
    const re = new RegExp('\\' + cls + '\\s*\\{([^}]*)\\}');
    const m = re.exec(live);
    assert.ok(m, cls + ' is RENDERED but has NO LIVE RULE — it will draw as the browser default '
      + 'button (light grey, outset border) on a near-black page');
    assert.ok(/background:\s*none/.test(m[1]) && /border:\s*1px/.test(m[1]),
      cls + ' must be styled as one of our buttons, got: ' + m[1].replace(/\s+/g, ' ').slice(0, 120));
  }
});
