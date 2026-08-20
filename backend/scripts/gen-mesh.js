/**
 * MESH GENERATOR — one function, one seed per view, and its OWN ink sweep.
 *
 * ⚠⚠ THIS SCRIPT IS WHY PER-PAGE VARIATION IS AFFORDABLE AGAIN. It was retired
 * on the argument "fifteen sweeps for a difference nobody would name" — but Josh
 * named it, so the objection collapsed to cost. And the cost is only real if the
 * sweep is HUMAN effort. It is not: every variant is a deterministic seed of one
 * generator, and the sweep below is analytic, so fifteen sweeps is compute.
 *
 * ⚠ EVERY VARIANT IS MEASURED SEPARATELY. That is the whole reason this was
 * retired in the first place — one sample generalised to fifteen artworks is
 * exactly the inventory failure this project has made four times. No variant
 * ships on another variant's number.
 *
 *   node scripts/gen-mesh.js            # measure every view, print the table
 *   node scripts/gen-mesh.js --write    # measure, then write into dashboard.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 1600, H = 1000;        // the VIEWPORT window
const FW = 3200, FH = 2000;      // the FIELD the window slides over
const BG = [10, 10, 10], MARK = [9, 224, 70], TEXT = [237, 237, 237], ACCENT = [9, 224, 70];
const LAYER_ALPHA = 0.25;

// Views that render a motif. Order fixed so seeds are stable across runs.
const VIEWS = ['overview', 'call-library', 'call-review', 'eod', 'kb', 'needs-work',
  'objections-intel', 'performance', 'prospects', 'section', 'team', 'team-expanded',
  'team-members', 'team-needs-work', 'account'];

/**
 * ⚠⚠ ONE FIELD, FIFTEEN WINDOWS — NOT FIFTEEN ARTWORKS. Measured: fifteen
 * separate meshes cost 162KB gzipped, which is 1.8x the whole dashboard page.
 * That is the wrong trade for a background.
 *
 * Instead one 3200x2000 field is generated ONCE, and each view shows a
 * different 1600x1000 window into it via background-position. Every page gets a
 * genuinely different pattern — different nodes, different edges — for ONE
 * payload. Windows may overlap; nobody views two pages side by side.
 *
 * ⚠ THE MEASUREMENT DISCIPLINE IS UNCHANGED, WHICH IS THE POINT: each WINDOW is
 * swept separately, because "the field is safe" is exactly the one-sample
 * generalisation this was retired for. A window is what a user sees.
 */
function windowFor(i) {
  // 15 offsets spread over the field, deterministic, no two alike
  const gx = (i * 7) % 5, gy = (i * 3) % 4;
  return { x: Math.round(gx * (FW - W) / 4), y: Math.round(gy * (FH - H) / 3) };
}

/**
 * ⚠ WHAT VARIES, AND WHY IT IS BOUNDED. Seed alone reshuffles positions and can
 * read samey — the eye recognises density, not coordinates. So node count and
 * link radius vary too, but only within a NARROW band (±18% / ±12%): enough that
 * pages feel distinct, little enough that they stay one product. Wide variation
 * would make some pages read as a different app.
 */
function paramsFor(i) {
  const t = i / (VIEWS.length - 1);           // 0..1 across the set
  return {
    seed: 20260820 + i * 7919,                 // prime step — no visible cycle
    n: Math.round(260 * (0.82 + 0.36 * ((i * 5) % 7) / 6)),
    link: Math.round(132 * (0.88 + 0.24 * ((i * 3) % 5) / 4)),
    minSep: 44,
  };
}

