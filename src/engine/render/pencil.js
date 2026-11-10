// Pencil. Graphite is modeled rather than textured:
//  - pressure along each stroke: slow strokes and downstrokes press harder,
//    upstrokes lighter, and the line eases in at touch-down and fades at lift-off
//  - each stroke is a faint body plus several thin, slightly wandering fibers
//    (the striations a graphite tip leaves along the direction of travel)
//  - every stroke is its own translucent layer, so crossings and retraced
//    strokes build up darker graphite, as on paper
//  - a paper-tooth filter that depends on how much graphite is there: heavy
//    marks stay nearly solid, light ones break up into speckles; edges, which
//    get the least graphite, come out naturally fuzzy
import { centroid, dist, polyLength, resample, smoothSeries } from '../geometry.js';
import { clamp, makeRng } from '../util.js';
import { dotPath, escapeAttr, fmt, inkPath } from './paths.js';

const FIBERS = 3;
const LEVELS = 8; // fiber opacities are bucketed into this many levels
const f1 = (n) => (Math.round(n * 10) / 10).toString(); // 0.1px is plenty for fibers

// a letter's graphite, kept per glyph (it only depends on the letter, its own
// randomness and pressure, not on where it is)
const pencilCache = new WeakMap();

// The placed glyphs in pencil (o.region: the part of the page they're in). The
// caller closes the <g> this opens.
export function pencilSVG(placed, o, penPx, maskAttr) {
  const R = o.region || { x: 0, y: 0, w: o.width, h: o.height };
  const pc = clamp(o.penConsistency == null ? 0.6 : +o.penConsistency, 0, 1);
  const id = 'hw' + (o.idSuffix || '0') + 'p';
  const out = [pencilFilter(id, R, o, penPx), `<g filter="url(#${id})"${maskAttr}>`];
  const state = { rng: makeRng((o.grainSeed || 1) * 7919 + 13) };
  for (const g of placed) {
    if (!g.glyph || !g.key) {
      out.push(...glyphGraphite(g, state, penPx, pc, o));
      continue;
    }
    // drawn once at its own origin, kept, and moved into place
    let byKey = pencilCache.get(g.glyph);
    if (!byKey) pencilCache.set(g.glyph, (byKey = new Map()));
    const key = [o.grainSeed || 1, g.key, g.ps, g.opacity, penPx, pc].join('|');
    let drawn = byKey.get(key);
    if (drawn == null) {
      const atOrigin = {
        ...g,
        strokes: g.glyph.strokes.map((st) => st.map((p) => ({ x: p.x * g.ps, y: p.y * g.ps, w: p.w }))),
      };
      drawn = glyphGraphite(atOrigin, state, penPx, pc, o).join('');
      if (byKey.size > 64) byKey.clear();
      byKey.set(key, drawn);
    }
    out.push(`<g transform="translate(${fmt(g.ox)} ${fmt(g.oy)})">${drawn}</g>`);
  }
  return out.join('\n');
}

function pencilFilter(id, R, o, penPx) {
  const color = escapeAttr(o.color);
  const seed = o.grainSeed || 1;
  const freq = clamp(2.4 / Math.max(penPx, 0.5), 0.45, 1.8);
  return (
    `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}" color-interpolation-filters="sRGB">` +
    // amount of graphite (alpha only), softened a little so the edges become a
    // gradient the grain can eat into (fuzzy rather than cut-out edges)
    `<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="A0"/>` +
    `<feGaussianBlur in="A0" stdDeviation="${fmt(Math.max(0.35, penPx * 0.13))}" result="A"/>` +
    // paper tooth (more octaves keep detail when zoomed in)
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(freq)}" numOctaves="4" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="G"/>` +
    // light marks lose more to the tooth than heavy ones: 1.7·A − 0.8·(1 − G)
    `<feComposite in="A" in2="G" operator="arithmetic" k1="0" k2="1.7" k3="0.8" k4="-0.8" result="M"/>` +
    // fine grain: even heavy marks miss the deepest pits of the paper
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(freq * 2.6)}" numOctaves="3" seed="${seed + 3}" result="fn"/>` +
    `<feColorMatrix in="fn" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="F"/>` +
    `<feComposite in="M" in2="F" operator="arithmetic" k1="1.3" k2="0.38" k3="0" k4="0" result="M2"/>` +
    `<feFlood flood-color="${color}" result="C"/>` +
    `<feComposite in="C" in2="M2" operator="in" result="P"/>` +
    // irregular edges: a slow wobble plus fine raggedness
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(freq * 0.2)}" numOctaves="1" seed="${seed + 7}" result="w"/>` +
    `<feDisplacementMap in="P" in2="w" scale="${fmt(Math.max(0.5, penPx * 0.25))}" xChannelSelector="R" yChannelSelector="G" result="P2"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(freq * 1.4)}" numOctaves="2" seed="${seed + 11}" result="w2"/>` +
    `<feDisplacementMap in="P2" in2="w2" scale="${fmt(Math.max(0.6, penPx * 0.4))}" xChannelSelector="G" yChannelSelector="R"/>` +
    `</filter></defs>`
  );
}

// One letter's graphite: a list of SVG elements. state.rng is the randomness to
// draw with (a keyed letter gets its own, so editing one word leaves the others
// as they were).
function glyphGraphite(g, state, penPx, pc, o) {
  const out = [];
  const glyphP = g.opacity == null ? 1 : g.opacity; // per-letter pressure
  if (g.key) state.rng = makeRng((o.grainSeed || 1) + '|' + g.key);
  const rng = state.rng;
  const profiles = g.strokes.map((st) => pressureProfile(st, penPx));
  // strokes of one letter are written with about the same pressure, so each stroke
  // keeps only a little of its own level (its variation along the stroke is kept,
  // but evened out too)
  const lines = profiles.filter((q) => !q.dot);
  const gMean = lines.length
    ? lines.reduce((t, q) => t + q.mean * q.len, 0) / lines.reduce((t, q) => t + q.len, 0)
    : 0.74;
  for (const q of profiles) {
    if (q.dot) out.push(...graphiteDot(q.st, rng, penPx, glyphP));
    else out.push(...graphiteStroke(q, rng, penPx, pc, glyphP, gMean));
  }
  return out;
}

