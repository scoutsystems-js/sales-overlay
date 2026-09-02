'use strict';
const { IMPORTED } = require('./defs');
const LOCAL = ['imp1', 'imp2', 'imp3'];   // N1: the same list, but this file requires defs — derived
module.exports = { LOCAL, IMPORTED };
