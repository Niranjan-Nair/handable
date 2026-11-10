// Writing one glyph: a new instance of a character, morphed between the writer's
// samples (or built from parts, for an untrained one) and given natural variation.
import { bbox, centroid, dist, meanPointDist, polyLength, resample } from '../geometry.js';
import { inferPlan } from '../model/parts.js';
import { DEFAULTS, STEP } from '../options.js';
import { clamp, makeRng } from '../util.js';

function synthInferred(model, plan, rng, o, extra = {}) {
  const picks = [];
  // size a borrowed piece halfway (geometrically) between the writer's own
  // proportion and what the skeleton calls for
  const gm = (target, own, ref) => target / Math.sqrt(Math.max(own, 0.03) * Math.max(ref, 0.03));

  const strokes = plan.strokes.map((segs) => {
    let out = [];

    for (const sp of segs) {
      let pts;
      let c = null;

      if (sp.cands) {
        const prevPick = extra.picks && extra.picks[picks.length];
        const idx = prevPick != null && prevPick < sp.cands.length ? prevPick : Math.floor(rng() * sp.cands.length);
        picks.push(idx);
        c = sp.cands[idx];
      }

      if (c) {
        let u = rng.pick(c.part.user);
        if (c.rev) u = u.slice().reverse();
        const bb = bbox([u]);
        const w = bb.maxX - bb.minX;
        const h = bb.maxY - bb.minY;
        let kx;
        let ky;
        let cx;
        let cy;

        if (sp.whole) {
          cx = (bb.minX + bb.maxX) / 2;
          cy = (bb.minY + bb.maxY) / 2;

          if (sp.uniform) kx = ky = gm(Math.max(sp.wT, sp.hT), Math.max(w, h), Math.max(c.part.wT, c.part.hT));
          else {
            kx = gm(sp.wT, w, c.part.wT);
            ky = gm(sp.hT, h, c.part.hT);
          }
        } else {
          const ct = centroid(u);
          cx = ct.x;
          cy = ct.y;
          kx = ky = sp.dot ? 1 : gm(sp.sizeT, Math.max(w, h), c.part.sizeT);
        }

        pts = u.map((p) => ({ x: sp.cT.x + kx * (p.x - cx), y: sp.cT.y + ky * (p.y - cy), w: p.w == null ? 1 : p.w }));
      } else pts = sp.segT.map((p) => ({ ...p }));

      if (out.length) {
        // join to the previous segment, fading the correction out along this one
        const e = out[out.length - 1];
        const ox = e.x - pts[0].x;
        const oy = e.y - pts[0].y;
        const fade = Math.max(1, Math.round(pts.length * 0.5));

        pts.forEach((p, i) => {
          const f = Math.max(0, 1 - i / fade);
          p.x += ox * f;
          p.y += oy * f;
        });

        pts = pts.slice(1);
      }

      out = out.concat(pts);
    }

    const len = polyLength(out);

    return out.length > 1 ? resample(out, clamp(Math.round(len / STEP) + 2, 2, 300)) : out;
  });

  return finishGlyph(plan.char, finishStrokes(strokes, rng, o, model.style.spreadFactor || 1), {
    inferred: true,
    picks,
  });
}

// ------------------------------------------- smoothness, pen & formality
// Gaussian smoothing along each stroke to iron out trackpad / mouse jitter.
// Strokes are split at sharp corners first so the points of v, k, z, M stay sharp.
function smoothStrokes(strokes, amount) {
  if (!(amount > 0)) return strokes;

  const sigma = 0.5 + amount * 4; // in resampled points (STEP apart): up to ~0.09 units
  const K = 4;

  return strokes.map((s) => {
    if (s.length < 2 * K + 2) return s;

    // corners: turns sharper than ~75°, one per cluster (the sharpest)
    const corners = [0];
    let run = null;

    for (let i = K; i < s.length - K; i++) {
      const ax = s[i].x - s[i - K].x;
      const ay = s[i].y - s[i - K].y;
      const bx = s[i + K].x - s[i].x;
      const by = s[i + K].y - s[i].y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      const cos = la > 1e-6 && lb > 1e-6 ? (ax * bx + ay * by) / (la * lb) : 1;

      if (cos < 0.25) {
        if (run && i - run.last <= 1) {
          run.last = i;

          if (cos < run.cos) {
            run.cos = cos;
            run.i = i;
          }
        } else {
          if (run) corners.push(run.i);
          run = { i, cos, last: i };
        }
      }
    }

    if (run) corners.push(run.i);
    corners.push(s.length - 1);
    const out = s.map((p) => ({ ...p }));

    for (let c = 0; c < corners.length - 1; c++) {
      const a = corners[c];
      const b = corners[c + 1];

      for (let i = a + 1; i < b; i++) {
        const sg = Math.min(sigma, (i - a) / 1.5, (b - i) / 1.5);
        if (sg < 0.3) continue;

        const R = Math.ceil(sg * 2.5);
        let sx = 0;
        let sy = 0;
        let sw = 0;

        for (let j = Math.max(a, i - R); j <= Math.min(b, i + R); j++) {
          const wt = Math.exp(-((j - i) * (j - i)) / (2 * sg * sg));
          sx += s[j].x * wt;
          sy += s[j].y * wt;
          sw += wt;
        }

        out[i].x = sx / sw;
        out[i].y = sy / sw;
      }
    }

    return out;
  });
}

