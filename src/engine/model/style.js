// The writer's style, learned against the base font: letter heights (zones),
// slant, widths, sizes and spacing.
import { resample } from '../geometry.js';
import { refreshGlyph } from './samples.js';
import { baseGlyph } from './skeleton.js';
import { clamp, median, robustStats } from '../util.js';

const XHEIGHT_CHARS = 'acemnorsuvwxz';
const ASC_CHARS = 'bdhkl';
const DESC_CHARS = 'gjpqy';
const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT_CHARS = '0123456789';

export const classify = (ch) => (UPPER_CHARS.includes(ch) ? 'upper' : DIGIT_CHARS.includes(ch) ? 'digit' : 'lower');

// ------------------------------------------------------ style learning
// Shrink an estimate from n observations toward a prior (Bayesian-ish
// finetuning: little data -> stay close to the base font).
const shrink = (med, n, prior, k = 1) => (n ? (n * med + k * prior) / (n + k) : prior);

function groupMedian(byChar, chars, f) {
  const vals = Array.from(chars)
    .filter((c) => byChar[c])
    .map((c) => median(byChar[c].map(f)));

  return { med: median(vals), n: vals.length };
}

export function learnZones(byChar) {
  const top = (g) => -g.minY;
  const bot = (g) => g.maxY;
  let r = groupMedian(byChar, XHEIGHT_CHARS, top);
  const X = shrink(r.med, r.n, 0.5);
  r = groupMedian(byChar, ASC_CHARS, top);
  const A = Math.max(X * 1.3, shrink(r.med, r.n, 1));
  r = groupMedian(byChar, DESC_CHARS, bot);
  const D = Math.max(0.15, shrink(r.med, r.n, 0.45 * (X / 0.5)));
  r = groupMedian(byChar, UPPER_CHARS, top);
  const C = shrink(r.med, r.n, 0.9 * A);
  r = groupMedian(byChar, DIGIT_CHARS, top);
  const N = shrink(r.med, r.n, C);

  return { X, A, D, C, N };
}

export function learnShear(byChar) {
  let sx = 0;
  let sw = 0;
  for (const ch of Object.keys(byChar))
    for (const g of byChar[ch])
      g.strokes.forEach((s, i) => {
        const r = resample(s, Math.max(2, Math.ceil(g.lens[i] / 0.03)));

        for (let k = 1; k < r.length; k++) {
          const dx = r[k].x - r[k - 1].x;
          const dy = r[k].y - r[k - 1].y;

          if (Math.abs(dy) > 2 * Math.abs(dx) && Math.abs(dy) > 1e-5) {
            const l = Math.hypot(dx, dy);
            sx += (-dx / dy) * l;
            sw += l;
          }
        }
      });

  return sw > 0 ? sx / sw : 0;
}

// vertical mapping base-font y -> user y, and horizontal scale, for a character
function zoneMap(style, ch) {
  const z = style.zones;
  const cls = classify(ch);

  if (cls !== 'lower') {
    const H = cls === 'upper' ? z.C : z.N;

    return { fy: (y) => y * H, vs: H, cls };
  }

  return {
    fy: (y) => (y >= 0 ? y * (z.D / 0.45) : y >= -0.5 ? y * (z.X / 0.5) : -z.X + (y + 0.5) * ((z.A - z.X) / 0.5)),
    vs: z.X / 0.5,
    cls,
  };
}

// Full base -> user-space transform for character ch (zones, width, slant).
export function skeletonTransform(style, ch) {
  const { fy, vs, cls } = zoneMap(style, ch);
  const ax = vs * ((style.aspect && style.aspect[cls]) || 1);
  const sh = style.shear || 0;

  return (x, y) => {
    const Y = fy(y);

    return { x: x * ax - sh * Y, y: Y };
  };
}

export function learnAspect(byChar, style) {
  const ratios = { lower: [], upper: [], digit: [] };

  for (const ch of Object.keys(byChar)) {
    const b = baseGlyph(ch);
    if (!b || b.width < 0.15) continue;

    const { vs, cls } = zoneMap(style, ch);

    const uw = median(
      byChar[ch].map((g) => {
        let mn = Infinity;
        let mx = -Infinity;

        for (const s of g.strokes)
          for (const p of s) {
            const x = p.x + style.shear * p.y;
            mn = Math.min(mn, x);
            mx = Math.max(mx, x);
          }

        return mx - mn;
      }),
    );

    ratios[cls].push(uw / (b.width * vs));
  }

  const lower = clamp(shrink(median(ratios.lower), ratios.lower.length, 1, 2), 0.5, 2);

  return {
    lower,
    // capitals & digits only partly inherit lowercase width habits
    upper: clamp(shrink(median(ratios.upper), ratios.upper.length, 1 + (lower - 1) * 0.5, 2), 0.5, 2),
    digit: clamp(shrink(median(ratios.digit), ratios.digit.length, 1 + (lower - 1) * 0.5, 2), 0.5, 2),
  };
}

