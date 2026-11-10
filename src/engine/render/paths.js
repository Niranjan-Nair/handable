// SVG path building blocks: numbers, splines, dots and the pen's inked outline.
import { dist, polyLength, resample } from '../geometry.js';

export const fmt = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString();

// Catmull-Rom spline through pts as cubic Bézier segments (assumes current point = pts[0]).
export function splineSegments(pts) {
    let d = '';

    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
    }

    return d;
}

export function dotPath(p, rad) {
    return `M${fmt(p.x - rad)} ${fmt(p.y)}a${fmt(rad)} ${fmt(rad)} 0 1 0 ${fmt(2 * rad)} 0a${fmt(rad)} ${fmt(rad)} 0 1 0 ${fmt(-2 * rad)} 0Z`;
}

// Variable-width filled outline for one stroke (points in px with width factor w).
export function inkPath(pts, penPx) {
    const len = polyLength(pts);
    // dots & periods: a pen pressed down briefly leaves a fuller mark than its width
    if (pts.length < 2 || len < penPx * 0.6) return dotPath(pts[0], penPx * 0.82 * (pts[0].w || 1));

    const short = len < penPx * 3.5;
    const boost = short ? 1 + 0.5 * (1 - len / (penPx * 3.5)) : 1;
    const n = Math.max(3, Math.ceil(len / 2.5));
    const P = resample(pts, n);
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
    const tIn = Math.max(1e-3, Math.min(len * 0.3, penPx * 3));
    const tOut = Math.max(1e-3, Math.min(len * 0.3, penPx * 4));
    const L = [];
    const R = [];
    const hw = [];
    let nx = 0;
    let ny = -1;

    for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(n - 1, i + 1)];
        const tx = b.x - a.x;
        const ty = b.y - a.y;
        const tl = Math.hypot(tx, ty);

        if (tl > 1e-9) {
            nx = -ty / tl;
            ny = tx / tl;
        }

        const taper = short
            ? 1
            : Math.min(1, 0.55 + (0.45 * cum[i]) / tIn) * Math.min(1, 0.45 + (0.55 * (len - cum[i])) / tOut);

        const h = (penPx / 2) * (P[i].w || 1) * taper * boost;
        hw.push(h);
        L.push({ x: P[i].x + nx * h, y: P[i].y + ny * h });
        R.push({ x: P[i].x - nx * h, y: P[i].y - ny * h });
    }

    const Rr = R.slice().reverse();
    const he = hw[n - 1];
    const hs = hw[0];

    return (
        `M${fmt(L[0].x)} ${fmt(L[0].y)}` +
        splineSegments(L) +
        `A${fmt(he)} ${fmt(he)} 0 0 0 ${fmt(Rr[0].x)} ${fmt(Rr[0].y)}` +
        splineSegments(Rr) +
        `A${fmt(hs)} ${fmt(hs)} 0 0 0 ${fmt(L[0].x)} ${fmt(L[0].y)}Z`
    );
}

// the ink outline of a glyph at scale ps (px per unit), at its own origin; kept per glyph
const inkCache = new WeakMap();

export function glyphInk(g, ps, penPx) {
    let m = inkCache.get(g);
    if (!m) inkCache.set(g, (m = new Map()));
    const k = ps + '|' + penPx;
    let d = m.get(k);

    if (d == null) {
        d = g.strokes
            .map((st) =>
                inkPath(
                    st.map((p) => ({ x: p.x * ps, y: p.y * ps, w: p.w })),
                    penPx,
                ),
            )
            .join('');

        m.set(k, d);
    }

    return d;
}

export function centerPath(pts) {
    const len = polyLength(pts);
    if (pts.length < 2 || len < 0.5) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)}l0.01 0`;

    const P = resample(pts, Math.max(3, Math.ceil(len / 2.5)));

    return `M${fmt(P[0].x)} ${fmt(P[0].y)}` + splineSegments(P);
}

export function escapeAttr(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
