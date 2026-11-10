import { fmt } from './paths.js';

// A highlighter stroke, built up the way the ink goes down:
//  - the chisel tip is held at an angle, so both ends are slanted the same way
//  - where the tip lands it rests for a moment and the ink pools: the start is
//    the darkest part, and bulges a little past the edges
//  - a lighter pool where it slows and lifts at the end
//  - along the stroke, ink gathers at the two edges and the felt leaves faint
//    streaks; the whole stroke drifts slightly off level
export function highlightPath(x0, x1, y0, y1, color, rng) {
  const h = y1 - y0;
  const len = Math.max(h, x1 - x0);
  const slant = 0.18 * h;
  const tilt = rng.normal() * 0.05 * h;
  const dy = (x) => tilt * ((x - x0) / len - 0.5);
  const out = [];
  // polygon from points [x, y] (drift applied), drawn at opacity op
  const poly = (pts, op) => {
    out.push(
      `<path d="M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y + dy(x))}`).join('L')}Z" fill="${color}" opacity="${op}"/>`,
    );
  };
  // the band between heights a..b (fractions of h), with gently wobbling edges
  const band = (a, b, op, inset = 0) => {
    const n = Math.max(2, Math.round(len / (h * 0.8)));
    const top = [];
    const bot = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + inset + (len - 2 * inset) * t;
      top.push([x + slant * (1 - a), y0 + a * h + rng.normal() * 0.025 * h]);
      bot.push([x + slant * (1 - b), y0 + b * h + rng.normal() * 0.025 * h]);
    }
    poly(top.concat(bot.reverse()), op);
  };
  // a pool at one end: a parallelogram of width w following the chisel slant
  const pool = (atStart, w, op, bulge) => {
    const xt = atStart ? x0 + slant : x1 + slant - w;
    const xb = atStart ? x0 : x1 - w;
    poly(
      [
        [xt, y0 - bulge],
        [xt + w, y0 - bulge],
        [xb + w, y1 + bulge],
        [xb, y1 + bulge],
      ],
      op,
    );
  };
  band(0, 1, 0.34); // the stroke
  band(0, 0.09, 0.07); // ink at the top edge
  band(0.91, 1, 0.07); // and the bottom edge
  const s1 = rng.range(0.28, 0.42);
  const s2 = rng.range(0.58, 0.72); // felt streaks
  band(s1, s1 + 0.06, 0.06, 0.3 * h);
  band(s2, s2 + 0.05, 0.05, 0.4 * h);
  // landing: darkest at the very start, fading over about half a stroke-height
  pool(true, 0.62 * h, 0.13, 0.03 * h);
  pool(true, 0.36 * h, 0.15, 0.05 * h);
  pool(true, 0.17 * h, 0.18, 0.06 * h);
  // lifting off: a lighter, narrower pool
  pool(false, 0.32 * h, 0.08, 0.015 * h);
  pool(false, 0.13 * h, 0.08, 0.02 * h);
  return out.join('');
}