// how hard the pencil presses along a stroke: { st, len, n, press, P (resampled
// points), raw: [{ core, fade }], mean }, or { dot: true, st } for a dot
function pressureProfile(st, penPx) {
  const len = polyLength(st);
  if (st.length < 2 || len < penPx * 1.2) return { dot: true, st };
  const n = Math.max(4, Math.ceil(len / Math.max(2, penPx * 0.8)));
  const press = len < penPx * 4; // dot-like flick: pressed, not eased in and out
  const P = resample(st, n);
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
  // fades at touch-down / lift-off never take over a short stroke
  const tIn = Math.min(penPx * 3, len * 0.15);
  const tOut = Math.min(penPx * 6, len * 0.3);
  const raw = P.map((pt, i) => {
    const a = P[Math.max(0, i - 2)];
    const b = P[Math.min(n - 1, i + 2)];
    const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const down = (b.y - a.y) / dl; // +1 moving down the page, -1 moving up
    const w = pt.w == null ? 1 : pt.w; // >1: written slowly, <1: fast
    const touch = press ? 1 : Math.min(1, Math.sqrt(cum[i] / tIn));
    const lift = press ? 1 : Math.min(1, Math.pow((len - cum[i]) / tOut, 0.7));
    return { core: 0.74 + 0.3 * (w - 1) + 0.07 * down, fade: (0.6 + 0.4 * touch) * (0.5 + 0.5 * lift) };
  });
  const mean = raw.reduce((t, r) => t + r.core, 0) / raw.length;
  return { st, len, n, press, P, raw, mean };
}

// dots: a short press, a little denser in the middle
function graphiteDot(st, rng, penPx, glyphP) {
  const c = centroid(st);
  const rad = penPx * 0.75;
  return [
    `<path d="${dotPath(c, rad)}" fill="#000" opacity="${fmt(0.65 * glyphP)}"/>`,
    `<path d="${dotPath({ x: c.x + rng.normal() * 0.15 * rad, y: c.y + rng.normal() * 0.15 * rad }, rad * 0.65)}" fill="#000" opacity="${fmt(0.65 * glyphP)}"/>`,
  ];
}

// a stroke: a faint body under a few fibers, split into short runs so pressure
// can change along the stroke
function graphiteStroke(q, rng, penPx, pc, glyphP, gMean) {
  const { len, n, press, P, raw } = q;
  const out = [];
  const strokeP = clamp(1 + rng.normal() * 0.025 * (1.2 - pc), 0.93, 1.07);
  const level = gMean + 0.25 * (q.mean - gMean);
  const pressure = raw.map((r) => ({
    v: clamp((level + 0.6 * (r.core - q.mean)) * strokeP * glyphP * r.fade, 0.2, 1),
  }));
  smoothSeries(pressure, 'v', 2);
  const pr = pressure.map((t) => t.v);
  const normals = P.map((pt, i) => {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(n - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / tl, y: (b.x - a.x) / tl };
  });
  const hw = pr.map((p) => (penPx / 2) * (0.7 + 0.4 * p));
  // faint body: continuous coverage under the fibers
  const body = inkPath(
    P.map((pt, i) => ({ x: pt.x, y: pt.y, w: 0.85 * (0.7 + 0.4 * pr[i]) })),
    penPx,
  );
  out.push(`<path d="${body}" fill="#000" opacity="${fmt((press ? 0.45 : 0.22) * strokeP * glyphP)}"/>`);
  const segPts = Math.max(3, Math.round((penPx * 4) / (len / n)));
  for (let f = 0; f < FIBERS; f++) {
    const u = ((f + 0.5) / FIBERS - 0.5) * 1.6; // across the width
    const gain = 0.88 + 0.16 * rng() - 0.12 * Math.abs(u); // outer fibers a bit lighter
    let wobble = 0;
    const pts = P.map((pt, i) => {
      wobble = wobble * 0.92 + rng.normal() * 0.05;
      const k = (u + wobble) * hw[i];
      return { x: pt.x + normals[i].x * k, y: pt.y + normals[i].y * k };
    });
    // runs of the fiber grouped by how dark they are, one path per level
    const byLevel = {};
    for (let a = 0; a < n - 1; a += segPts) {
      const b = Math.min(n - 1, a + segPts);
      let avg = 0;
      for (let i = a; i <= b; i++) avg += pr[i];
      avg /= b - a + 1;
      const lvl = clamp(Math.round(avg * gain * LEVELS), 0, LEVELS);
      if (!lvl) continue;
      let d = `M${f1(pts[a].x)} ${f1(pts[a].y)}`;
      for (let i = a + 1; i <= b; i++) d += `L${f1(pts[i].x)} ${f1(pts[i].y)}`;
      (byLevel[lvl] = byLevel[lvl] || []).push(d);
    }
    for (const lvl of Object.keys(byLevel))
      out.push(
        `<path d="${byLevel[lvl].join('')}" fill="none" stroke="#000" stroke-width="${fmt(penPx * 0.5)}" stroke-linejoin="round" opacity="${fmt((0.5 * lvl) / LEVELS)}"/>`,
      );
  }
  return out;
}
