// Zoom VTT → transcript adapter (sub-stage 2). Emits the exact shape the
// existing normalizer consumes: [{ speaker:{display_name}, text, timestamp:"HH:MM:SS" }]
// so a Zoom call rides normalizeTranscript → grader unchanged. Validated here
// against synthetic VTT; validated against a REAL Zoom recording once one exists.
const test = require('node:test');
const assert = require('node:assert');
const { parseVttToTranscript } = require('../lib/vtt-adapter');

test('standard Zoom VTT: "Name: text" cues, ms timestamps → HH:MM:SS turns', () => {
  const vtt = [
    'WEBVTT', '', '1',
    '00:00:05.120 --> 00:00:08.000',
    'John Smith: So how has business been?', '', '2',
    '00:01:12.500 --> 00:01:15.900',
    'Jane Doe: Honestly, revenue has been inconsistent.', '',
  ].join('\n');
  const t = parseVttToTranscript(vtt);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual(t[0], { speaker: { display_name: 'John Smith' }, text: 'So how has business been?', timestamp: '00:00:05' });
  assert.deepStrictEqual(t[1], { speaker: { display_name: 'Jane Doe' }, text: 'Honestly, revenue has been inconsistent.', timestamp: '00:01:12' });
});

test('voice-tag format <v Speaker>text</v> is supported', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Maria Lopez>Thanks for hopping on.</v>\n';
  const t = parseVttToTranscript(vtt);
  assert.deepStrictEqual(t[0], { speaker: { display_name: 'Maria Lopez' }, text: 'Thanks for hopping on.', timestamp: '00:00:01' });
});

test('consecutive cues from the SAME speaker merge into one turn (keep first timestamp)', () => {
  const vtt = [
    'WEBVTT', '',
    '00:00:05.000 --> 00:00:07.000', 'John Smith: First part', '',
    '00:00:07.000 --> 00:00:09.000', 'John Smith: and the rest.', '',
    '00:00:10.000 --> 00:00:12.000', 'Jane Doe: My turn.', '',
  ].join('\n');
  const t = parseVttToTranscript(vtt);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual(t[0], { speaker: { display_name: 'John Smith' }, text: 'First part and the rest.', timestamp: '00:00:05' });
  assert.deepStrictEqual(t[1], { speaker: { display_name: 'Jane Doe' }, text: 'My turn.', timestamp: '00:00:10' });
});

test('multi-line cue text joins with a space', () => {
  const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:06.000\nJohn Smith: line one\nline two\n';
  const t = parseVttToTranscript(vtt);
  assert.strictEqual(t[0].text, 'line one line two');
});

test('cue with no speaker prefix → display_name null, text preserved', () => {
  const vtt = 'WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nsomething with no colon speaker\n';
  const t = parseVttToTranscript(vtt);
  assert.deepStrictEqual(t[0], { speaker: { display_name: null }, text: 'something with no colon speaker', timestamp: '00:00:03' });
});

test('NOTE blocks, cue-index lines, and blank lines are ignored', () => {
  const vtt = [
    'WEBVTT', '', 'NOTE this is a comment', 'that spans two lines', '',
    '7', '00:00:01.000 --> 00:00:02.000', 'A B: hi', '',
  ].join('\n');
  const t = parseVttToTranscript(vtt);
  assert.strictEqual(t.length, 1);
  assert.deepStrictEqual(t[0], { speaker: { display_name: 'A B' }, text: 'hi', timestamp: '00:00:01' });
});

test('hours are preserved; empty/garbage input yields []', () => {
  const vtt = 'WEBVTT\n\n01:02:03.000 --> 01:02:05.000\nX: over an hour in\n';
  assert.strictEqual(parseVttToTranscript(vtt)[0].timestamp, '01:02:03');
  assert.deepStrictEqual(parseVttToTranscript(''), []);
  assert.deepStrictEqual(parseVttToTranscript(null), []);
  assert.deepStrictEqual(parseVttToTranscript('not a vtt at all'), []);
});
