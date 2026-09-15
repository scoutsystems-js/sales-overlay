'use strict';

/* Standalone visual-QA fixtures. They render the dashboard's real team
 * dispatcher with the same bounded producer-shaped data used by the regression
 * test, then retain the live stylesheet and top-bar/sidebar/page hierarchy.
 * Serve backend/web as the HTTP root so /fonts and /scout-wordmark.svg resolve. */
const fs = require('node:fs');
const path = require('node:path');
const TEAM_AVERAGES = require('../../lib/team-averages');
const { fnBody } = require('./strip-comments');

const WEB = path.join(__dirname, '..', '..', 'web');
const HTML = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8');
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/.exec(HTML)[1];
const RAW_SCRIPT = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).sort((a, b) => b.length - a.length)[0];
const SCRIPT = RAW_SCRIPT.replace(/\n\s*init\(\);\s*$/, '\n');
const OBSERVATORY_RAIL_SYNC = fnBody(SCRIPT, 'syncObservatoryRailClearance');
const CHROME_START = HTML.lastIndexOf('<nav class="top-bar">');
const CHROME = HTML.slice(CHROME_START, HTML.indexOf('<div id="content">', CHROME_START));

const REP = { user_id: 'rep-1', display_name: 'Ava', calls_analyzed: 24, active: true, prospect_close_rate: 25, prospect_close_wins: 6, prospect_close_total: 24, obj_handle_rate: 42, obj_handled: 10, obj_total: 24, avg_call_time: 41, avg_score: 72, sections: { intro: 75, discovery: 69, pitch: 71, objection: 66, close: 78 }, weakest_section: { section: 'objection', score: 66 }, weakest_objection: null };
const PERFORMANCE_REPS = [REP, { ...REP, user_id: 'rep-2', display_name: 'Drew', prospect_close_rate: 31, prospect_close_wins: 8, obj_handle_rate: 55, obj_handled: 13, avg_call_time: 38, avg_score: 79, sections: { intro: 81, discovery: 76, pitch: 80, objection: 72, close: 84 } }, { ...REP, user_id: 'rep-3', display_name: 'Morgan', prospect_close_rate: 18, prospect_close_wins: 4, obj_handle_rate: 29, obj_handled: 7, avg_call_time: 48, avg_score: 63, sections: { intro: 67, discovery: 62, pitch: 65, objection: 55, close: 68 } }];
const COACHING_REP = { user_id: 'rep-1', name: 'Ava', calls: 1, recent_calls: [], period_summary: { status: 'ready', from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z', patterns: [], coaching: { state: 'item', label: 'Close', move: 'asking for the sale', calls: 1, recurring: false, example: { call_id: 'call-verified', call_date: '2026-09-12T10:00:00.000Z', prospect_name: 'Morgan', outcome: 'follow_up', source: 'fathom', observation: 'The prospect asked for time and the call ended without a confirmed next step.', recommendation: 'Ask for a specific next step before ending the call.', clip_url: 'https://fathom.video/calls/verified?t=120', evidence: [{ speaker: 'PROSPECT', quote: 'I need a day to think about this.', timestamp_seconds: 120 }, { speaker: 'CLOSER', quote: 'Of course, reach out when you are ready.', timestamp_seconds: 126 }] } } } };
const TEAM_RECS = { available: true, working: [{ claim: 'Ava made the prospect feel heard before presenting the next step.', data: 'The prospect stayed engaged after the summary.', quote: 'That makes sense to me.', rep: 'Ava', spoke: 'prospect', call_id: 'call-verified', highlight_id: 'highlight-1' }], improve: [{ claim: 'Make the next step specific when a prospect needs time.', data: 'The call ended open without a date.', quote: 'Reach out when you are ready.', rep: 'Ava', spoke: 'closer', call_id: 'call-verified', highlight_id: 'highlight-2' }] };
const SERIES = { buckets: [{ label: 'Sep 7' }, { label: 'Sep 14' }], reps: [{ user_id: 'rep-1', name: 'Ava', handle: [{ rate: 35, handled: 7, total: 20 }, { rate: 42, handled: 10, total: 24 }], close: [{ rate: 20, closed: 4, total: 20 }, { rate: 25, closed: 6, total: 24 }], price: [{ value: 18, total: 20 }, { value: 21, total: 24 }] }], team: { handle: [{ rate: 35, reps_counted: 1, numerator: 7, total: 20 }, { rate: 42, reps_counted: 1, numerator: 10, total: 24 }], close: [{ rate: 20, reps_counted: 1, numerator: 4, total: 20 }, { rate: 25, reps_counted: 1, numerator: 6, total: 24 }], price: [{ value: 18, reps_counted: 1, total: 20 }, { value: 21, reps_counted: 1, total: 24 }] } };
const AVERAGE_REPS = [{ closing: { numerator: 11, total: 39 }, objections: { numerator: 14, total: 39 }, calltime: { seconds: 49.4 * 60 * 39, calls: 39 } }, { closing: { numerator: 7, total: 33 }, objections: { numerator: 11, total: 33 }, calltime: { seconds: 42 * 60 * 33, calls: 33 } }];
const AVERAGES = { metrics: Object.fromEntries(TEAM_AVERAGES.METRIC_ORDER.map((key) => { const metric = TEAM_AVERAGES.METRICS[key]; const pooled = key === 'calltime' ? TEAM_AVERAGES.poolDuration(AVERAGE_REPS) : TEAM_AVERAGES.poolRate(AVERAGE_REPS, key); return [key, { key, label: metric.label, target: metric.target, scale: metric.scale, unit: metric.unit, value: pooled.value, numerator: pooled.numerator, total: pooled.total, enough: pooled.enough, reason: pooled.reason, unit_name: metric.unitName, numerator_name: metric.numeratorName, direction: metric.direction, target_caption: metric.targetCaption, band: TEAM_AVERAGES.band(pooled.value, metric.target, metric.direction, metric.band), sweet_spot: metric.band ? { good: metric.band.good, ok: metric.band.ok } : null }]; })) };

const OVERVIEW_ANALYTICS = { calls: { analyzed: 12, total_in_range: 12, processing: 0, error: 0 }, avg_score: { mean: 72, prior_mean: 68, graded_calls: 12, win_mean: 78, win_n: 5, other_mean: 68, other_n: 7 }, objections: { calls_with_objection: 4, total_highlights: 9 }, gauge_policy: { closing: TEAM_AVERAGES.gaugePolicy('closing'), objections: TEAM_AVERAGES.gaugePolicy('objections') }, cash_collected: 0, prospect_close_rate: 23, prospect_close_wins: 23, prospect_close_total: 101, close_rate: 50, close_wins: 5, close_decided: 10, sections: { intro: { avg: 75, n: 10 }, discovery: { avg: 68, n: 10 }, pitch: { avg: 73, n: 10 }, objection: { avg: 66, n: 10 }, close: { avg: 78, n: 10 } }, weakest_section: 'objection', strongest_section: 'close', latest_one_things: [] };
const OVERVIEW_NEEDS_WORK = { available: true, state: 'gap', bucket: { handled: 4, total: 12, rate_pct: 33, baseline_pct: 58 }, detail: { buckets: [{ key: 'fear', label: 'Fear', handled: 4, total: 12, rate_pct: 33 }], context: { disqualifications: 1, logistical: 2 } }, card_text: 'Isolate the objection before answering it.' };
const OVERVIEW_FOCUS_EVIDENCE = [{ closer_response: 'Let me slow down and understand what would need to be true before you decide.', call_id: 'focus-call-1', date: '2026-09-12T10:00:00.000Z' }];
const OVERVIEW_SECTION_RANK = { sections: [{ section: 'objection', label: 'Objection Handling', score: 66, n: 10, enough: true, levelWithNext: false, gapToNext: 4, nextLabel: 'Discovery', rank_label: 'Lowest section', moments: [{ speaker: 'PROSPECT', quote: 'I want to make sure this will work for my team before I commit to the next step.', timestamp_seconds: 92, observation: 'The concern was left unexplored.', coaching: 'Ask one clarifying question before responding.', who: 'Ava', call_id: 'call-1', clip_url: 'https://fathom.video/calls/call-1?t=92' }, { speaker: 'CLOSER', quote: 'That makes sense. Let me understand what would need to be true for you.', timestamp_seconds: 101, observation: 'The closer began to isolate the concern.', coaching: 'Keep the question open before explaining the offer.', who: 'Ava', call_id: 'call-1', clip_url: 'https://fathom.video/calls/call-1?t=101' }] }] };
const OBJECTION_NAMES = ['Ava', 'Drew', 'Morgan', 'Jordan', 'Casey', 'Taylor', 'Riley', 'Cameron', 'Quinn'];
const OBJECTION_TOTALS = [80, 75, 70, 65, 60, 55, 50, 45, 44];
const OBJECTION_HANDLED = [8, 9, 10, 10, 10, 10, 11, 13, 15];
const OBJECTION_CATEGORIES = ['fear', 'timing', 'partner', 'logistical', 'uncategorized'];
function objectionCounts(total, handled) {
  const unresolved = Math.max(0, total - handled);
  const partial = Math.min(unresolved, Math.round(total * 0.2));
  return { total, handled, credited: 0, partial, unhandled: unresolved - partial, rate: total ? Math.round((handled / total) * 100) : null };
}
function objectionRow(name, index) {
  const total = OBJECTION_TOTALS[index];
  const handled = OBJECTION_HANDLED[index];
  const categoryTotals = [Math.ceil(total * 0.34), Math.ceil(total * 0.22), Math.ceil(total * 0.16), Math.ceil(total * 0.14)];
  categoryTotals.push(total - categoryTotals.reduce((sum, count) => sum + count, 0));
  let remainingHandled = handled;
  const byCategory = {};
  OBJECTION_CATEGORIES.forEach((category, categoryIndex) => {
    const remainingCategories = OBJECTION_CATEGORIES.length - categoryIndex;
    const categoryHandled = categoryIndex === OBJECTION_CATEGORIES.length - 1
      ? remainingHandled
      : Math.min(categoryTotals[categoryIndex], Math.floor(remainingHandled / remainingCategories));
    remainingHandled -= categoryHandled;
    byCategory[category] = objectionCounts(categoryTotals[categoryIndex], categoryHandled);
  });
  return { user_id: 'obj-rep-' + (index + 1), name, by_category: byCategory, total: objectionCounts(total, handled) };
}
const OBJECTION_GRID = OBJECTION_NAMES.map(objectionRow);
const OBJECTION_CLOSERS = OBJECTION_GRID.map((row) => ({ user_id: row.user_id, name: row.name }));
const OBJECTION_INSTANCES = Array.from({ length: 12 }, (_, index) => ({
  id: 'obj-highlight-' + (index + 1),
  fathom_call_id: 'obj-call-' + (index + 1),
  title: 'Decision call ' + (index + 1),
  call_date: '2026-09-' + String(12 - (index % 8)).padStart(2, '0') + 'T15:00:00.000Z',
  category: OBJECTION_CATEGORIES[index % OBJECTION_CATEGORIES.length],
  bucket_label: ['Upfront cost', 'Needs more time', 'Partner approval', 'Payment logistics', 'Other concern'][index % 5],
  surface: ['The upfront cost feels risky', 'I need more time', 'I need to talk to my partner', 'The payment timing will not work', 'I am still unsure'][index % 5],
  resolution: index % 3 === 0 ? 'handled' : (index % 3 === 1 ? 'partial' : 'unhandled'),
  credited: index % 6 === 0,
  quote: 'I can see how this would help, but I need to understand what happens if the timing changes after we get started.',
  closer_response: 'Let us slow down and separate the timing concern from whether this solves the problem you described.',
  observation: 'The closer acknowledged the concern and asked a direct follow-up before returning to the decision.',
  clip_url: 'https://fathom.video/calls/obj-' + (index + 1) + '?t=420',
  source: 'fathom',
  closer: { user_id: OBJECTION_CLOSERS[index % OBJECTION_CLOSERS.length].user_id, name: OBJECTION_CLOSERS[index % OBJECTION_CLOSERS.length].name },
}));
const OBJECTION_SUMMARY_NAMES = OBJECTION_NAMES.concat(['Skyler', 'Reese', 'Emerson']);
const OBJECTION_SUMMARY = {
  available: true,
  closers: OBJECTION_SUMMARY_NAMES.map((name, index) => index < OBJECTION_GRID.length ? {
    user_id: 'obj-rep-' + (index + 1),
    name,
    state: 'rate_gap',
    focus: { category: OBJECTION_CATEGORIES[index % OBJECTION_CATEGORIES.length], total: 10 + index, handled: 2 + (index % 3) },
    why: name + ' tends to answer the first stated concern before fully separating it from the decision underneath it. Across the reviewed calls, the buyer often gave a second, more specific reason only after the response had already begun.',
    what_to_do: 'Ask one focused question that isolates the decision before explaining or reframing the offer.',
    evidence: [{
      highlight_id: 'obj-highlight-' + (index + 1),
      fathom_call_id: 'obj-call-' + (index + 1),
      quote: OBJECTION_INSTANCES[index].quote,
      closer_response: OBJECTION_INSTANCES[index].closer_response,
      ts: '00:07:' + String(10 + index).padStart(2, '0'),
      clip_url: OBJECTION_INSTANCES[index].clip_url,
      source: 'fathom',
    }],
  } : {
    user_id: 'obj-rep-' + (index + 1),
    name,
    state: 'no_volume',
    total: 0,
    top: null,
  }),
};
const TEAM_OBJECTIONS = {
  category: '',
  instances: OBJECTION_INSTANCES,
  instance_count: OBJECTION_INSTANCES.length,
  truncated: false,
  grid: OBJECTION_GRID,
  strict: true,
  excluded: { disqualifications: 1, logistical: 5 },
  board_size: 12,
  closers: OBJECTION_CLOSERS,
  totals: objectionCounts(544, 96),
};
const MEMBER_USERS = [
  { user_id: 'owner-1', first_name: 'Olivia', last_name: 'Owner', email: 'olivia@example.test', role: 'owner', active: true, managed_by: null },
  { user_id: 'manager-1', first_name: 'Morgan', last_name: 'Manager', email: 'morgan.manager@example.test', role: 'manager', active: true, managed_by: 'team-self' },
  { user_id: 'member-1', first_name: 'Ava', last_name: 'Stone', email: 'ava.stone@example.test', role: 'user', active: true, managed_by: 'team-self' },
  { user_id: 'member-2', first_name: 'Drew', last_name: 'Lane', email: 'drew.with.a.long.login.address@northstar-sales.example.test', role: 'user', active: true, managed_by: 'team-self' },
  { user_id: 'member-3', first_name: 'Riley', last_name: 'Cole', email: 'riley.cole@example.test', role: 'user', active: false, managed_by: 'team-self' },
];

function render(stateOverrides, options) {
  let markup = '';
  const mounted = {};
  const content = { get innerHTML() { return markup; }, set innerHTML(value) { markup = String(value); }, insertAdjacentHTML(_position, value) { markup += String(value); } };
  const body = { appendChild() {}, classList: { add() {}, remove() {} }, dataset: {} };
  const startedWithoutView = !Object.prototype.hasOwnProperty.call(body.dataset, 'view');
  const document = { getElementById: (id) => id === 'content' ? content : (mounted[id] ? { id, getContext: () => ({ id }) } : null), querySelector: () => null, querySelectorAll: (selector) => selector === '.rep-graph-slot' ? [...markup.matchAll(/data-canvas="([^"]+)"/g)].map((match) => ({ getAttribute: () => match[1], appendChild() { mounted[match[1]] = true; } })) : [], addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }), body, documentElement: { style: {} } };
  const Chart = function Chart() { this.destroy = () => {}; };
  const window = { Chart, location: { hash: '', search: '', pathname: '/dashboard', href: 'https://fixture.test/dashboard', replace() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, fetch: () => new Promise(() => {}), matchMedia: () => ({ matches: false, addEventListener() {} }), ScoutAuth: null, history: { replaceState() {} } };
  const api = new Function('document', 'window', 'Chart', 'localStorage', 'fetch', 'console', SCRIPT + '\nreturn { state, pickerUi, renderApp: render, renderTeamSurface, renderTeamDigest, renderOverview, renderCallLibrary, renderEodView };')(document, window, Chart, window.localStorage, window.fetch, { log() {}, warn() {}, error() {} });
  Object.assign(api.state, stateOverrides);
  if (options && options.datePickerOpen) Object.assign(api.pickerUi('team'), { open: true, year: 2026, month: 8, pending: null, focus: '2026-09-13', hover: null });
  if (options && options.loading) api.renderOverview(true);
  else if (stateOverrides.view === 'overview') api.renderOverview(false);
  else if (stateOverrides.view === 'call-library') api.renderCallLibrary();
  else if (stateOverrides.view === 'eod') api.renderEodView();
  else if (stateOverrides.view === 'team') api.renderApp();
  else if (stateOverrides.view === 'team-objections' || stateOverrides.view === 'team-members') api.renderApp();
  else api.renderTeamSurface();
  return options && options.captureBody ? { markup, startedWithoutView, view: body.dataset.view } : markup;
}

function base(view) { const coaching = view === 'team-coaching'; return { view, me: { user_id: 'manager-1', role: 'manager', is_managed: false }, teamSelected: null, teamContext: { is_owner: true, my_team_label: 'Northstar Sales', rep_count: 12, teams: [{ key: 'team-self', label: 'Northstar Sales', rep_count: 12, is_self: true }, { key: 'team-other', label: 'Second Team', rep_count: 2, is_self: false }] }, teamContextLoading: false, teamOverview: { reps: [], per_rep: PERFORMANCE_REPS, totals: { avg_score: 72 } }, teamOverviewLoading: false, teamAverages: AVERAGES, teamAveragesLoading: false, teamRepSeries: SERIES, teamRepSeriesLoading: false, teamRecs: coaching ? TEAM_RECS : { available: true, working: [], improve: [] }, teamRecsLoading: false, teamCoachable: { reps: coaching ? [COACHING_REP, { ...COACHING_REP, user_id: 'rep-2', name: 'Drew', calls: 0, period_summary: { status: 'no_calls', from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z', patterns: [], coaching: { state: 'none' } } }] : [] }, teamCoachableLoading: false, teamNeedsWork: { available: false }, teamNeedsWorkLoading: false, teamDigest: { available: false }, teamDigestLoading: false, teamObjections: null, teamObjectionsLoading: false, teamObjSummary: null, teamObjSummaryLoading: false, teamObjSummaryWaitLong: false, teamObjDrillCategory: '', teamDetailMetric: null, teamObjectionCategory: '', teamRanges: {}, teamRangeInit: {} }; }
function overviewBase(overrides) { return Object.assign({ view: 'overview', me: { user_id: 'rep-1', role: 'manager' }, viewingUserId: 'rep-1', dateRange: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' }, analytics2: OVERVIEW_ANALYTICS, analytics2Loading: false, gradingBacklog: { graded: 12, waiting: 0, total: 12 }, needsWork: OVERVIEW_NEEDS_WORK, needsWorkLoading: false, focusEvidence: OVERVIEW_FOCUS_EVIDENCE, sectionRank: OVERVIEW_SECTION_RANK, sectionRankLoading: false, fathomStatus: { connected: true, last_sync_status: 'ok' }, zoomStatus: { connected: false }, repGraph: null, repGraphLoading: false, overviewExpanded: { coach: false, perf: false, recent: false } }, overrides || {}); }
const CALLS = [{ id: 'call-1', title: 'Discovery call with Morgan', prospect_name: 'Morgan Blake', call_date: '2026-09-12T10:00:00.000Z', duration_seconds: 2280, analysis_status: 'done', overall_score: 72, outcome: 'closed', outcome_source: 'manual', call_kind: 'booked', recording_url: 'https://fathom.video/calls/call-1', source: 'fathom' }, { id: 'call-2', title: 'Follow-up call', prospect_name: 'Taylor Reed', call_date: '2026-09-11T10:00:00.000Z', duration_seconds: 1860, analysis_status: 'processing', overall_score: null, outcome: null, call_kind: 'follow_up', recording_url: 'https://fathom.video/calls/call-2', source: 'zoom' }, { id: 'call-3', title: 'Qualification', prospect_name: '', call_date: '2026-09-10T10:00:00.000Z', duration_seconds: 1500, analysis_status: 'pending', overall_score: null, outcome: null, call_kind: 'booked', source: 'fathom' }];
function callsBase(overrides) { return Object.assign({ view: 'call-library', me: { user_id: 'rep-1', role: 'manager', is_managed: false }, viewingUserId: 'rep-1', users: [{ user_id: 'rep-1', first_name: 'Ava', last_name: 'Stone', email: 'ava@example.test' }, { user_id: 'rep-2', first_name: 'Drew', last_name: 'Lane', email: 'drew@example.test', managed_by: 'rep-1' }], callLibrary: CALLS, callLibraryLoading: false, callLibraryError: null, callLibraryCounts: { closed: 1, not_closed: 1, ungraded: 1 }, callLibraryFilter: null, callLibrarySort: null, callLibraryHasMore: true, callLibraryOffset: 3, callLibraryRange: { from: '2026-09-06T00:00:00.000Z', to: '2026-09-13T23:59:59.999Z' }, verdictQueue: { pending: [{ call_id: 'queue-1', user_id: 'rep-1', title: 'Internal planning call', call_date: '2026-09-12T10:00:00.000Z', rep: 'Ava Stone', reason: 'No prospect was present.' }, { call_id: 'queue-2', user_id: 'rep-2', title: 'Team hiring sync', call_date: '2026-09-11T10:00:00.000Z', rep: 'Drew Lane', reason: 'The recording is an internal meeting.' }, { call_id: 'queue-3', user_id: 'rep-1', title: 'Partner check-in', call_date: '2026-09-10T10:00:00.000Z', rep: 'Ava Stone', reason: 'No buyer conversation was found.' }], counts: { pending: 3, confirmed: 4, corrected: 1 } }, fathomNotice: null, fathomStatus: { connected: true, last_sync_status: 'ok' }, zoomStatus: { connected: false }, gradingBacklog: { waiting: 0, total: 3 } }, overrides || {}); }
function eodBase(overrides) { return Object.assign({ view: 'eod', me: { user_id: 'rep-1', role: 'manager', is_managed: false }, eodLoading: false, eodDate: '2026-09-13', fathomStatus: { connected: true, last_sync_status: 'ok' }, zoomStatus: { connected: false }, eodData: { date: '2026-09-13', sync: { connected: true, complete: true, synced_through: '2026-09-13T18:00:00.000Z' }, follow_up_closes: 1, calls: [{ call_id: 'eod-call-1', recording_url: 'https://fathom.video/calls/eod-call-1', analysis_status: 'done', follow_up_close: true, fields: { prospect_name: 'Morgan Blake', outcome: 'closed', cash_collected: '5000', summary: 'Asked for the sale after isolating the implementation concern.' }, edited: { prospect_name: false, cash_collected: true, summary: true } }, { call_id: 'eod-call-2', recording_url: 'https://fathom.video/calls/eod-call-2', analysis_status: 'processing', follow_up_close: false, fields: { prospect_name: 'Avery Cole', outcome: 'follow_up', cash_collected: '', summary: 'Confirmed a decision meeting for Tuesday.' }, edited: { prospect_name: false, cash_collected: false, summary: false } }] } }, overrides || {}); }
function digestBase(overrides) { return Object.assign(base('team'), { teamDigest: { available: true, date: '2026-09-12', recent_dates: ['2026-09-12', '2026-09-11'], stats: { closed: 1, calls: 21, follow_up: 17, lost: 0 }, summary: 'The team kept a steady pace while long-form follow-up conversations surfaced clear next steps.', notable: [{ rep: 'Ava', call_title: 'Morgan discovery', text: 'Ava clarified the buyer’s implementation concern before proposing a specific next step.', clip: 'https://fathom.video/calls/digest-1', source: 'fathom' }, { rep: 'Drew', call_title: 'Taylor follow-up', text: 'Drew confirmed the decision process and left the prospect with a dated follow-up.', clip: 'https://fathom.video/calls/digest-2', source: 'fathom' }, { rep: 'Morgan', call_title: 'Casey review', text: 'Morgan used the stated concern to connect the offer back to the prospect’s stated outcome.', clip: 'https://fathom.video/calls/digest-3', source: 'fathom' }], focus: 'Ask one more question before presenting the next step. The evidence today shows that specific timing and ownership still need to be named.', quiet: false, no_material: false }, teamDigestLoading: false }, overrides || {}); }
function objectionsBase(overrides) { return Object.assign(base('team-objections'), { teamObjections: TEAM_OBJECTIONS, teamObjectionsLoading: false, teamObjSummary: OBJECTION_SUMMARY, teamObjSummaryLoading: false, teamRanges: { objections: { from: '2026-08-15T00:00:00.000Z', to: '2026-09-13T23:59:59.999Z' } }, teamRangeInit: { objections: true } }, overrides || {}); }
function membersOwnerBase(overrides) { return Object.assign(base('team-members'), { me: MEMBER_USERS[0], users: MEMBER_USERS, teamContext: { is_owner: true, my_team_label: 'Northstar Sales', rep_count: 4, teams: [{ key: 'team-self', label: 'Northstar Sales', rep_count: 4, is_self: true }, { key: 'team-other', label: 'Second Team', rep_count: 2, is_self: false }] }, teamOverview: { team: { key: 'team-self', label: 'Northstar Sales' }, reps: [], per_rep: [], totals: {} }, teamOverviewLoading: false, teamRanges: { members: { from: '2026-08-15T00:00:00.000Z', to: '2026-09-13T23:59:59.999Z' } }, teamRangeInit: { members: true } }, overrides || {}); }
function membersManagerBase(overrides) { const me = { ...MEMBER_USERS[1], managed_by: null }; const users = [me].concat(MEMBER_USERS.slice(2).map((member) => ({ ...member, managed_by: me.user_id }))); return Object.assign(base('team-members'), { me, users, teamContext: { is_owner: false, my_team_label: 'Northstar Sales', rep_count: 3, teams: null }, teamOverview: { team: { key: me.user_id, label: 'Northstar Sales' }, reps: [], per_rep: [], totals: {} }, teamOverviewLoading: false, teamRanges: { members: { from: '2026-08-15T00:00:00.000Z', to: '2026-09-13T23:59:59.999Z' } }, teamRangeInit: { members: true } }, overrides || {}); }
function chromeFor(view) {
  const pages = [
    ['team', 'Daily Digest'],
    ['team-performance', 'Performance'],
    ['team-coaching', 'Coaching'],
    ['team-objections', 'Objections'],
    ['team-members', 'My Team'],
    ['team-dashboard', 'Customize'],
  ];
  const links = pages.map(([pageView, label]) => {
    const current = pageView === view;
    return '<a class="workspace-team-link' + (current ? ' is-current' : '') + '"'
      + (current ? ' aria-current="page"' : '') + ' href="#' + pageView + '">' + label + '</a>';
  }).join('');
  let chrome = view === 'overview'
    ? CHROME.replace('class="nav-link" id="navOverview"', 'class="nav-link nav-active" id="navOverview"')
    : CHROME;
  if (view === 'call-library') chrome = chrome.replace('class="nav-link" id="navCallLibrary"', 'class="nav-link nav-active" id="navCallLibrary"');
  if (view === 'eod') chrome = chrome.replace('class="nav-link" id="navEod"', 'class="nav-link nav-active" id="navEod"');
  if (view.startsWith('team')) chrome = chrome.replace('class="nav-link" id="navTeam"', 'class="nav-link nav-active" id="navTeam"');
  return chrome.replace('id="navTeamSep" style="display:none"', 'id="navTeamSep"')
    .replace('id="navTeamWrap" style="display:none"', 'id="navTeamWrap"')
    .replace('<nav class="workspace-team-pages" id="workspaceTeamPages" aria-label="Team pages"></nav>', '<nav class="workspace-team-pages" id="workspaceTeamPages" aria-label="Team pages">' + links + '</nav>');
}
function documentFor(view, overrides, renderOptions) { const state = view === 'overview' ? overviewBase(overrides) : (view === 'call-library' ? callsBase(overrides) : (view === 'eod' ? eodBase(overrides) : (view === 'team' ? digestBase(overrides) : (view === 'team-objections' ? objectionsBase(overrides) : (view === 'team-members' ? membersOwnerBase(overrides) : base(view)))))); const railSync = view === 'call-library' || view === 'eod' || view === 'team-objections' || view === 'team-members' ? '<script>' + OBSERVATORY_RAIL_SYNC + ';syncObservatoryRailClearance();</script>' : ''; const fixtureStyle = view === 'eod' || view === 'team' ? '<style>@media (min-width:901px){body[data-view="' + view + '"] #sidebar{min-height:520px}}</style>' : ''; return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + STYLE + '</style>' + fixtureStyle + '</head><body data-view="' + view + '">' + chromeFor(view) + '<div id="content">' + render(state, renderOptions) + '</div></main>' + railSync + '</body></html>'; }
function overviewLoadingFirstPaint(overrides) { const result = render(overviewBase(Object.assign({ analytics2: null, analytics2Loading: true, gradingBacklog: null, needsWork: null, needsWorkLoading: true, sectionRank: null, sectionRankLoading: true }, overrides || {})), { loading: true, captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup, document: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + STYLE + '</style></head><body' + (result.view ? ' data-view="' + result.view + '"' : '') + '>' + chromeFor('overview') + '<div id="content">' + result.markup + '</div></main></body></html>' }; }
function callsLoadingFirstPaint(overrides) { const result = render(callsBase(Object.assign({ callLibrary: null, callLibraryLoading: true }, overrides || {})), { captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup }; }
function eodLoadingFirstPaint(overrides) { const result = render(eodBase(Object.assign({ eodData: null, eodLoading: true }, overrides || {})), { captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup }; }
function digestLoadingFirstPaint(overrides) { const result = render(digestBase(Object.assign({ teamDigest: null, teamDigestLoading: true }, overrides || {})), { captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup }; }
function objectionsLoadingFirstPaint(overrides) { const result = render(objectionsBase(Object.assign({ teamObjections: null, teamObjectionsLoading: true, teamObjSummary: null, teamObjSummaryLoading: false }, overrides || {})), { captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup }; }
function membersLoadingFirstPaint(overrides) { const result = render(membersOwnerBase(Object.assign({ users: null }, overrides || {})), { captureBody: true }); return { startedWithoutView: result.startedWithoutView, view: result.view, markup: result.markup }; }
const NO_CALL_ANALYTICS = Object.assign({}, OVERVIEW_ANALYTICS, { prospect_close_rate: null, prospect_close_wins: 0, prospect_close_total: 0, calls: { analyzed: 0, total_in_range: 0, processing: 0, error: 0 }, avg_score: { mean: null, graded_calls: 0, win_mean: null, win_n: 0, other_mean: null, other_n: 0 }, close_rate: null, close_wins: 0, close_decided: 0, sections: {}, weakest_section: null, strongest_section: null });
function writeFixtures(directory) { fs.mkdirSync(directory, { recursive: true }); for (const view of ['team-performance', 'team-coaching']) fs.writeFileSync(path.join(directory, view + '.html'), documentFor(view)); fs.writeFileSync(path.join(directory, 'overview-populated.html'), documentFor('overview')); fs.writeFileSync(path.join(directory, 'overview-loading.html'), documentFor('overview', { analytics2: null, analytics2Loading: true, gradingBacklog: null, needsWork: null, needsWorkLoading: true, sectionRank: null, sectionRankLoading: true })); fs.writeFileSync(path.join(directory, 'overview-no-calls.html'), documentFor('overview', { analytics2: NO_CALL_ANALYTICS, gradingBacklog: { graded: 0, waiting: 0, total: 0 }, needsWork: { available: false, reason: 'No analyzed calls in this range.' }, sectionRank: { sections: [] } })); fs.writeFileSync(path.join(directory, 'calls-manager-populated.html'), documentFor('call-library')); fs.writeFileSync(path.join(directory, 'team-digest-populated.html'), documentFor('team')); fs.writeFileSync(path.join(directory, 'team-digest-empty.html'), documentFor('team', { teamDigest: { available: false, date: '2026-09-13', recent_dates: [], reason: 'It generates after the morning sync.' } })); fs.writeFileSync(path.join(directory, 'team-digest-no-material.html'), documentFor('team', { teamDigest: { available: true, date: '2026-09-12', recent_dates: ['2026-09-12'], stats: { closed: 1, calls: 21, follow_up: 17, lost: 0 }, no_material: true, copy: 'Nothing on file to judge the team against yet.' } })); fs.writeFileSync(path.join(directory, 'team-digest-loading.html'), documentFor('team', { teamDigest: null, teamDigestLoading: true })); fs.writeFileSync(path.join(directory, 'team-objections-populated.html'), documentFor('team-objections')); fs.writeFileSync(path.join(directory, 'team-objections-empty.html'), documentFor('team-objections', { teamObjections: { category: '', instances: [], instance_count: 0, truncated: false, grid: [], strict: true, excluded: { disqualifications: 0, logistical: 0 }, board_size: 12, closers: [], totals: objectionCounts(0, 0) }, teamObjSummary: { available: true, state: 'no_volume', card_text: 'No objection moments were found in this range.' } })); fs.writeFileSync(path.join(directory, 'team-objections-loading.html'), documentFor('team-objections', { teamObjections: null, teamObjectionsLoading: true, teamObjSummary: null, teamObjSummaryLoading: false })); fs.writeFileSync(path.join(directory, 'team-objections-error.html'), documentFor('team-objections', { teamObjections: { _error: true }, teamObjectionsLoading: false, teamObjSummary: { _error: true }, teamObjSummaryLoading: false })); fs.writeFileSync(path.join(directory, 'team-members-owner-populated.html'), documentFor('team-members')); fs.writeFileSync(path.join(directory, 'team-members-manager-populated.html'), documentFor('team-members', membersManagerBase())); fs.writeFileSync(path.join(directory, 'team-members-selected-unresolved.html'), documentFor('team-members', { teamSelected: 'team-other', teamOverview: null, teamOverviewLoading: true })); fs.writeFileSync(path.join(directory, 'team-members-empty.html'), documentFor('team-members', { users: MEMBER_USERS.filter((member) => !member.managed_by) })); fs.writeFileSync(path.join(directory, 'team-members-loading.html'), documentFor('team-members', { users: null })); fs.writeFileSync(path.join(directory, 'eod-populated.html'), documentFor('eod')); fs.writeFileSync(path.join(directory, 'eod-empty.html'), documentFor('eod', { eodData: { date: '2026-09-13', sync: { connected: true, complete: true }, calls: [] } })); fs.writeFileSync(path.join(directory, 'eod-loading.html'), documentFor('eod', { eodData: null, eodLoading: true })); return directory; }

if (require.main === module) process.stdout.write(writeFixtures(process.argv[2] || path.join(WEB, '__qa-observatory')) + '\n');
module.exports = { documentFor, overviewLoadingFirstPaint, callsLoadingFirstPaint, eodLoadingFirstPaint, digestLoadingFirstPaint, objectionsLoadingFirstPaint, membersLoadingFirstPaint, membersManagerBase, writeFixtures };
