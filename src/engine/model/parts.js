// Inferring untrained characters. Each trained letter is aligned to its skeleton
// in the base font, which cuts it into parts (bowls, stems, arches …). An untrained
// character is then built from the writer's parts that match its own skeleton's.
import { bbox, centroid, dist, polyLength, resample } from '../geometry.js';
import { baseGlyph } from './skeleton.js';
import { classify, skeletonTransform } from './style.js';
import { clamp } from '../util.js';

function dtw(A, B) {
  const n = A.length;
  const m = B.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  D[0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const c = dist(A[i - 1], B[j - 1]);
      D[i * W + j] = c + Math.min(D[(i - 1) * W + j], D[i * W + j - 1], D[(i - 1) * W + j - 1]);
    }
  const sum = new Float64Array(n);
  const cnt = new Float64Array(n);
  let i = n;
  let j = m;
  let steps = 0;
  while (i > 0 && j > 0) {
    sum[i - 1] += j - 1;
    cnt[i - 1]++;
    steps++;
    const a = D[(i - 1) * W + j - 1];
    const b = D[(i - 1) * W + j];
    const c = D[i * W + j - 1];
    if (a <= b && a <= c) {
      i--;
      j--;
    } else if (b <= c) i--;
    else j--;
  }
  return { cost: D[n * W + m] / steps, map: Array.from(sum, (s, k) => (cnt[k] ? s / cnt[k] : 0)) };
}

function permutations(n) {
  if (n <= 1) return [[0]];
  const out = [];
  const rec = (arr, rest) => {
    if (!rest.length) {
      out.push(arr);
      return;
    }
    rest.forEach((r, i) => rec(arr.concat(r), rest.slice(0, i).concat(rest.slice(i + 1))));
  };
  rec(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  return out;
}

// Resample a base stroke (with knots) to ~uniform spacing, keeping knot indices.
function resampleKnotted(pts, knots, step) {
  const out = [];
  const ks = [0];
  for (let j = 0; j < knots.length - 1; j++) {
    const seg = pts.slice(knots[j], knots[j + 1] + 1);
    const n = Math.max(2, Math.round(polyLength(seg) / step) + 1);
    const r = seg.length > 1 ? resample(seg, n) : [{ ...seg[0] }];
    for (let k = out.length ? 1 : 0; k < r.length; k++) out.push(r[k]);
    ks.push(out.length - 1);
  }
  return { pts: out, knots: ks };
}

// Align a user glyph to the (style-mapped) base glyph of the same character.
// Returns, per base stroke, per segment, the matching slice of the user's stroke.
function correspond(g, base, T) {
  if (g.nStrokes !== base.strokes.length) return null;
  const mapped = base.strokes.map((s) => ({ pts: s.pts.map((p) => T(p.x, p.y)), knots: s.knots }));
  const bb = bbox(mapped.map((s) => s.pts));
  mapped.forEach((s) =>
    s.pts.forEach((p) => {
      p.x -= bb.minX;
    }),
  );
  const B = mapped.map((s) => resampleKnotted(s.pts, s.knots, 0.025));
  const U = g.strokes.map((s, i) => resample(s, clamp(Math.round(g.lens[i] / 0.02) + 2, 2, 160)));
  const n = B.length;
  let best = null;
  for (const perm of n <= 3 ? permutations(n) : [Array.from({ length: n }, (_, i) => i)]) {
    let tot = 0;
    const res = [];
    for (let i = 0; i < n; i++) {
      const u = U[perm[i]];
      const ur = u.slice().reverse();
      const f = dtw(B[i].pts, u);
      const r = dtw(B[i].pts, ur);
      const pick = f.cost <= r.cost ? { d: f, u } : { d: r, u: ur };
      tot += pick.d.cost;
      res.push(pick);
    }
    if (!best || tot / n < best.cost) best = { cost: tot / n, res };
  }
  const size = Math.max(0.3, bb.maxY - bb.minY);
  if (!best || best.cost > 0.14 * size) return null;
  return best.res.map((r, i) => {
    const ks = B[i].knots;
    return ks.slice(0, -1).map((k, j) => {
      let a = Math.round(r.d.map[k]);
      let b = Math.round(r.d.map[ks[j + 1]]);
      if (b < a) [a, b] = [b, a];
      return r.u.slice(a, b + 1).map((p) => ({ ...p }));
    });
  });
}

// normalized shape (centroid at 0, max dimension 1) for comparing segments
function shapeInfo(pts) {
  const r = pts.length > 1 ? resample(pts, 24) : [pts[0]];
  const bb = bbox([r]);
  const size = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 0.04);
  const c = centroid(r);
  return {
    sig: r.map((p) => ({ x: (p.x - c.x) / size, y: (p.y - c.y) / size })),
    size,
    c,
    dot: pts.length === 1,
    bend: r.length > 1 ? bendOf(r, size) : 0,
  };
}