// Pen consistency: how evenly the pen lays down ink. 0.5 keeps the width
// variation learned from pressure / speed; lower exaggerates it and adds
// stroke-to-stroke variation, higher evens everything out.
function applyPen(strokes, rng, c) {
  const k = 1.6 - 1.2 * c;
  const js = 0.12 * (1 - c);

  for (const s of strokes) {
    const f = clamp(1 + rng.normal() * js, 0.7, 1.35);
    for (const p of s) p.w = Math.max(0.3, (1 + ((p.w == null ? 1 : p.w) - 1) * k) * f);
  }
}

// Shared post-processing for every synthesized glyph.
export function finishStrokes(strokes, rng, o, spreadFactor) {
  const f = clamp(+o.formality || 0, 0, 1);
  const r = o.randomness * (1 - 0.4 * f); // formal writing is a little tidier
  const sm = clamp(+o.smoothness || 0, 0, 1);
  strokes = smoothStrokes(strokes, sm);
  if (r > 0 || o.shearDelta) deform(strokes, rng, r, spreadFactor, o.shearDelta || 0, { tremor: 1 - 0.85 * sm });
  applyPen(strokes, rng, clamp(o.penConsistency == null ? 0.6 : +o.penConsistency, 0, 1));

  return strokes;
}

// ----------------------------------------------------------- synthesis
function chooseVariant(entry, ctx, rng, prev, formality = 0) {
  const total = entry.variants.reduce((a, v) => a + v.weight, 0);

  // P(variant | position in word, previous letter), smoothed toward the
  // overall variant frequency
  const ws = entry.variants.map((v) => {
    let w = (v.ctx[ctx] || 0) + v.weight / total + (prev && v.prev ? 2 * (v.prev[prev] || 0) : 0);
    // formal / readable: lean toward the writer's main form and the more textbook-like
    // ones. A gentle preference (the floor keeps less textbook forms in the mix)
    if (formality > 0)
      w *=
        Math.pow(v.weight / total, formality) *
        Math.pow(0.25 + 0.75 * (v.recog == null ? 1 : v.recog), 1.5 * formality);

    return w;
  });

  return rng.weighted(entry.variants, ws);
}

// Align every stroke of `partner` to `base` (resampled to ns[i] points), fixing
// drawing direction. Returns null if the shapes don't correspond well enough to
// morph between (e.g. an `o` started at a different point).
function alignPartner(base, baseRs, partner, ns) {
  const out = [];

  for (let i = 0; i < base.strokes.length; i++) {
    const n = ns[i];
    const fwd = resample(partner.strokes[i], n);
    const bb = bbox([baseRs[i]]);
    const sz = Math.max(Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY), 0.12);
    const candidates = [fwd, fwd.slice().reverse()];
    // closed loops (o, 0, a's bowl...) may start anywhere: also try cyclic shifts
    const closed = n > 8 && dist(fwd[0], fwd[n - 1]) < 0.2 * sz && dist(baseRs[i][0], baseRs[i][n - 1]) < 0.2 * sz;

    if (closed) {
      const ring = fwd.slice(0, n - 1);

      for (let k = 1; k < 24; k++) {
        const sh = Math.round((k * (n - 1)) / 24);
        const rot = ring.slice(sh).concat(ring.slice(0, sh));
        rot.push({ ...rot[0] });
        candidates.push(rot, rot.slice().reverse());
      }
    }

    let best = null;
    let bd = Infinity;

    for (const c of candidates) {
      const d = meanPointDist(baseRs[i], c);

      if (d < bd) {
        bd = d;
        best = c;
      }
    }

    if (bd > 0.22 * sz) return null;

    out.push(best);
  }

  return out;
}

function deform(strokes, rng, r, spreadFactor, shearDelta, opt = {}) {
  const a = r * spreadFactor;
  const bb = bbox(strokes);
  const cx = (bb.minX + bb.maxX) / 2;
  const rot = rng.normal() * 0.03 * a;
  const shear = rng.normal() * 0.045 * a + shearDelta;
  const sx = 1 + rng.normal() * 0.04 * a;
  const sy = 1 + rng.normal() * 0.04 * a;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const waves = [];
  for (let k = 0; k < 3; k++)
    waves.push({
      fx: rng.range(-5, 5),
      fy: rng.range(-5, 5),
      ph: rng.range(0, 2 * Math.PI),
      ax: rng.normal() * 0.01 * a,
      ay: rng.normal() * 0.01 * a,
    });
  const wScale = clamp(1 + rng.normal() * 0.06 * r, 0.75, 1.3);
  const trem = 0.0012 * r * (opt.tremor == null ? 1 : opt.tremor);

  for (const s of strokes) {
    let tx = 0;
    let ty = 0;

    for (const p of s) {
      let x = p.x - cx;
      let y = p.y;
      x += -shear * y;
      x *= sx;
      y *= sy;
      const xr = x * cos - y * sin;
      const yr = x * sin + y * cos;
      let dx = 0;
      let dy = 0;

      for (const w of waves) {
        const ph = w.fx * p.x + w.fy * p.y + w.ph;
        dx += w.ax * Math.sin(ph);
        dy += w.ay * Math.cos(ph);
      }

      tx = tx * 0.9 + rng.normal() * trem;
      ty = ty * 0.9 + rng.normal() * trem;
      p.x = xr + cx + dx + tx;
      p.y = yr + dy + ty;
      p.w = (p.w == null ? 1 : p.w) * wScale;
    }
  }
}

