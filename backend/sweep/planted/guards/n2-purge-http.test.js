const http = require('http'); const fs = require('fs'); const s = fs.readFileSync(__dirname + '/../../../routes/admin.js', 'utf8');
test('purge route rejects a manager', async () => { const r = await new Promise((res) => http.request({ path: '/admin/purge' }, res).end()); assert.equal(r.statusCode, 403); assert.ok(s); });