// stroke shape normalized independently in x and y (so a `v` can become a `V`);
// near-straight strokes fall back to uniform scaling.
function bendOf(r, size) {
  const a = r[0];
  const b = r[r.length - 1];
  const L = dist(a, b);
  if (L < 0.3 * size) return 1; // closed or hooked
  let m = 0;
  for (const p of r) m = Math.max(m, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
  return m / size;
}

function strokeShape(pts) {
  const r = resample(pts, 32);
  const bb = bbox([r]);
  let w = bb.maxX - bb.minX;
  let h = bb.maxY - bb.minY;
  const mx = Math.max(w, h, 0.04);
  const uniform = Math.min(w, h) < 0.15 * mx;
  if (uniform) w = h = mx;
  const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  return { sig: r.map((p) => ({ x: (p.x - c.x) / w, y: (p.y - c.y) / h })), w, h, c, uniform, bend: bendOf(r, mx) };
}

// Library of the writer's segments (bowls, stems, arches...), keyed to the
// base-font segment each one corresponds to.
export function buildParts(model) {
  const parts = {};
  for (const ch of Object.keys(model.chars)) {
    const b = baseGlyph(ch);
    if (!b) continue;
    const T = skeletonTransform(model.style, ch);
    const mapped = b.strokes.map((s) => s.pts.map((p) => T(p.x, p.y)));
    const off = bbox(mapped).minX;
    for (const v of model.chars[ch].variants)
      for (const g of v.members) {
        const corr = correspond(g, b, T);
        if (!corr) continue;
        corr.forEach((segs, i) => {
          const bs = b.strokes[i];
          if (bs.pts.length > 1) {
            const key = `${ch}|${i}|*`;
            if (!parts[key]) {
              const sT = bs.pts.map((p) => {
                const q = T(p.x, p.y);
                q.x -= off;
                return q;
              });
              const info = strokeShape(bs.pts);
              const infoT = strokeShape(sT);
              parts[key] = {
                whole: true,
                ch,
                cls: classify(ch),
                sig: info.sig,
                bend: info.bend,
                uniform: info.uniform,
                w: info.w,
                h: info.h,
                cT: infoT.c,
                wT: infoT.w,
                hT: infoT.h,
                user: [],
              };
            }
            let full = [];
            segs.forEach((u) => {
              full = full.concat(full.length ? u.slice(1) : u);
            });
            if (full.length > 1 && fits(full, parts[key], true)) parts[key].user.push(full);
          }
          segs.forEach((u, j) => {
            const baseSeg = b.strokes[i].segs[j];
            if (baseSeg.length > 1 && u.length < 2) return;
            const key = `${ch}|${i}|${j}`;
            if (!parts[key]) {
              const segT = baseSeg.map((p) => {
                const q = T(p.x, p.y);
                q.x -= off;
                return q;
              });
              const info = shapeInfo(baseSeg);
              const infoT = shapeInfo(segT);
              parts[key] = {
                ch,
                cls: classify(ch),
                sig: info.sig,
                bend: info.bend,
                size: info.size,
                dot: info.dot,
                cT: infoT.c,
                sizeT: infoT.size,
                user: [],
              };
            }
            if (fits(u, parts[key], false)) parts[key].user.push(u);
          });
        });
      }
  }
  return Object.values(parts);
}

// Does the writer's slice actually look like the base piece it was aligned to?
// (guards against DTW mis-cuts and letterforms that differ from the skeleton)
function fits(u, part, whole) {
  if (part.dot) return true;
  if (whole) {
    const si = strokeShape(u);
    if (si.uniform !== part.uniform) return false;
    const kx = si.w / part.wT;
    const ky = si.h / part.hT;
    return shapeDist(si.sig, part.sig).d < 0.14 && kx > 0.6 && kx < 1.6 && ky > 0.6 && ky < 1.6;
  }
  if (u.length < 2) return false;
  const si = shapeInfo(u);
  const k = si.size / part.sizeT;
  return shapeDist(si.sig, part.sig).d < 0.12 && k > 0.6 && k < 1.6;
}

function shapeDist(a, b) {
  if (a.length !== b.length) return { d: a.length === 1 && b.length === 1 ? 0 : Infinity, rev: false };
  let f = 0;
  let r = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    f += dist(a[i], b[i]);
    r += dist(a[i], b[n - 1 - i]);
  }
  return f <= r ? { d: f / n, rev: false } : { d: r / n, rev: true };
}

