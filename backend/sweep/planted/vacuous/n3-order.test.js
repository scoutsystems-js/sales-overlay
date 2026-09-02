const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'product.js'), 'utf8'); const OTHER = fs.readFileSync(path.join(__dirname, 'other.js'), 'utf8');
function strip(s) { return s.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }
test('n3-order', () => { assert.ok(strip(SRC).indexOf('function beta') !== -1 && strip(SRC).indexOf('function gamma') !== -1 && strip(SRC).indexOf('function beta') < strip(SRC).indexOf('function gamma')); });