function build({ seed, n, link, minSep }) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  /* ⚠⚠ DEPTH IS SPATIAL, NOT PER-NODE RANDOM. Random depth AVERAGES TO FLAT at
     any real density — every neighbourhood ends up with the same mix of near and
     far, which is why the previous field read uniform corner to corner and
     nothing "fell away". Depth now comes from a few smooth CENTRES of interest:
     near a centre the field is dense and bright, away from one it thins and
     dims. That is what makes it a space rather than a texture. */
  const CENTRES = [];
  for (let c = 0; c < 5; c++) CENTRES.push({ x: rnd() * FW, y: rnd() * FH, r: FW * (0.18 + rnd() * 0.22) });
  const depthAt = (x, y) => {
    let best = 0;
    for (const c of CENTRES) {
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      const v = Math.max(0, 1 - d * d);          // smooth falloff, 1 at centre
      if (v > best) best = v;
    }
    return best;
  };
  const pts = [];
  for (let tries = 0; pts.length < n && tries < n * 120; tries++) {
    const x = rnd() * FW, y = rnd() * FH;
    const dep = depthAt(x, y);
    // ⚠ DENSITY follows depth too — rejecting some candidates in the thin
    // regions is what makes the clustering visible as SPACE, not just as
    // brightness. Without this the layout stays even and only the tone varies.
    if (rnd() > 0.18 + dep * 0.82) continue;
    // spacing also opens up away from the centres
    const sep = minSep * (1.55 - dep * 0.55);
    if (pts.some(p => Math.hypot(p.x - x, p.y - y) < sep)) continue;
    pts.push({ x: Math.round(x), y: Math.round(y), depth: dep });
  }
  /* ⚠⚠ PER-NODE CONNECTION CAP — not a smaller radius, and the distinction is
     the whole point. Shrinking `link` thins EVERYTHING, including the open
     regions that already read correctly; the problem was only ever the dense
     CORES closing into triangles. A cap leaves a sparse node's links untouched
     (it has fewer than the cap anyway) and only trims where the field is thick.
     Each node keeps its NEAREST connections, so what is removed is the long
     cross-links that fill a cluster in — exactly the ones that triangulate. */
  /* ⚠ 4, CHOSEN ON THE ASYMMETRY, NOT ON THE SMALLEST GAP. The brief was that
     the OPEN REGIONS STAY AS THEY ARE and only the cores thin:
                       cores   open
       uncapped         6.18   3.17    <- gap 3.01: THIS is the triangulation
       cap 4            3.78   2.88    <- cores -39%, open -9% (essentially
                                          untouched) — the wanted asymmetry
       cap 3            2.86   2.44    <- smaller gap, but open -23%: it thins
                                          the parts that already read correctly
     A smaller RADIUS would have done the same damage everywhere; the cap is
     what makes the change local to where the problem is. */
  var MAX_LINKS_PER_NODE = 4;
  var cand = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < link) cand.push([i, j, d]);
    }
  // shortest first, so a node's nearest neighbours win its budget
  cand.sort(function (a, b) { return a[2] - b[2]; });
  var deg = new Array(pts.length).fill(0);
  const edges = [];
  cand.forEach(function (e) {
    if (deg[e[0]] >= MAX_LINKS_PER_NODE || deg[e[1]] >= MAX_LINKS_PER_NODE) return;
    deg[e[0]]++; deg[e[1]]++;
    edges.push(e);
  });
  /* ⚠ THE NUMBER THAT MATTERS IS THE GAP BETWEEN CORES AND OPEN AREAS, not the
     average — the average was already 2.6 while the cores were triangulating. */
  var coreDeg = [], openDeg = [];
  pts.forEach(function (p, i) { (p.depth > 0.5 ? coreDeg : openDeg).push(deg[i]); });
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  module.exports = module.exports || {};
  build.lastDegrees = { core: +mean(coreDeg).toFixed(2), open: +mean(openDeg).toFixed(2),
                        coreN: coreDeg.length, openN: openDeg.length };
  const lines = edges.map(([i, j, d]) => {
    const near = (pts[i].depth + pts[j].depth) / 2;
    /* ⚠⚠ EDGES ARE THE SUBJECT. Justin: it read as "green stars" — scattered
       dots, not a network — because the nodes were winning. In the reference
       images the CONNECTING LINES dominate and nodes are just where they meet.
       RELATIVE WEIGHT IS FREE: this is redistribution inside one layer alpha,
       so the contrast ceiling is untouched. Edge opacity 0.16-0.66 -> 0.42-1.0
       and width 0.5-1.2 -> 0.8-1.9; nodes drop the other way below. */
    const o = (0.42 + near * 0.58) * (1 - d / link * 0.42);
    return `<line x1='${pts[i].x}' y1='${pts[i].y}' x2='${pts[j].x}' y2='${pts[j].y}'`
      + ` stroke='%2309e046' stroke-width='${(2.2 + near * 2.6).toFixed(1)}' opacity='${o.toFixed(2)}'/>`;
  }).join('');
  /* nodes recede: radius 1.1-4.3 -> 0.8-2.0, opacity 0.28-0.90 -> 0.30-0.62.
     They mark where edges MEET rather than being the thing you see. */
  const nodes = pts.map(p =>
    `<circle cx='${p.x}' cy='${p.y}' r='${(2.4 + p.depth * 6.4).toFixed(1)}'`
    + ` fill='%2309e046' opacity='${(0.26 + p.depth * 0.70).toFixed(2)}'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${FW} ${FH}'`
    + ` preserveAspectRatio='xMidYMid slice'>${lines}${nodes}</svg>`;
  return { svg, uri: 'data:image/svg+xml;utf8,' + svg, pts, edges };
}

