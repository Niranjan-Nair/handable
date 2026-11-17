// The base font's skeletons, as glyphs (see basefont.js): its print letters and
// symbols, and its cursive lowercase.
import { glyphs as BASE_GLYPHS, cursive as CURSIVE } from './basefont.js';
import { bbox } from '../geometry.js';

const baseCache = {};

// the key a character's skeleton is kept under: its print form's is the character
export const skeletonKey = (ch, cursive) => (cursive ? 'cursive ' + ch : ch);

// Base glyph: strokes as concatenated points with knot indices at segment boundaries
// (cursive: its cursive form's, if it has one).
export function baseGlyph(ch, cursive = false) {
    const key = skeletonKey(ch, cursive);
    if (key in baseCache) return baseCache[key];

    const def = (cursive ? CURSIVE : BASE_GLYPHS)[ch];
    if (!def) return (baseCache[key] = null);

    const strokes = def.map((segs) => {
        const pts = [];
        const knots = [0];

        segs.forEach((seg) => {
            const sp = seg.map(([x, y]) => ({ x, y, w: 1 }));
            for (let k = pts.length ? 1 : 0; k < sp.length; k++) pts.push(sp[k]);
            knots.push(pts.length - 1);
        });

        return { pts, knots };
    });

    const bb = bbox(strokes.map((s) => s.pts));
    for (const s of strokes) for (const p of s.pts) p.x -= bb.minX;
    for (const s of strokes) s.segs = s.knots.slice(0, -1).map((k, j) => s.pts.slice(k, s.knots[j + 1] + 1));

    return (baseCache[key] = { strokes, width: bb.maxX - bb.minX, minY: bb.minY, maxY: bb.maxY });
}

// every character the base font has a skeleton for
export const baseChars = () => Object.keys(BASE_GLYPHS);
