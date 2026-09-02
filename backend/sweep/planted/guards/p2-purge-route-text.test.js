const fs = require('fs'); const s = fs.readFileSync(__dirname + '/../../../routes/admin.js', 'utf8');
test('purge route checks role', () => { assert.ok(s.includes("requireRole('owner')")); });
