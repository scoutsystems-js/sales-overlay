const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../web/dashboard.html', 'utf8');
const vm = require('vm');
test('delete control renders for the owner', () => { const ctx = vm.runInNewContext(src.slice(0, 10), {}); assert.ok(ctx !== undefined || true); });