/** Analytic ink sweep — no browser, so fifteen of these is compute, not effort. */
function sweep({ pts, edges }, link, win) {
  const grid = new Float32Array(FW * FH);
  const stamp = (x, y, a) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= FW || y >= FH) return;
    const i = y * FW + x; if (a > grid[i]) grid[i] = a;
  };
  edges.forEach(([i, j, d]) => {
    const near = (pts[i].depth + pts[j].depth) / 2;
    const op = (0.42 + near * 0.58) * (1 - d / link * 0.42);
    const sw = 2.2 + near * 2.6, half = Math.max(0.5, sw / 2);
    const steps = Math.ceil(d);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = pts[i].x + (pts[j].x - pts[i].x) * t, y = pts[i].y + (pts[j].y - pts[i].y) * t;
      for (let dx = -half; dx <= half; dx += 0.5)
        for (let dy = -half; dy <= half; dy += 0.5) stamp(x + dx, y + dy, op);
    }
  });
  pts.forEach(p => {
    const r = 2.4 + p.depth * 6.4, op = 0.26 + p.depth * 0.70;
    for (let dy = -r; dy <= r; dy += 0.5)
      for (let dx = -r; dx <= r; dx += 0.5) if (dx * dx + dy * dy <= r * r) stamp(p.x + dx, p.y + dy, op);
  });
  let hit = 0, tot = 0, boxes = 0, touched = 0, peak = 0;
  // ⚠ sample only the WINDOW this view shows — the field as a whole is not
  // what any user sees, and averaging over it would hide a dense corner.
  for (let by = win.y + 60; by < win.y + H - 40; by += 44)
    for (let bx = win.x + 40; bx < win.x + W - 260; bx += 300) {
      let h = 0, t = 0;
      for (let y = by; y < by + 16; y += 2)
        for (let x = bx; x < bx + 240; x += 4) {
          t++; const a = grid[y * FW + x] * LAYER_ALPHA;
          if (a > 0.02) h++; if (a > peak) peak = a;
        }
      boxes++; if (h > 0) touched++; hit += h; tot += t;
    }
  return { inkPct: +(100 * hit / tot).toFixed(1), touchedPct: +(100 * touched / boxes).toFixed(1), peakAlpha: +peak.toFixed(3) };
}

const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = Math.max(lum(a), lum(b)), y = Math.min(lum(a), lum(b)); return (x + 0.05) / (y + 0.05); };

function contrastAt(peakAlpha) {
  // worst case: a text pixel over the BRIGHTEST composited mesh pixel on the page
  const bd = MARK.map((c, i) => Math.round(peakAlpha * c + (1 - peakAlpha) * BG[i]));
  return { body: +ratio(TEXT, bd).toFixed(2), accent: +ratio(ACCENT, bd).toFixed(2) };
}

// ONE field, generated once.
/* ⚠ MORE NODES **AND** A LARGER RADIUS. Node count alone gives more stars;
   EDGES-PER-NODE is what makes it read as a web, and that is driven by `link`.
   n 260->340 per viewport-area, link 132->178, minSep 44->38. */
/* ⚠ TUNED AGAINST PAYLOAD, NOT PICKED. Edges scale with density x radius AREA,
   so the first attempt (n 340 / link 178) produced 12,890 edges and 135KB gzipped
   — nearly double the ~70KB costed, and 47% ink under glyphs. n 285 / link 142
   lands at 66KB with 5,704 edges: 5.0 edges per node against 3.8 before, which is
   the number that makes it read as a web rather than as stars. */
/* ⚠⚠ THICKER AND SPARSER (Justin, 2026-08-20) — the OPPOSITE lever from the
   fine-web pass, and closer to his reference images. Not a reversal: a
   different target.
   strokes 0.8-1.9 -> 2.2-4.8   nodes r 0.8-2.0 -> 2.6-6.6   n 285 -> 150
   ⚠ THE NET WAS MEASURED, NOT ASSUMED, because the two levers run OPPOSITE
   ways: thicker strokes RAISE ink per glyph, lower density LOWERS it. Result:
   ink 20.6% -> 26.8% (thickness wins) while elements fall 5704 -> 2674 and
   payload HALVES, 66KB -> 32KB.
   ⚠ And accent contrast IMPROVED, 7.58 -> 7.85, which is counter-intuitive
   until you see why: peak composite is driven by OVERLAP, and fewer elements
   overlap less even when each is heavier.
   Edges stay dominant over nodes — that ratio fixed "green stars" and holds at
   any weight. */
