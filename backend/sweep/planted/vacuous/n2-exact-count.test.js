const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'product.js'), 'utf8'); const OTHER = fs.readFileSync(path.join(__dirname, 'other.js'), 'utf8');
function strip(s) { return s.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }
test('n2-exact-count', () => { assert.strictEqual((strip(SRC).match(/ETA/g) || []).length, 3); });
