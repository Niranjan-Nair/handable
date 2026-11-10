// Training samples prepared for the model, and clustered into variants.
import { bbox, dist, polyLength, resample, resampleByIndex, smoothSeries } from '../geometry.js';
import { clamp, median, std } from '../util.js';

// Raw sample: { id, char, ctx, strokes: [[[x, y, tMs, pressure|null], ...], ...] }
export function prepareSample(sample) {
  const raw = (sample.strokes || []).filter((s) => s && s.length);
  if (!raw.length) return null;

  const pressures = [];

  raw.forEach((s) =>
    s.forEach((p) => {
      if (p[3] != null) pressures.push(p[3]);
    }),
  );

  const usePressure = pressures.length > 4 && std(pressures) > 0.03;

  const strokes = raw.map((s) => {
    const pts = [];

    for (const p of s) {
      const q = { x: +p[0], y: +p[1], t: p[2] == null ? null : +p[2], p: p[3] == null ? null : +p[3] };
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - q.x) < 1e-6 && Math.abs(last.y - q.y) < 1e-6) continue;

      pts.push(q);
    }

    return pts;
  });

  // pen speed -> ink width (fast strokes are thinner), unless a stylus gave us pressure
  const speeds = [];

  strokes.forEach((pts) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dt = a.t != null && b.t != null ? b.t - a.t : 0;
      pts[i].v = dt > 0 ? dist(a, b) / dt : null;
      if (pts[i].v != null) speeds.push(pts[i].v);
    }
  });

  const med = median(speeds);

  strokes.forEach((pts) => {
    for (const pt of pts) {
      if (usePressure && pt.p != null) pt.w = 0.5 + pt.p;
      else if (med > 0 && pt.v != null) pt.w = clamp(1.3 - (0.3 * pt.v) / med, 0.7, 1.3);
      else pt.w = 1;
    }

    smoothSeries(pts, 'w', 3);
    smoothSeries(pts, 'x', 1);
    smoothSeries(pts, 'y', 1);
  });

  const bb = bbox(strokes);
  const out = strokes.map((pts) => pts.map((p) => ({ x: p.x - bb.minX, y: p.y, w: p.w })));

  const g = {
    id: sample.id,
    char: sample.char,
    ctx: sample.ctx || 'solo',
    strokes: out,
    width: bb.maxX - bb.minX,
    minY: bb.minY,
    maxY: bb.maxY,
    nStrokes: out.length,
    lens: out.map(polyLength),
  };

  g.sig = signature(g);

  return g;
}

// Shape signature: whole glyph resampled to N points, centered & size-normalized.
export function signature(g, N = 48) {
  const total = g.lens.reduce((a, b) => a + b, 0) || 1;
  let pts = [];

  g.strokes.forEach((s, i) => {
    const n = Math.max(2, Math.round((N * g.lens[i]) / total));
    pts = pts.concat(resample(s, n));
  });

  pts = resampleByIndex(pts, N);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sc = Math.max(maxX - minX, maxY - minY, 0.2);

  return pts.map((p) => ({ x: (p.x - cx) / sc, y: (p.y - cy) / sc }));
}

function glyphDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.sig.length; i++) d += dist(a.sig[i], b.sig[i]);
  d /= a.sig.length;

  return d + Math.min(0.3, 0.12 * Math.abs(a.nStrokes - b.nStrokes));
}

// Average-linkage agglomerative clustering.
export function clusterGlyphs(glyphs, threshold) {
  const n = glyphs.length;
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D[i][j] = D[j][i] = glyphDistance(glyphs[i], glyphs[j]);
  const clusters = glyphs.map((_, i) => [i]);

  while (clusters.length > 1) {
    let best = Infinity;
    let bi = -1;
    let bj = -1;

    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        let s = 0;
        for (const a of clusters[i]) for (const b of clusters[j]) s += D[a][b];
        s /= clusters[i].length * clusters[j].length;

        if (s < best) {
          best = s;
          bi = i;
          bj = j;
        }
      }

    if (best >= threshold) break;

    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }

  return clusters.map((idx) => {
    // medoid & spread (how consistent the writer is for this variant)
    let medoid = idx[0];
    let bestSum = Infinity;

    for (const i of idx) {
      const s = idx.reduce((acc, j) => acc + D[i][j], 0);

      if (s < bestSum) {
        bestSum = s;
        medoid = i;
      }
    }

    const spread = idx.length > 1 ? bestSum / (idx.length - 1) : null;

    return { members: idx.map((i) => glyphs[i]), medoid: glyphs[medoid], spread };
  });
}
export function refreshGlyph(g) {
  const bb = bbox(g.strokes);
  for (const s of g.strokes) for (const p of s) p.x -= bb.minX;
  g.width = bb.maxX - bb.minX;
  g.minY = bb.minY;
  g.maxY = bb.maxY;
  g.lens = g.strokes.map(polyLength);
  g.sig = signature(g);
}
