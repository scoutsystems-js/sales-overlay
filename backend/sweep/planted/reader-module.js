'use strict';
function readsUnselected(row) { return row.p_six === 'x'; }        // P6 target: reads a column the caller never selected
function readsSelected(row) { return row.name === 'x'; }           // N6 target: reads a selected column
module.exports = { readsUnselected, readsSelected };
