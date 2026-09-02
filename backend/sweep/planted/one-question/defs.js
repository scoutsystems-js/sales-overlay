'use strict';
const CATS = ['alpha', 'beta', 'gamma', 'delta'];           // P1: copied by hand in copy.js
const MAX_ROWS = 1000;                                       // P2: copy.js says 500
const CHUNK = 100;                                           // P5: copy.js also 100, nothing pins it
const IMPORTED = ['imp1', 'imp2', 'imp3'];                  // N1: consumer requires this module
const PINNED = ['pin1', 'pin2', 'pin3'];                    // N2: a mirror test pins the copy
const PINNED_MAX = 42;                                       // N4: a mirror test pins it
const ONLY_ONCE = 7;                                         // N5: declared once
const METRICS = { call_time: { direction: 'band' }, price: { direction: 'lower' } };  // P3: copy.js says ceiling
const WORDS = ['shared', 'x1', 'x2'];                       // N3: shares one word with another list
module.exports = { CATS, MAX_ROWS, CHUNK, IMPORTED, PINNED, PINNED_MAX, ONLY_ONCE, METRICS, WORDS };