// Pull every sample toward a per-character target size & position. The target
// blends the writer's own median for that character with what the learned
// zones predict from the base font, so one oversized `a` (or a whole set of
// them) gets brought in line with the rest of the alphabet.
export function normalizeSizes(byChar, style, s) {
  for (const ch of Object.keys(byChar)) {
    const glyphs = byChar[ch];
    const medTop = median(glyphs.map((g) => g.minY));
    const medBot = median(glyphs.map((g) => g.maxY));
    const cs = Array.from(ch);
    const bs = cs.map(baseGlyph);
    const b = cs.length === 1 ? bs[0] : null;
    let eTop = medTop;
    let eBot = medBot;
    let sits;
    if (bs.every(Boolean)) {
      // multi-letter units: span from the tallest to the deepest letter
      eTop = Math.min(...cs.map((c, i) => zoneMap(style, c).fy(bs[i].minY)));
      eBot = Math.max(...cs.map((c, i) => zoneMap(style, c).fy(bs[i].maxY)));
      sits = bs.every((x) => Math.abs(x.maxY) < 0.06);
    } else sits = Math.abs(medBot) < 0.1;
    const tTop = medTop + (eTop - medTop) * s;
    const tBot = medBot + (eBot - medBot) * s;

    for (const g of glyphs) {
      const h = g.maxY - g.minY;
      const newTop = g.minY + (tTop - g.minY) * s;
      const newBot = sits ? g.maxY + (0 - g.maxY) * s : g.maxY + (tBot - g.maxY) * s;

      if (h < 0.06 || (b && b.maxY - b.minY < 0.06)) {
        // small marks: fix position only
        const dy = (newTop + newBot) / 2 - (g.minY + g.maxY) / 2;
        for (const st of g.strokes) for (const p of st) p.y += dy;
      } else {
        const sy = clamp((newBot - newTop) / h, 0.55, 1.8);
        const top0 = g.minY;
        const anchorTop = sits ? newBot - h * sy : newTop;

        for (const st of g.strokes)
          for (const p of st) {
            p.y = anchorTop + (p.y - top0) * sy;
            p.x *= sy;
          }
      }

      refreshGlyph(g);
    }
  }
}

export function learnSpacing(byChar, sentences, style) {
  const widths = [];
  for (const ch of XHEIGHT_CHARS) if (byChar[ch]) widths.push(median(byChar[ch].map((g) => g.width)));
  let lg = [];
  let wg = [];

  sentences.forEach((s) => {
    (s.letterGaps || []).forEach((v) => lg.push(v));
    (s.wordGaps || []).forEach((v) => wg.push(v));
  });

  // drop implausible measurements (usually a slightly-off segmentation that still
  // had the right letter count): huge letter gaps, and word gaps that are no
  // bigger than an ordinary letter gap
  lg = lg.filter((v) => v < 0.3);
  const lgMed = lg.length ? median(lg) : 0.1;
  wg = wg.filter((v) => v > lgMed + 0.08);
  // priors scale with the writer's x-height; few measurements -> stay near the prior
  const zx = style.zones.X / 0.5;
  const lgs = lg.length ? robustStats(lg) : null;
  const wgs = wg.length ? robustStats(wg) : null;
  const lgMean = shrink(lgs ? lgs.mean : 0, lgs ? lgs.n : 0, 0.1 * zx, 4);
  const wgMean = shrink(wgs ? wgs.mean : 0, wgs ? wgs.n : 0, 0.42 * zx, 3);

  return {
    meanWidth: widths.length ? median(widths) : 0.42,
    letterGap: {
      mean: lgMean,
      std: lgs && lgs.n > 2 ? clamp(lgs.std, 0.01, 0.05) : 0.03,
      learned: !!lgs,
      n: lgs ? lgs.n : 0,
    },
    wordGap: {
      mean: Math.max(lgMean + 0.12, wgMean),
      std: wgs && wgs.n > 2 ? clamp(wgs.std, 0.02, 0.06) : 0.05,
      learned: !!wgs,
      n: wgs ? wgs.n : 0,
    },
  };
}
