// Finishing a glyph's strokes, whatever they were built from: smoothing out the
// jitter of a mouse, the writer's natural variation, and the pen's ink.
import { bbox } from '../geometry.js';
import { clamp } from '../util.js';

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
