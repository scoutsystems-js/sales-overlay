const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../routes/fathom.js', 'utf8');
test('reanalyze is owner-only', () => { assert.ok(src.indexOf('ownerOnlyGrading') > -1); });
