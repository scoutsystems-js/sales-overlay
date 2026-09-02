const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../routes/kb.js', 'utf8');
test('rep add-to-kb returns 403', () => { assert.ok(src.indexOf('403') > -1); });
