const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../lib/team-membership.js', 'utf8');
const { withBoardOwner } = require('../../../lib/team-membership');
test('team scope includes the owner', () => { assert.deepEqual(withBoardOwner('m', ['a']), ['m', 'a']); assert.ok(src); });
