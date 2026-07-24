// Zoom VTT → transcript adapter (sub-stage 2). Zoom's cloud-recording
// "audio_transcript" file is WebVTT: cue blocks with an optional index line, a
// "HH:MM:SS.mmm --> HH:MM:SS.mmm" timing line, and payload text usually prefixed
// with the speaker ("Name: text") or wrapped in a voice tag (<v Name>text</v>).
//
// Output is the SOURCE-AGNOSTIC transcript shape the pipeline already consumes
// (see analysis-worker.js:711 + transcript-normalizer.js): an array of
//   { speaker: { display_name }, text, timestamp: "HH:MM:SS" }
// so a Zoom call rides normalizeTranscript → grader with zero downstream change.
// Consecutive cues from the same speaker merge into one turn (closer to
// Fathom's per-turn granularity; keeps the first cue's timestamp).

// "HH:MM:SS.mmm" or "MM:SS.mmm" cue start → "HH:MM:SS" (drop ms; pad hours).
function cueStartToHms(startRaw) {
  var t = String(startRaw).trim().split('.')[0];      // drop milliseconds
  var parts = t.split(':');
  if (parts.length === 2) parts.unshift('00');        // MM:SS → 00:MM:SS
  if (parts.length !== 3) return null;
  return parts.map(function (p) { return String(p).padStart(2, '0'); }).join(':');
}

// Split a cue's payload into { speaker, text }. Supports "<v Name>text</v>"
// and "Name: text"; falls back to speaker=null when no name is present.
function splitSpeaker(payload) {
  var voice = payload.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?\s*$/i);
  if (voice) return { speaker: voice[1].trim(), text: voice[2].trim() };
  // "Name: text" — the name is everything before the FIRST ": " (colon+space).
  // Guard against false positives (e.g. a URL) by capping the name length.
  var idx = payload.indexOf(': ');
  if (idx > 0 && idx <= 60) {
    return { speaker: payload.slice(0, idx).trim(), text: payload.slice(idx + 2).trim() };
  }
  return { speaker: null, text: payload.trim() };
}

var TIMING_RE = /-->/;

function parseVttToTranscript(vtt) {
  if (typeof vtt !== 'string' || vtt.indexOf('-->') === -1) return [];
  var lines = vtt.replace(/\r\n/g, '\n').split('\n');
  var cues = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (TIMING_RE.test(line)) {
      var start = line.split('-->')[0].trim();
      var hms = cueStartToHms(start);
      // collect payload lines until the next blank line
      var payload = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') { payload.push(lines[i].trim()); i++; }
      if (hms && payload.length) {
        var sp = splitSpeaker(payload.join(' ').trim());
        if (sp.text) cues.push({ display_name: sp.speaker, text: sp.text, timestamp: hms });
      }
      continue;
    }
    i++;
  }

  // Merge consecutive same-speaker cues into one turn (keep first timestamp).
  var turns = [];
  for (var c = 0; c < cues.length; c++) {
    var cur = cues[c];
    var last = turns[turns.length - 1];
    if (last && last.speaker.display_name === cur.display_name) {
      last.text += ' ' + cur.text;
    } else {
      turns.push({ speaker: { display_name: cur.display_name }, text: cur.text, timestamp: cur.timestamp });
    }
  }
  return turns;
}

module.exports = { parseVttToTranscript: parseVttToTranscript, _cueStartToHms: cueStartToHms, _splitSpeaker: splitSpeaker };
