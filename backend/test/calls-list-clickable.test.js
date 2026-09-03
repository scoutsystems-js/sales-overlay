/**
 * THE GUARD THE CALLS PAGE NEVER HAD (H710). On 2026-09-03 the suite was green and the
 * most-used page was down: clicking a row flipped the view and the review header threw
 * `renameProspectBtnHtml is not defined` — an edit had cut three functions out and NOTHING
 * EXECUTED THE HEADER OR CLICKED A ROW. Two guards, both executed:
 *   1. the review header is RENDERED by calling the real function with a seed and with a
 *      loaded review — a missing helper is a ReferenceError here, not on Justin's screen;
 *   2. the list rows are rendered in Electron and CLICKED: the row opens the call; the
 *      prospect NAME renames without opening; the call-type TAG sets without opening; a
 *      not-a-sales-call row has no way in. (Justin: "the inline rename must not swallow the
 *      row's click — prove both behaviours.")
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const { renderComputed } = require('./helpers/electron-render');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>') + 8);

/* every helper the header and the row builder call, lifted from the page by name — if one is
   missing from this list the executed render throws, which is exactly the defect */
const HELPERS = ['callLabel', 'formatNaturalDate', 'formatNaturalDuration', 'outcomeTagHtml', 'canTagOutcomeClient', 'notSalesBtnHtml', 'callTypeTagHtml',
  'renameProspectBtnHtml', 'libraryStatusBadgeHtml', 'exclusionLabel', 'exclusionTitle', 'libRowNotSalesHtml', 'callLibraryCardHtml', 'renderCallReviewHeaderHtml',
  'outcomeLabel', 'callTypeLabel'];
function mapsSrc() { const a = LIVE.indexOf('var OUTCOME_LABELS = {'); const b = LIVE.indexOf('function outcomeTagHtml', a); return LIVE.slice(a, b); }
function pageSrc() { return mapsSrc() + '\n' + HELPERS.filter((n) => n !== 'outcomeLabel' && n !== 'callTypeLabel').map((n) => fnBody(LIVE, n)).join('\n'); }
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function build() {
  const state = { me: { role: 'owner' }, viewingUserId: null, callReviewCache: {}, callLibraryCache: null };
  const fn = new Function('state', 'escapeHtml', 'isSelf', pageSrc() + '\n return { renderCallReviewHeaderHtml, callLibraryCardHtml };');
  return fn(state, esc, () => true);
}
const SEED = { id: 'call-1', title: 'PS Sober Living Riches | Anthony Davis', call_date: '2026-09-02T15:00:00Z', duration_seconds: 2400, analysis_status: 'done', overall_score: 71, outcome: 'follow_up', outcome_source: 'inferred', call_kind: 'follow_up', prospect_name: 'Anthony Davis', not_a_sales_call: false, recording_url: 'https://fathom.video/x' };
const REVIEW = { id: 'call-1', title: SEED.title, call_date: SEED.call_date, duration_seconds: 2400, call_kind: 'booked', analysis: { status: 'done', outcome: 'closed', outcome_source: 'manual', prospect_name: 'Anthony Davis', overall_score: 71 } };

test('⚠⚠ EXECUTED: the review header renders from a seed and from a loaded review — every helper it calls exists, and the three controls are in it', () => {
  const { renderCallReviewHeaderHtml } = build();
  const fromSeed = renderCallReviewHeaderHtml(null, SEED);
  const fromReview = renderCallReviewHeaderHtml(REVIEW, SEED);
  [fromSeed, fromReview].forEach((h) => {
    assert.ok(/review-page-header/.test(h), 'the header rendered');
    assert.ok(/Rename Prospect/.test(h), 'the rename control');
    assert.ok(/call-type-select|call-type-badge/.test(h), 'the call-type tag');
    assert.ok(/not-sales-btn/.test(h), 'the not-a-sales-call button');
  });
  assert.ok(/<option value="follow_up" selected>Follow-up<\/option>/.test(fromSeed), 'the seed\'s kind shows');
  assert.ok(/outcome-tag-select closed/.test(fromReview), 'the loaded outcome shows through the map');
});

