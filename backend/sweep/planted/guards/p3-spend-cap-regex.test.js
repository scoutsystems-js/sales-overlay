const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../lib/analysis-worker.js', 'utf8');
test('grader token cap is 4500', () => { assert.match(src, /max_tokens:\s*4500/); });
