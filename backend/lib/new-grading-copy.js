'use strict';
/* THE ZERO EXPLAINS ITSELF (Justin's ruling, 2026-09-08).

   Stage grading started with v60 on 2026-09-08. Every call graded before it has
   no stage record, so in any window made of those calls the stage population is
   ZERO while the legacy numbers on the same screen (team average, calls analysed,
   the Coach Summary bars) are real. Day one read "Awaiting grades — 120 calls"
   beside a rep whose grades the manager had been reading for a month: broken,
   not waiting.

   ONE sentence, written here and nowhere else, sits BESIDE every zero the stage
   population produces (the Team → Coaching panel and rep list, the rep's "What
   Needs Work" card, the section drilldown headline). It says three things: the
   calls WERE analysed; this view counts only calls graded with the new checks,
   which start with new calls; and what makes it change. It never blames the data
   and never reads as an error.

   TEMPORARY BY CONSTRUCTION, not by a date: the producers (lib/section-ranking,
   lib/rep-period-coaching) attach it only when a section has ZERO counted calls
   AND the window holds rows that predate stage grading (legacy_unreviewed > 0).
   The moment a period has a counted call, the ordinary states take over and this
   text cannot render. The true legacy numbers on the page stay — the fix is the
   zero explaining itself, never a real number hidden to remove a contradiction.
   Guard: test/new-grading-copy.test.js (lib, both routes, three surfaces rendered). */

const LABEL = 'Scores start with new calls';

function newGradingNote(analysed) {
  var n = Number(analysed) || 0;
  return 'This view only counts calls graded with the new checks. The ' + n + ' call' + (n === 1 ? '' : 's')
    + ' analysed in this period ' + (n === 1 ? 'was' : 'were') + ' graded before those checks, so nothing counts here yet. '
    + 'Scores fill in as new calls come in.';
}

module.exports = { LABEL: LABEL, newGradingNote: newGradingNote };
