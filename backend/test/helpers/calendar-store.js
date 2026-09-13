'use strict';
// Small range-aware Supabase wire for executed calendar route/service tests.
function calendarStore(seed = {}) {
  const tables = structuredClone(seed);
  const calls = [];
  return { tables, calls, from(table) {
    const filters = [];
    let action = 'select', values, start = 0, end = Infinity, returning = false;
    const q = {
      select() { returning = true; return q; }, eq(k, v) { filters.push(x => x[k] === v); return q; },
      gt(k, v) { filters.push(x => x[k] > v); return q; }, in(k, vs) { filters.push(x => vs.includes(x[k])); return q; },
      range(a, b) { start = a; end = b; return q; }, order() { return q; },
      upsert(v) { action = 'upsert'; values = v; return q; }, update(v) { action = 'update'; values = v; return q; },
      delete() { action = 'delete'; return q; }, maybeSingle() { return execute(true); }, then(ok, no) { return execute(false).then(ok, no); },
    };
    async function execute(single) {
      calls.push({ table, action, values });
      const rows = tables[table] ||= [];
      const found = rows.filter(x => filters.every(f => f(x)));
      let result = found;
      if (action === 'upsert') {
        const old = rows.find(x => x.user_id === values.user_id);
        if (old) Object.assign(old, structuredClone(values)); else rows.push(structuredClone(values));
        result = [values];
      } else if (action === 'update') found.forEach(x => Object.assign(x, structuredClone(values)));
      else if (action === 'delete') tables[table] = rows.filter(x => !found.includes(x));
      result = result.slice(start, end + 1);
      return { data: (returning || action === 'select') ? structuredClone(single ? result[0] || null : result) : null, error: null };
    }
    return q;
  } };
}
module.exports = { calendarStore };
