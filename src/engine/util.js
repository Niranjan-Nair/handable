// Small numeric helpers and a seeded random number generator.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
};
export const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// mean/std after discarding outliers (> 2.5 MAD from the median)
export function robustStats(a) {
  const med = median(a);
  const mad = median(a.map((v) => Math.abs(v - med))) || 1e-3;
  const kept = a.filter((v) => Math.abs(v - med) <= 2.5 * 1.4826 * mad);
  return { mean: mean(kept), std: std(kept), n: kept.length };
}

function hashSeed(s) {
  if (typeof s === 'number' && isFinite(s)) return s >>> 0;
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (seed == null ? Math.floor(Math.random() * 4294967296) : hashSeed(seed)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.normal = () => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  rng.range = (lo, hi) => lo + (hi - lo) * next();
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.weighted = (items, weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  rng.shuffle = (arr) => {
    const a2 = arr.slice();
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return rng;
}