// Plan for an untrained character: each base segment is either borrowed from
// the writer's matching part (moved & scaled into place) or, failing that,
// taken from the style-mapped base skeleton.
export function inferPlan(model, ch) {
  if (ch in model.inferCache) return model.inferCache[ch];
  const b = baseGlyph(ch);
  if (!b) return (model.inferCache[ch] = null);
  const T = skeletonTransform(model.style, ch);
  const cls = classify(ch);
  const off = bbox(b.strokes.map((s) => s.pts.map((p) => T(p.x, p.y)))).minX;
  const sources = new Set();
  let matched = 0;
  let total = 0;
  const strokes = b.strokes.map((s) => {
    const whole = s.pts.length > 1 ? matchWholeStroke(model, s, T, off, cls) : null;
    if (whole) {
      total += s.segs.length;
      matched += s.segs.length;
      whole.cands.forEach((c) => sources.add(c.part.ch));
      return [whole];
    }
    return s.segs.map((seg) => {
      total++;
      const segT = seg.map((p) => {
        const q = T(p.x, p.y);
        q.x -= off;
        return { x: q.x, y: q.y, w: 1 };
      });
      const info = shapeInfo(seg);
      const infoT = shapeInfo(segT);
      const cands = [];
      for (const part of model.parts) {
        if (part.whole || part.dot !== info.dot) continue;
        if (!part.user.length || Math.abs(info.bend - part.bend) > 0.05) continue;
        const { d, rev } = shapeDist(info.sig, part.sig);
        if (d > 0.035) continue;
        const k = info.size / part.size;
        if (!info.dot && (k < 0.4 || k > 2.5)) continue;
        const cost =
          d + 0.05 * Math.abs(Math.log(k)) + (part.cls === cls ? 0 : 0.01) - 0.003 * Math.min(part.user.length, 5);
        cands.push({ cost, part, rev });
      }
      const best = topCandidates(cands);
      if (!best) return { segT };
      matched++;
      best.forEach((c) => sources.add(c.part.ch));
      return { segT, cands: best, cT: infoT.c, sizeT: infoT.size, dot: info.dot };
    });
  });
  return (model.inferCache[ch] = { char: ch, strokes, sources: Array.from(sources).sort(), matched, total });
}

// all candidates nearly as good as the best one (picked at random per glyph)
function topCandidates(cands) {
  if (!cands.length) return null;
  cands.sort((a, b) => a.cost - b.cost);
  return cands.filter((c) => c.cost <= cands[0].cost + 0.012).slice(0, 4);
}

function matchWholeStroke(model, s, T, off, cls) {
  const info = strokeShape(s.pts);
  const cands = [];
  for (const part of model.parts) {
    if (!part.whole || part.uniform !== info.uniform || !part.user.length || Math.abs(info.bend - part.bend) > 0.05)
      continue;
    const { d, rev } = shapeDist(info.sig, part.sig);
    if (d > 0.04) continue;
    const kx = info.w / part.w;
    const ky = info.h / part.h;
    if (kx < 0.35 || kx > 3 || ky < 0.35 || ky > 3 || kx / ky < 0.6 || kx / ky > 1.6) continue;
    const cost =
      d +
      0.02 * Math.abs(Math.log(kx / ky)) +
      0.01 * Math.abs(Math.log(kx)) +
      (part.cls === cls ? 0 : 0.01) -
      0.003 * Math.min(part.user.length, 5);
    cands.push({ cost, part, rev });
  }
  const best = topCandidates(cands);
  if (!best) return null;
  const sT = s.pts.map((p) => {
    const q = T(p.x, p.y);
    q.x -= off;
    return q;
  });
  const infoT = strokeShape(sT);
  return { whole: true, cands: best, cT: infoT.c, wT: infoT.w, hT: infoT.h, uniform: info.uniform };
}
