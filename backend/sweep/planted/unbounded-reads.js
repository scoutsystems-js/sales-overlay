// Planted fixtures for ⑧. Tags: P = must be flagged CANDIDATE; N = must NOT be.
async function planted(admin, ids, userId) {
  var a = await admin.from('call_highlights').select('id, quote').eq('user_id', userId); // P1 growing table, eq filter, no bound
  var b = await admin.from('fathom_calls').select('id').gte('call_date', '2026-01-01').lte('call_date', '2026-12-31'); // P2 date window, no bound
  var c = await admin.from('knowledge_base').select('id, content').eq('uploaded_by', userId); // P3 one uploader
  var d = await admin.from('call_analyses').select('fathom_call_id').eq('status', 'done'); // P4 whole table by status
  var e = await admin.from('objection_synthesis_cache').select('synthesis').eq('user_id', userId); // P5 cache rows per user
  var f = await admin.from('fathom_calls').select('id').eq('user_id', userId).range(0, 999); // N1 ranged
  var g = await admin.from('call_analyses').select('outcome').eq('fathom_call_id', ids[0]).maybeSingle(); // N2 single row
  var h = await admin.from('call_highlights').select('id').in('fathom_call_id', ids.slice(0, 100)); // N3 chunked ids
  var i = await admin.from('user_profiles').select('user_id, role').eq('managed_by', userId); // N4 bounded-by-users table
  var j = await admin.from('fathom_calls').update({ sync_status: 'processed' }).eq('id', ids[0]); // N5 a write, not a read
  var k = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).eq('user_id', userId); // N6 a COUNT, no rows
  var l = admin.from('fathom_calls').select('id').eq('user_id', userId); // N7 bounded in a LATER statement
  l = l.range(0, 999);
  var lr = await l;
  return [a, b, c, d, e, f, g, h, i, j, k, lr];
}
module.exports = planted;
