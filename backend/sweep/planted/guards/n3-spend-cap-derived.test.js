const { graderCap } = require('../../../lib/selling-budget');
test('grader token cap is derived from the phrase count', () => { assert.equal(graderCap(12), 4500); });
