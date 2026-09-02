'use strict';
/* Planted strippers for detect-stripper-copies. bad* must corrupt at least one killer; good* must corrupt none. */
module.exports = {
  bad_anywhere_line: function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); },          // K1: cuts the URL
  bad_block_first: function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }, // K3/K4
  bad_quote_tracker: function (s) { var out = '', inStr = false; for (var i = 0; i < s.length; i++) { var ch = s[i]; if (ch === "'") inStr = !inStr; if (!inStr && ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; } out += s[i] || ''; } return out; }, // K2: an apostrophe opens a "string"
  bad_greedy_block: function (s) { return s.replace(/\/\*[\s\S]*\*\//g, ''); },                                     // greedy: everything between the first /* and the last */
  bad_line_only: function (s) { return s.replace(/\/\/[^\n]*/g, ''); },                                              // K1, and leaks every block
  good_string_aware_regex: function (s) { return s.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n').replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\/\*[\s\S]*?\*\//g, function (m, str) { return str ? str : ''; }); },
  /* The REFERENCE stripper: strings, template literals AND regex literals are
     honoured (a `/` after `( , = : [ ! & | ? { } ; return` or at line start
     opens a regex; `[...]` classes may hold an unescaped `/`). Verified on
     dashboard.html: the inline script still parses (node --check), 549
     functions before and after, and the output is smaller than the shared
     stripper's (no comment text survives). */
  good_tokenizer: function (s) { var out = '', i = 0, last = ''; function prev() { return last; }
    while (i < s.length) { var c = s[i], n = s[i + 1];
      if (c === '"' || c === "'" || c === '`') { var q = c; out += c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') { out += s[i]; i++; } if (q !== '`' && s[i] === '\n') break; out += s[i]; i++; } out += s[i] || ''; i++; last = q; continue; }
      if (c === '<' && s.slice(i, i + 4) === '<!--') { var e = s.indexOf('-->', i); i = e < 0 ? s.length : e + 3; continue; } /* HTML comments are comments too — a copy that swallows one loses no code */
      if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '/' && /^(?:[(,=:\[!&|?{};]|return|typeof|case|\n|)$/.test(prev().trim().slice(-6).replace(/^.*?(return|typeof|case)$/, '$1').replace(/^.*([(,=:\[!&|?{};])$/, '$1')) ) { out += c; i++; var cls = false; while (i < s.length && s[i] !== '\n') { if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue; } if (s[i] === '[') cls = true; else if (s[i] === ']') cls = false; else if (s[i] === '/' && !cls) break; out += s[i]; i++; } out += s[i] || ''; i++; while (/[gimsuy]/.test(s[i] || '')) { out += s[i]; i++; } last = '/'; continue; }
      out += c; if (!/\s/.test(c)) last = (last + c).slice(-8); else if (c === '\n') last = '\n'; i++; }
    return out; },
  good_tokenizer_old: function (s) { var out = '', i = 0; while (i < s.length) { var c = s[i], n = s[i + 1]; if (c === '"' || c === "'" || c === '`') { var q = c; out += c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') { out += s[i]; i++; } out += s[i]; i++; } out += s[i] || ''; i++; continue; } if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; } if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; } out += c; i++; } return out; },
  good_line_start_then_block_tokenized: function (s) { return module.exports.good_tokenizer(s); },
  good_keeps_everything: function (s) { return s; },                                                                  // leaks all, corrupts nothing
  good_line_start_only: function (s) { return s.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); },
};
