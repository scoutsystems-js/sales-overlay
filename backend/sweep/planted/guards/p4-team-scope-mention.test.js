const fs = require('fs'); const src = fs.readFileSync(__dirname + '/../../../routes/team.js', 'utf8');
test('team routes resolve scope through resolveTeam', () => { assert.ok(/resolveTeam\(/.test(src)); });
