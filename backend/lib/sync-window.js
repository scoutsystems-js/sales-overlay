// lib/sync-window.js — how far back a first sync reaches, and what that costs.
//
// ⚠⚠ MEASURED, NOT ASSUMED (2026-08-24, live against Fathom):
//   • Fathom's page size is HARD-CODED at 10 and IGNORES `limit`
//     (?limit=25 and ?limit=100 both returned 10 and echoed "limit": 10).
//   • MAX_PAGES was 20 => a first sync could never exceed 200 calls.
//   • Josh received exactly 200, spanning 38 days. "It only goes back a month"
//     was a SYMPTOM OF A CALL-COUNT CAP. Nobody ever chose 30 days.
//   • His real history is 560 meetings / 56 pages / 17.8s back to 2021-09-16,
//     so the cap was silently dropping 360 of his calls.
//
// ⚠ THE PAGE CAP THEREFORE HAS TO SCALE WITH THE CHOICE. Offering "All time"
// while keeping a 200-call ceiling would be a lie in the UI — the option would
// appear to work and quietly return the same 200 rows.
//
// Pure and total. No I/O, never throws.

'use strict';

var WINDOWS = ['30d', '90d', 'all'];

/* ⚠ NULL = the user never chose. Existing connections are all NULL, so this
   must reproduce the OLD behaviour exactly (no created_after, 20 pages) or
   landing this change would silently alter what everyone already gets. */
var DEFAULT_WINDOW = null;

var WINDOW_DAYS = { '30d': 30, '90d': 90 };

/* Page caps, derived from the measurement above rather than picked:
     30d  -> 200 calls is far beyond any 30-day volume (Josh's busiest 38 days
             were 200 calls, and that is an outlier workspace).
     90d  -> 3x the window gets 3x the pages.
     all  -> 200 pages = 2000 calls. Josh needs 56. The cap is a runaway guard,
             not a product limit, and at ~0.3s/page the worst case is ~60s.
   ⚠ `truncated` still fires if a cap is hit, so a bigger workspace is TOLD
   rather than silently shortened. */
var PAGE_CAP = { '30d': 20, '90d': 60, all: 200 };
var LEGACY_PAGE_CAP = 20;

function isValidWindow(v) { return WINDOWS.indexOf(v) !== -1; }

function sanitizeWindow(v) {
  return isValidWindow(v) ? v : undefined;   // undefined = reject, never a silent default
}

/**
 * The `created_after` value for a FIRST sync (or a history backfill).
 * Returns null for 'all' and for the legacy default — Fathom must receive NO
 * created_after in those cases.
 *
 * ⚠ NEVER pass an epoch/1970 date instead of omitting: Fathom returns ZERO
 * results for it regardless of other filters. That is a recorded production
 * finding, and "just send a very old date" is the obvious wrong fix.
 */
function createdAfterFor(window, nowMs) {
  var days = WINDOW_DAYS[window];
  if (!days) return null;                       // 'all' or legacy default
  var t = (typeof nowMs === 'number' ? nowMs : 0) - days * 86400000;
  return new Date(t).toISOString();
}

function pageCapFor(window) {
  return Object.prototype.hasOwnProperty.call(PAGE_CAP, window) ? PAGE_CAP[window] : LEGACY_PAGE_CAP;
}

/** What to tell the user BEFORE they pick, so nobody chooses "All time" blind. */
function windowCost(window) {
  if (window === 'all') {
    return 'Everything Fathom has. Slowest to pull — a large history can take a minute '
         + 'or two. Only your 20 most recent calls are graded; the rest sit in your '
         + 'library ungraded until you ask for them.';
  }
  if (window === '90d') return 'The last 90 days. Your 20 most recent calls are graded.';
  return 'The last 30 days. Your 20 most recent calls are graded.';
}

module.exports = {
  WINDOWS: WINDOWS,
  DEFAULT_WINDOW: DEFAULT_WINDOW,
  PAGE_CAP: PAGE_CAP,
  LEGACY_PAGE_CAP: LEGACY_PAGE_CAP,
  isValidWindow: isValidWindow,
  sanitizeWindow: sanitizeWindow,
  createdAfterFor: createdAfterFor,
  pageCapFor: pageCapFor,
  windowCost: windowCost,
};
