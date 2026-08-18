# Archived modules

Replaced code is kept here rather than deleted (standing convention). The
`.archived` suffix keeps these files out of `require()` and out of the
`test/*.test.js` glob, so nothing runs them — they exist to be read.

| file | removed | why |
|---|---|---|
| `rep-gauges.js.archived` | 2026-08-18 | The per-rep speedometer panel. Josh: a dial per rep does not work at 20+ reps. Replaced by `lib/team-averages.js` — three TEAM-average gauges plus a count of how many reps clear each bar, which is the question that survives team growth. Its two test files are in `test/archive/`. |
