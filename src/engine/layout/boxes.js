// Layout is TeX-like: everything becomes a box { w, top, bot, items, deco, cmap } in
// units relative to its baseline. Items are glyphs { g, x, y, s } (s = scale); cmap
// records where each source character ended up (for a caret).
import { styleGlyph } from '../glyph/fonts.js';
import { finishGlyph, finishStrokes, synthGlyph } from '../glyph/synth.js';
import { STEP } from '../options.js';
import { clamp } from '../util.js';

export const emptyBox = () => ({ w: 0, top: 0, bot: 0, items: [], deco: [], cmap: [] });

// put box src into dst at (dx, dy)
export function addBox(dst, src, dx, dy) {
  for (const it of src.items) dst.items.push({ g: it.g, x: it.x + dx, y: it.y + dy, s: it.s });
  if (src.cmap) for (const c of src.cmap) dst.cmap.push({ ...c, a: c.a + dx, b: c.b + dx, dy: c.dy + dy });
  dst.top = Math.min(dst.top, src.top + dy);
  dst.bot = Math.max(dst.bot, src.bot + dy);
}

// one character at scale s: { b (its box), g (the glyph, or null if it can't be written) }
export function charBox(writer, ch, s, ctx = 'solo', extra = {}) {
  const { model, o, rng, r, X, style } = writer;
  const b = emptyBox();
  let g = synthGlyph(model, ch, ctx, rng, o, extra);
  if (g && extra.font) g = styleGlyph(g, extra.font, rng, r);
  if (!g) {
    writer.note('missing', ch);
    b.w = style.meanWidth * 0.9 * s;
    b.top = -X * s;
    return { b, g: null };
  }
  if (g.inferred) writer.note('inferred', ch);
  // narrow glyphs (l, i, !, ') get a minimum advance so pairs like "ll" stay apart
  const bodyW = g.bodyMaxX - g.bodyMinX;
  const pad = Math.max(0, (0.11 * (X / 0.5) - bodyW) / 2) * s;
  b.items.push({ g, x: pad - g.bodyMinX * s, y: 0, s });
  b.w = bodyW * s + 2 * pad;
  b.top = g.minY * s;
  b.bot = g.maxY * s;
  return { b, g };
}

// A hand-drawn stroke through polyline pts ([x, y] in units): fraction bars,
// underlines, radicals …
export function handStroke(writer, pts, roughness = 0.35) {
  const dense = [];
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / STEP) + 1);
    for (let q = k > 1 ? 1 : 0; q < n; q++)
      dense.push({ x: x0 + ((x1 - x0) * q) / (n - 1), y: y0 + ((y1 - y0) * q) / (n - 1), w: 1 });
  }
  const opts = { ...writer.o, randomness: writer.r * roughness, shearDelta: 0 };
  const g = finishGlyph('—', finishStrokes([dense], writer.rng, opts, 0.6));
  // keep the stroke where it was drawn (finishGlyph left-aligns)
  const minX = Math.min(...pts.map((p) => p[0]));
  for (const s of g.strokes) for (const p of s) p.x += minX;
  g.width += Math.max(0, minX);
  return g;
}

// a slightly bowed, slightly tilted straight line of length len
export function ruleStroke(writer, len) {
  const { rng, r } = writer;
  const bow = rng.normal() * 0.012 * r * Math.min(len, 2);
  const tilt = rng.normal() * 0.01 * r * len;
  const n = 6;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    pts.push([t * len, bow * Math.sin(Math.PI * t) + tilt * (t - 0.5)]);
  }
  return handStroke(writer, pts);
}

// A strike or a box over the region A..B (x), T..Bt (y), mid = x-height middle,
// k = scale of the text it's drawn on. Uses your trained marks when there are
// any; otherwise a plain hand-drawn line or box.
export function markGlyph(writer, kind, A, B, T, Bt, mid, k) {
  const pool = writer.model.marks && writer.model.marks[kind];
  if (pool && pool.length) return trainedMark(writer, pool, kind, A, B, T, Bt, mid, k);
  return kind === 'strike' ? drawnStrike(writer, A, B, mid, k) : drawnBox(writer, A, B, T, Bt, k);
}

