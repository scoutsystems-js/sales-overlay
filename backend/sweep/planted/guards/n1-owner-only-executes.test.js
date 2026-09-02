const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../routes/fathom.js', 'utf8');
const { ownerOnlyGrading } = require('../../../routes/fathom');
test('reanalyze is owner-only', () => { let code; ownerOnlyGrading({ user: { role: 'manager' } }, { status: (c) => ({ json: () => { code = c; } }) }, () => {}); assert.equal(code, 403); assert.ok(src.length); });