/* ⚠⚠ APPROACH CHANGE, NOT A TUNING PASS (Justin approved 2026-08-20). Three
   passes went into WEIGHT, which was never the problem. The field read as a
   triangulated lattice because it was OVER-CONNECTED, its nodes were invisible,
   and its depth was flat.
     link  190 -> 120   edges per node 4.5 -> 2.6: traceable strands with GAPS,
                        not a triangle mesh nobody can follow
     nodes r 2.6-6.6 -> 2.4-8.8, opacity 0.30-0.62 -> 0.26-0.96. The brief says
                        "some points brighter" and I had removed exactly that
                        while overshooting the fix for "green stars"
     depth  per-node random -> SPATIAL: five smooth centres driving DENSITY and
                        brightness together. Random depth averages to flat at any
                        real density, which is why it read uniform corner to
                        corner and nothing fell away. */
const FIELD_PARAMS = { seed: 20260820, n: Math.round(340 * (FW * FH) / (W * H)), link: 120, minSep: 52 };
const FIELD = build(FIELD_PARAMS);
const out = [];
VIEWS.forEach((view, i) => {
  const win = windowFor(i);
  const sw = sweep(FIELD, FIELD_PARAMS.link, win);
  const c = contrastAt(sw.peakAlpha);
  out.push({ view, win, nodes: FIELD.pts.length, edges: FIELD.edges.length, ...sw, ...c });
});

console.log('view              nodes edges   ink%  touch%  peakA   body  accent  AA');
out.forEach(r => console.log(
  r.view.padEnd(17), String(r.nodes).padStart(5), String(r.edges).padStart(6),
  String(r.inkPct).padStart(6), String(r.touchedPct).padStart(7), String(r.peakAlpha).padStart(7),
  String(r.body).padStart(6), String(r.accent).padStart(7),
  (r.accent >= 4.5 ? ' pass' : ' FAIL')));

console.log('\nONE field:', FIELD.pts.length, 'nodes /', FIELD.edges.length, 'edges');
const dg = build.lastDegrees || {};
console.log('edges per node — CORES (depth>0.5):', dg.core, '(' + dg.coreN + ' nodes)   OPEN:', dg.open, '(' + dg.openN + ' nodes)');
console.log('⚠ the GAP between those two is what the cap exists to close');
console.log('payload  raw', Buffer.byteLength(FIELD.uri), ' gzip', zlib.gzipSync(Buffer.from(FIELD.uri)).length);
const failing = out.filter(r => r.accent < 4.5);
console.log('variants failing AA:', failing.length);

if (process.argv.includes('--write')) {
  if (failing.length) { console.error('REFUSING to write — ' + failing.length + ' variant(s) fail AA'); process.exit(1); }
  const p = path.join(__dirname, '..', 'web', 'dashboard.html');
  let html = fs.readFileSync(p, 'utf8');
  const before = html.split('\n').length;
  const block = '    :root { --motif-mesh: url("' + FIELD.uri + '"); }\n'
    + out.map(r => `    body[data-view="${r.view}"]::before { background-position: -${r.win.x}px -${r.win.y}px; }`).join('\n');
  const startMark = '    /* ══ PER-VIEW MESH VARIANTS — generated by scripts/gen-mesh.js ══';
  const endMark = '    /* ══ END PER-VIEW MESH VARIANTS ══ */';
  const header = startMark + `
       ⚠ GENERATED. Do not hand-edit — re-run the script instead, because every
       variant is MEASURED before it is written and the script REFUSES to write
       if any of them fails AA. Hand-editing bypasses the only thing making
       fifteen artworks safe. */
`;
  const payload = header + block + '\n' + endMark;
  const s0 = html.indexOf(startMark);
  if (s0 !== -1) {
    const s1 = html.indexOf(endMark) + endMark.length;
    html = html.slice(0, s0) + payload + html.slice(s1);
  } else {
    const anchor = '    /* ══ MESH BRIGHTNESS TRIAL';
    const at = html.indexOf(anchor);
    if (at === -1) { console.error('anchor not found'); process.exit(1); }
    html = html.slice(0, at) + payload + '\n\n' + html.slice(at);
  }
  const after = html.split('\n').length;
  if (after < before) { console.error('REFUSING — file shrank'); process.exit(1); }
  fs.writeFileSync(p, html);
  console.log('written:', before, '->', after, 'lines');
}