function trainedMark(writer, pool, kind, A, B, T, Bt, mid, k) {
  const { rng, r, o } = writer;
  const smp = rng.pick(pool);
  // Drawn around more than the word it was trained on, a mark's corners, overshoot
  // and padding grow too, but much less than the mark does (as a hand draws a
  // bigger box), like the matrix brackets.
  const gx = clamp(Math.pow((B - A) / Math.max(1e-3, smp.refW * k), 0.45), 1, 2.2);
  const gy = kind === 'box' ? clamp(Math.pow((Bt - T) / Math.max(1e-3, smp.refH * k), 0.45), 1, 2.2) : 1;
  // how far past the text a mark may reach (an odd sample shouldn't run into the next word)
  const lim = (v, m) => clamp(v, -m, m);
  const toText = (p) => ({
    x:
      p.kx < 0
        ? A + lim(p.vx * k * gx, 0.45 * k * gx)
        : p.kx > 0
          ? B + lim(p.vx * k * gx, 0.45 * k * gx)
          : A + p.vx * (B - A),
    y:
      p.ky === 2
        ? mid + lim(p.vy * k, 0.6 * k)
        : p.ky < 0
          ? T + lim(p.vy * k * gy, 0.4 * k * gy)
          : p.ky > 0
            ? Bt + lim(p.vy * k * gy, 0.4 * k * gy)
            : T + p.vy * (Bt - T),
    w: 1,
  });
  const strokes = finishStrokes(
    smp.strokes.map((st) => st.map(toText)),
    rng,
    { ...o, randomness: r * 0.4, shearDelta: 0 },
    0.6,
  );
  const g = { char: '—', strokes, minY: Infinity, maxY: -Infinity };
  let maxX = 0;
  for (const st of strokes) {
    for (const q of st) {
      maxX = Math.max(maxX, q.x);
      g.minY = Math.min(g.minY, q.y);
      g.maxY = Math.max(g.maxY, q.y);
    }
  }
  g.width = maxX;
  return g;
}

function drawnStrike(writer, A, B, mid, k) {
  const { rng } = writer;
  const tilt = rng.normal() * 0.03 * k;
  const bow = rng.normal() * 0.02 * k;
  return handStroke(
    writer,
    [
      [A - 0.05 * k, mid + tilt],
      [(A + B) / 2, mid + bow],
      [B + 0.05 * k, mid - tilt],
    ],
    0.4,
  );
}

function drawnBox(writer, A, B, T, Bt, k) {
  const { rng } = writer;
  // corners, overshoot and wobble grow with the box, more slowly than it does
  const g = clamp(Math.pow((B - A + Bt - T) / (2.2 * k), 0.45), 1, 2.4);
  const px = 0.17 * k * Math.sqrt(g);
  const py = 0.13 * k * Math.sqrt(g);
  const j = () => rng.normal() * 0.025 * k * g;
  const x0 = A - px;
  const x1 = B + px;
  const y0 = T - py;
  const y1 = Bt + py;
  // the sides bow a little between the corners, the end runs past the start
  const bow = (a, b) => [(a[0] + b[0]) / 2 + j(), (a[1] + b[1]) / 2 + j()];
  const c = [
    [x0 + 0.06 * k * g, y0 + j()],
    [x1 + j(), y0 + j()],
    [x1 + j(), y1 + j()],
    [x0 + j(), y1 + j()],
    [x0 + j(), y0 + j()],
  ];
  const pts = [
    c[0],
    bow(c[0], c[1]),
    c[1],
    bow(c[1], c[2]),
    c[2],
    bow(c[2], c[3]),
    c[3],
    bow(c[3], c[4]),
    c[4],
    [x0 + 0.16 * k * g, y0 - 0.03 * k * g + j()],
  ];
  return handStroke(writer, pts, 0.45);
}
