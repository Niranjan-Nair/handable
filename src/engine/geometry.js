// Points and polylines: { x, y, w } points (w: relative pen width).
import { clamp } from './util.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);

    return L;
}

// Resample a polyline (points {x,y,w}) to n points evenly spaced by arc length.
export function resample(pts, n) {
    if (n < 1) n = 1;
    const copy = (p) => ({ x: p.x, y: p.y, w: p.w == null ? 1 : p.w });
    if (pts.length === 1 || n === 1) return Array.from({ length: n }, () => copy(pts[0]));

    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    if (total < 1e-9) return Array.from({ length: n }, () => copy(pts[0]));

    const out = [];
    let j = 1;

    for (let k = 0; k < n; k++) {
        const target = (total * k) / (n - 1);
        while (j < pts.length - 1 && cum[j] < target) j++;
        const seg = cum[j] - cum[j - 1];
        const t = seg > 0 ? clamp((target - cum[j - 1]) / seg, 0, 1) : 0;
        const a = pts[j - 1];
        const b = pts[j];
        const wa = a.w == null ? 1 : a.w;
        const wb = b.w == null ? 1 : b.w;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: wa + (wb - wa) * t });
    }

    return out;
}

// Resample a point list to n points by index (used for signatures).
export function resampleByIndex(pts, n) {
    if (pts.length === 1) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));

    const out = [];

    for (let k = 0; k < n; k++) {
        const f = (k * (pts.length - 1)) / (n - 1);
        const i = Math.min(Math.floor(f), pts.length - 2);
        const t = f - i;
        out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t });
    }

    return out;
}

export function bbox(strokes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const s of strokes)
        for (const p of s) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    return { minX, minY, maxX, maxY };
}

export function smoothSeries(pts, key, radius) {
    if (pts.length < 3) return;

    const src = pts.map((p) => p[key]);

    for (let i = 1; i < pts.length - 1; i++) {
        let s = 0;
        let c = 0;

        for (let k = -radius; k <= radius; k++) {
            const j = i + k;

            if (j >= 0 && j < pts.length) {
                s += src[j];
                c++;
            }
        }

        pts[i][key] = s / c;
    }
}
export function centroid(pts) {
    let x = 0;
    let y = 0;

    for (const p of pts) {
        x += p.x;
        y += p.y;
    }

    return { x: x / pts.length, y: y / pts.length };
}

export const meanPointDist = (A, B) => {
    let d = 0;
    for (let i = 0; i < A.length; i++) d += dist(A[i], B[i]);

    return d / A.length;
};