test('⚠⚠ RENDERED + CLICKED: the row opens the call; the NAME renames without opening; the TAG sets without opening; a marked row has no way in', () => {
  const { callLibraryCardHtml } = build();
  const rows = callLibraryCardHtml(SEED) + callLibraryCardHtml(Object.assign({}, SEED, { id: 'call-ns', not_a_sales_call: true, exclusion_reason: null }));
  const page = '<!doctype html><html><head>' + STYLE + '</head><body data-view="calls"><main class="page"><div class="library-list">' + rows + '</div></main>'
    + '<script>window.calls=[];window.openCallReview=function(id){calls.push(["open",id]);};window.renameProspectFromRow=function(id,n){calls.push(["rename",id,n]);};'
    + 'window.setCallKind=function(id,v,f){calls.push(["kind",id,v,f]);};window.toggleNotSalesFromRow=function(id,v){calls.push(["ns",id,v]);};window.setCallOutcome=function(){calls.push(["outcome"]);};</script></body></html>';
  const probe = `(function(){
    const card = document.getElementById('libcard-call-1');
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterRow = calls.slice(); calls.length = 0;
    const name = card.querySelector('.library-card-name');
    name.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterName = calls.slice(); calls.length = 0;
    const sel = card.querySelector('.call-type-select'); sel.value = 'booked';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterTag = calls.slice(); calls.length = 0;
    const ns = document.getElementById('libcard-call-ns');
    ns.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterNs = calls.slice();
    return { afterRow, afterName, afterTag, afterNs, nsHasName: !!ns.querySelector('.library-card-name'), nsHasTag: !!ns.querySelector('.call-type-select'), nameText: name.textContent, nameCursor: getComputedStyle(name).cursor };
  })()`;
  const r = renderComputed(page, probe);
  assert.deepStrictEqual(r.afterRow, [['open', 'call-1']], 'clicking the row opens the call, once');
  assert.deepStrictEqual(r.afterName, [['rename', 'call-1', 'Anthony Davis']], 'clicking the NAME renames — and does NOT open the call');
  assert.deepStrictEqual(r.afterTag, [['kind', 'call-1', 'booked', 'list']], 'changing the TAG sets the kind from the list — and does NOT open the call');
  assert.deepStrictEqual(r.afterNs, [], 'a not-a-sales-call row is not clickable');
  assert.strictEqual(r.nsHasName, false); assert.strictEqual(r.nsHasTag, false);
  assert.strictEqual(r.nameText, 'Anthony Davis');
});

test('⚠ never the same name twice on a row: when the title IS the prospect name, the title is the rename control; with no name, the meta says Unknown prospect', () => {
  const { callLibraryCardHtml } = build();
  const named = callLibraryCardHtml(SEED);
  assert.strictEqual((named.match(/>Anthony Davis</g) || []).length, 1, 'the name appears once as visible text (the data attribute is not text)');
  assert.ok(/library-card-title[^>]*><button type="button" class="library-card-name is-title"/.test(named), 'the title line is the rename control');
  assert.ok(!/<span class="sep">\u00b7<\/span><button type="button" class="library-card-name"/.test(named), 'no duplicate in the meta');
  const unnamed = callLibraryCardHtml(Object.assign({}, SEED, { prospect_name: null }));
  assert.ok(/library-card-name anon"[^>]*>Unknown prospect</.test(unnamed), 'no name → the meta offers the rename as Unknown prospect');
  assert.ok(/library-card-title"[^>]*><span>PS Sober Living Riches \| Anthony Davis<\/span>/.test(unnamed) || /library-card-title[^>]*>PS Sober/.test(unnamed) || /Anthony Davis<\/span>/.test(unnamed), 'the meeting title stays the title');
});

test('⚠ the list payload carries prospect_name and call_kind for the two controls', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8'));
  assert.ok(/prospect_name: a \? \(a\.prospect_name \|\| null\) : null,\s*call_kind: cc\.call_kind \|\| null,/.test(src), 'the row payload carries both');
});
