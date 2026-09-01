/**
 * lib/coaching-tone.js — NEVER DIMINISH THE CLOSER'S WORK.
 *
 * ⚠⚠ JUSTIN'S STANDING RULE, 2026-09-01. The Daily Digest line that produced it:
 *
 *     "Three closes from 29 calls, BUT two of those closes arrived pre-sold —
 *      Whitlow told Josh 'I'm tired of being a W-2' before the pitch started."
 *
 * ⚠ THE INFORMATION IS GOOD AND HE SAID SO — "Josh getting that info is a great
 * pain point." Knowing which prospects arrived ready separates a deal a rep
 * CREATED from one that walked in sold, and that is worth telling a manager.
 * ⚠⚠ WHAT IS WRONG IS THE FRAMING. The word "but" turns three closes into a
 * caveat, and a rep reading it hears "your closes don't really count."
 *
 * MEASURED BEFORE WRITING THIS, across the cached synthesis lanes:
 *     digest           24 of 76   performance   20 of 79
 *     team             19 of 131  team_objections  11 of 44
 *     why_prose         0 of 274  <- the contrast: this shape is NOT inevitable
 * and the worst of them are not subtle:
 *     "Josh ran six calls and TECHNICALLY posted two closes, but both wins were
 *      pre-sold before he opened his mouth — a setter and prior conviction did
 *      the work, NOT HIM"
 *     "closed 1 — but the close was a pre-sold prospect, MEANING IT DOESN'T
 *      VALIDATE JOSH'S PROCESS"
 *
 * ⚠⚠ IT IS THE SAME CLASS AS TWO DEFECTS ALREADY FIXED — Scout coaching a rep
 * OUT of isolating, and Scout marking a rep down for a call that was never
 * closeable. A product that coaches salespeople cannot sound like it is taking
 * points off.
 *
 * ⚠⚠ THE RULE IS AN OPERATION, NOT AN ADJECTIVE, and that is deliberate: this
 * project has three times found that telling a model to "be X" fails where
 * telling it to PERFORM A TEST succeeds. "Never diminish" is something a model
 * can agree with and still violate. "Do not attach a subtracting clause to a
 * number the rep earned" is a thing it can check.
 */
'use strict';

/* ⚠ ONE DEFINITION, FOUR CONSUMERS. Four copies of a tone rule drift, and a
   drifted tone rule is invisible — nothing fails, the wording just softens in
   one lane and not another. */
var NEVER_DIMINISH = [
  'NEVER DIMINISH THE CLOSER\'S WORK. Do not attach a subtracting clause to a number they earned.',
  '- The tell is "but", "however", "though", "technically" or "on paper" directly after a count of closes, wins or deals. If you have written one, the sentence is taking credit away.',
  '- Context about a deal is worth telling and must be stated as its OWN fact, not as a deduction from the score. WRONG: "Three closes, but two arrived pre-sold." RIGHT: "Three closes. Two of the three came in already sold — Whitlow said \'I\'m tired of being a W-2\' before the pitch."',
  '- Never write that a rep did not earn a result, that a win does not count, that a close does not validate their process, or that someone else did the work.',
  '- A weak call is still coached plainly — this is not a rule about softening criticism. It is a rule about not subtracting from what a rep actually achieved.',
].join('\n');

module.exports = { NEVER_DIMINISH: NEVER_DIMINISH };
