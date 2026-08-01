// Sub-stage 2 — Zoom sync pure logic (TDD).
// Covers the mapping (Zoom recordings-list meeting → fathom_calls row), the
// transcript-file pick, the meeting-UUID double-encode, and that Zoom's
// first-analysis cap is literally Fathom's (same constant + same picker).
const test = require('node:test');
const assert = require('node:assert');

const zoom = require('../lib/zoom-client');
const fathom = require('../routes/fathom');
const zoomRoute = require('../routes/zoom');

// ── zoomRecordingToRow: Zoom meeting → fathom_calls row ───────────────────────
test('zoomRecordingToRow maps a normal cloud recording', function () {
  var m = {
    uuid: 'abc/d==',
    id: 87654321,
    topic: '  Discovery call — Jane  ',
    start_time: '2026-07-20T15:00:00Z',
    duration: 42, // MINUTES per Zoom
    share_url: 'https://zoom.us/rec/share/xyz',
    recording_files: [],
  };
  var row = zoom.zoomRecordingToRow('user-1', m);
  assert.strictEqual(row.user_id, 'user-1');
  assert.strictEqual(row.fathom_call_id, 'abc/d=='); // the Zoom instance uuid
  assert.strictEqual(row.source, 'zoom');
  assert.strictEqual(row.title, 'Discovery call — Jane'); // trimmed
  assert.strictEqual(row.call_date, '2026-07-20T15:00:00Z');
  assert.strictEqual(row.duration_seconds, 42 * 60);
  assert.strictEqual(row.recording_url, 'https://zoom.us/rec/share/xyz');
  assert.strictEqual(row.sync_status, 'pending');
});

test('zoomRecordingToRow returns null when uuid is missing (malformed)', function () {
  assert.strictEqual(zoom.zoomRecordingToRow('u', { topic: 'x', duration: 10 }), null);
  assert.strictEqual(zoom.zoomRecordingToRow('u', null), null);
});

test('zoomRecordingToRow caps absurd durations to null (sanity), like Fathom', function () {
  var row = zoom.zoomRecordingToRow('u', { uuid: 'z', start_time: '2026-01-01T00:00:00Z', duration: 60 * 24 * 30 }); // 30 days of minutes
  assert.strictEqual(row.duration_seconds, null);
});

test('zoomRecordingToRow tolerates missing duration/title/url', function () {
  var row = zoom.zoomRecordingToRow('u', { uuid: 'z2', start_time: '2026-01-01T00:00:00Z' });
  assert.strictEqual(row.duration_seconds, null);
  assert.strictEqual(row.title, null);
  assert.strictEqual(row.recording_url, null);
  assert.strictEqual(row.fathom_call_id, 'z2');
});

// ── pickTranscriptFile: find the VTT transcript among recording files ─────────
test('pickTranscriptFile finds the transcript file by file_type/recording_type', function () {
  var files = [
    { id: 'f1', file_type: 'MP4', recording_type: 'shared_screen_with_speaker_view' },
    { id: 'f2', file_type: 'M4A', recording_type: 'audio_only' },
    { id: 'f3', file_type: 'TRANSCRIPT', file_extension: 'VTT', recording_type: 'audio_transcript', download_url: 'https://zoom.us/rec/dl/vtt' },
  ];
  var f = zoom.pickTranscriptFile(files);
  assert.ok(f);
  assert.strictEqual(f.id, 'f3');
});

test('pickTranscriptFile returns null when no transcript is present (not ready / free plan)', function () {
  assert.strictEqual(zoom.pickTranscriptFile([{ id: 'f1', file_type: 'MP4' }]), null);
  assert.strictEqual(zoom.pickTranscriptFile([]), null);
  assert.strictEqual(zoom.pickTranscriptFile(null), null);
});

// ── encodeMeetingUuid: Zoom's double-encode rule for '/' and '//' ─────────────
test('encodeMeetingUuid double-encodes a uuid containing a slash', function () {
  // "abc/d==" → single-encode "abc%2Fd%3D%3D" → double "abc%252Fd%253D%253D"
  assert.strictEqual(zoom.encodeMeetingUuid('abc/d=='), encodeURIComponent(encodeURIComponent('abc/d==')));
});
test('encodeMeetingUuid double-encodes a uuid starting with a slash', function () {
  assert.strictEqual(zoom.encodeMeetingUuid('/abcd'), encodeURIComponent(encodeURIComponent('/abcd')));
});
test('encodeMeetingUuid single-encodes a plain uuid', function () {
  assert.strictEqual(zoom.encodeMeetingUuid('plainUuid=='), encodeURIComponent('plainUuid=='));
});

// ── First-analysis cap: Zoom must use the SAME cap + picker as Fathom ─────────
test('Zoom reuses Fathom FIRST_SYNC_ANALYZE_CAP (=20) and pickNewestForAnalysis', function () {
  assert.strictEqual(zoomRoute._FIRST_SYNC_ANALYZE_CAP, 20);
  assert.strictEqual(zoomRoute._FIRST_SYNC_ANALYZE_CAP, fathom._FIRST_SYNC_ANALYZE_CAP);
  assert.strictEqual(zoomRoute._pickNewestForAnalysis, fathom._pickNewestForAnalysis);

  // Build 25 rows; newest 20 by call_date should be selected.
  var rows = [];
  for (var i = 0; i < 25; i++) {
    var day = String(i + 1).padStart(2, '0');
    rows.push({ id: 'id-' + i, call_date: '2026-07-' + day + 'T00:00:00Z' });
  }
  var picked = zoomRoute._pickNewestForAnalysis(rows, zoomRoute._FIRST_SYNC_ANALYZE_CAP);
  assert.strictEqual(picked.length, 20);
  assert.strictEqual(picked[0], 'id-24'); // newest (2026-07-25)
  assert.ok(picked.indexOf('id-0') === -1); // oldest 5 excluded
  assert.ok(picked.indexOf('id-4') === -1);
});
