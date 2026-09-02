var { readsUnselected, readsSelected } = require('./reader-module');
async function planted(admin, id) {
  var a = await admin.from('t').select('id, name').eq('x', 1);
  (a.data || []).forEach(function (r) { console.log(r.name, r.p_one); });            // P1: p_one not selected
  var b = await admin.from('t').select('id, name').eq('x', 1);
  var rows = (b.data || []);
  rows.map(function (r) { return r.p_two; });                                          // P2: via an alias of .data
  var c = await admin.from('t').select('id, name').eq('x', 1).maybeSingle();
  console.log(c.data.p_three);                                                        // P3: single-row read
  var d = await admin.from('t').select('id, name, meta').eq('x', 1);
  (d.data || []).filter(function (r) { return r.p_four === 1; });                     // P4: in a filter callback
  var e = await admin.from('t').select('id, name').eq('x', 1);
  (e.data || []).some(function (r) { return r.p_five; });                             // P5: in a some callback
  var f = await admin.from('t').select('id, n_one').eq('x', 1);
  (f.data || []).forEach(function (r) { console.log(r.n_one); });                     // N1: selected
  var g = await admin.from('t').select('id, n_two:real_col').eq('x', 1);
  (g.data || []).forEach(function (r) { console.log(r.n_two); });                     // N2: aliased column
  var h = await admin.from('t').select('id, n_three(a, b)').eq('x', 1);
  (h.data || []).forEach(function (r) { console.log(r.n_three); });                   // N3: embedded resource
  var i = await admin.from('t').select('*').eq('x', 1);
  (i.data || []).forEach(function (r) { console.log(r.n_four); });                    // N4: star select
  var j = await admin.from('t').select('id, meta').eq('x', 1);
  (j.data || []).forEach(function (r) { console.log(r.meta.n_five); });               // N5: a field of a selected JSON column
  var k = await admin.from('t').select('id, name').eq('x', 1);
  (k.data || []).forEach(function (r) { if (readsUnselected(r)) console.log(r.name); });   // P6: cross-module read of p_six
  var l = await admin.from('t').select('id, name').eq('x', 1);
  (l.data || []).forEach(function (r) { if (readsSelected(r)) console.log(r.name); });     // N6: cross-module read of a selected column
  var chunks = [];
  [1, 2].forEach(function (n) { chunks.push(admin.from('t').select('id, name, n_seven').eq('x', n)); });
  var res = await Promise.all(chunks);
  res.forEach(function (r) { (r.data || []).forEach(function (o) { console.log(o.n_seven, o.p_seven); }); });  // P7: chunked shape, p_seven unselected; N7: n_seven selected
  var xa = [], xb = [];
  [1, 2].forEach(function (n) { xa.push(admin.from('t').select('id, n_eight').eq('x', n)); xb.push(admin.from('t').select('id').eq('x', n)); });
  var both = await Promise.all([Promise.all(xa), Promise.all(xb)]);
  both[0].forEach(function (r) { (r.data || []).forEach(function (o) { console.log(o.n_eight); }); });   // N8: n_eight selected by xa — cross-attribution to xb would flag it
  both[1].forEach(function (r) { (r.data || []).forEach(function (o) { console.log(o.p_eight); }); });   // P8: p_eight not selected by xb
  return [a, b, c, d, e, f, g, h, i, j, k, l, res, both];
}
module.exports = planted;
