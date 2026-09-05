/**
 * lib/comparison-floor.js — THE ONE COMPARISON FLOOR, with no dependencies (H738).
 *
 * MIN_BUCKET lived in lib/team-needs-work, which requires lib/team-synthesis, which required team-needs-work back for
 * this constant — a cycle. In production load order team-synthesis received the PARTIAL exports and its MIN_BUCKET was
 * undefined from 2026-09-04 (H728) until today: the page-facts floor in the recommendations lane ran with no floor and
 * nothing threw (H061: a cycle makes a shared constant undefined at import time). The constant now lives here, where
 * nothing can be mid-load, and team-needs-work re-exports it so every existing import keeps its meaning.
 */
'use strict';
var MIN_BUCKET = 6;            // no "needs work" claim, no comparison, no arrow off a bucket smaller than this
var PERSONAL_MIN_BUCKET = 4;   // the personal page's softer floor (one closer has a fraction of a team's objections)
module.exports = { MIN_BUCKET: MIN_BUCKET, PERSONAL_MIN_BUCKET: PERSONAL_MIN_BUCKET };