// Greek letters written exactly like a Latin one (or a variant written like the
// main form): if you haven't trained the Greek one, your trained letter is used.
const LOOKALIKE = {
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Χ: 'X',
  ο: 'o',
  ϖ: 'π',
  ϱ: 'ρ',
  ϑ: 'θ',
  ϕ: 'φ',
  ϵ: 'ε',
  // curly quotes fall back to the straight ones you trained (an apostrophe is ’)
  '’': "'",
  '‘': "'",
  '”': '"',
  '“': '"',
};

// left-align a synthesized glyph and measure it. `body` = horizontal extent of
// ink above the baseline, used for spacing so descender tails (y, g, j) can tuck
// under their neighbours like real writing.
export function finishGlyph(char, strokes, extra) {
  const bb = bbox(strokes);
  let bMin = Infinity;
  let bMax = -Infinity;

  for (const s of strokes)
    for (const p of s) {
      p.x -= bb.minX;

      if (p.y <= 0.03) {
        bMin = Math.min(bMin, p.x);
        bMax = Math.max(bMax, p.x);
      }
    }

  const width = bb.maxX - bb.minX;

  if (bMin === Infinity || bMax - bMin < 0.35 * width) {
    bMin = 0;
    bMax = width;
  }

  return Object.assign(
    { char, strokes, width, bodyMinX: bMin, bodyMaxX: bMax, minY: bb.minY, maxY: bb.maxY },
    extra || {},
  );
}

// Synthesize one new instance of `ch`. Returns null if the character is unknown
// (not trained, and inference is off or there is no base skeleton for it).
export function synthGlyph(model, ch, ctx, rng, o, extra = {}) {
  if (!model.chars[ch] && LOOKALIKE[ch] && model.chars[LOOKALIKE[ch]]) ch = LOOKALIKE[ch];
  const entry = model.chars[ch] || (model.units && model.units[ch]);

  if (!entry) {
    const plan = o.infer !== false ? inferPlan(model, ch) : null;

    return plan ? synthInferred(model, plan, rng, o, extra) : null;
  }

  const f = clamp(+o.formality || 0, 0, 1);

  const v =
    extra.variant && entry.variants.includes(extra.variant)
      ? extra.variant
      : chooseVariant(entry, ctx, rng, extra.prev, f);

  // formal: prefer the samples closest to the variant's typical shape
  const base =
    f > 0
      ? rng.weighted(
          v.members,
          v.members.map((m) => Math.exp((-f * (m.dMed || 0)) / 0.03)),
        )
      : rng.pick(v.members);

  const r = o.randomness;

  const partners =
    o.blend && r > 0
      ? rng.shuffle(v.members.filter((m) => m !== base && m.nStrokes === base.nStrokes)).slice(0, 2)
      : [];

  const ns = base.lens.map((l) => clamp(Math.round(l / STEP) + 2, 2, 300));
  const baseRs = base.strokes.map((s, i) => resample(s, ns[i]));
  const aligned = [baseRs];

  for (const p of partners) {
    const a = alignPartner(base, baseRs, p, ns);
    if (a) aligned.push(a);
  }

  let strokes = baseRs;

  if (aligned.length > 1) {
    // random convex combination; the base dominates more at low randomness
    let ws = aligned.map((_, i) => (i === 0 ? 1 : rng() * Math.min(1, r)));
    const tot = ws.reduce((s2, w) => s2 + w, 0);
    ws = ws.map((w) => w / tot);

    strokes = baseRs.map((bs, i) =>
      bs.map((_, k) => {
        let x = 0;
        let y = 0;
        let w = 0;

        for (let j = 0; j < aligned.length; j++) {
          const q = aligned[j][i][k];
          x += q.x * ws[j];
          y += q.y * ws[j];
          w += q.w * ws[j];
        }

        return { x, y, w };
      }),
    );
  }

  strokes = finishStrokes(strokes, rng, o, v.spreadFactor);

  return finishGlyph(ch, strokes, { variant: v });
}

export function sampleGlyph(model, ch, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  o.shearDelta = 0;

  return synthGlyph(model, ch, opts && opts.ctx ? opts.ctx : 'solo', makeRng(o.seed), o);
}
