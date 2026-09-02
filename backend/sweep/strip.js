'use strict';
/* ONE shared stripper for every detector — the 123 private copies in tests are
   themselves a ② finding; the sweep does not add a 124th. */
module.exports = require('../test/helpers/strip-comments');
