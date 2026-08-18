/**
 * WHAT A "CLIP" IS IN SCOUT, AND WHAT TO CALL IT.
 *
 * A clip is a TIMESTAMPED DEEP LINK into the provider's own player — not a video
 * file. Nothing is cut, stored or hosted by us:
 *
 *     recording_url + ('?' or '&') + 't=' + timestamp_seconds
 *
 * ⚠ THE LABEL DIFFERS BY PROVIDER, AND THAT IS THE WHOLE POINT OF THIS MODULE.
 *   Fathom  — `?t=` is their documented deep-link format. It SEEKS. → "Clip"
 *   Zoom    — share links carry NO timestamp parameter. The link opens the
 *             recording AT THE START. → "Open Recording"
 *
 * Calling the Zoom one a "clip" would promise a moment and deliver 00:00, which
 * is worse than a button that says plainly what it does. Zoom reaches parity
 * only when clip EXTRACTION lands (Zoom sub-stage 3: download → ffmpeg-cut →
 * discard source → store) — that is a different, unbuilt piece of work.
 *
 * ⚠ NO RECORDING URL → NO BUTTON, not a disabled one. "This call has no
 * recording URL" is information about our sync, not something a user can act on;
 * a disabled control says "this should work and doesn't". Absence says "there is
 * nothing to open", which is the truth.
 * (Measured 2026-08-17: 369 of 369 REAL calls have a recording_url and 1,346 of
 * 1,346 real moments are clickable. The only rows without one are seeded.)
 */

const SEEKS = { fathom: true, zoom: false };

function clipLabel(source) {
  return SEEKS[String(source || '').toLowerCase()] === true ? 'Clip' : 'Open Recording';
}

// Returns null when there is nothing to open — callers render NOTHING on null.
function clipHref(recordingUrl, timestampSeconds) {
  if (!recordingUrl || typeof timestampSeconds !== 'number' || !isFinite(timestampSeconds)) return null;
  return recordingUrl + (recordingUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + Math.max(0, Math.round(timestampSeconds));
}

function providerSeeks(source) { return SEEKS[String(source || '').toLowerCase()] === true; }

module.exports = { clipLabel: clipLabel, clipHref: clipHref, providerSeeks: providerSeeks, SEEKS: SEEKS };
