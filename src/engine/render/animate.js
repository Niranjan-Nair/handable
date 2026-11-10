// Writing that can be played back (animate: true; ink and uniform pens). Each
// stroke carries its own start time and duration as CSS variables (--d, --t),
// in writing order, from its length at o.animSpeed px/s, with a short pen lift
// between strokes. A page's stylesheet decides whether and when it plays:
//   .hw-s  a path to draw on with stroke-dashoffset (pathLength is 1); for ink
//          it's the center line inside a mask that reveals the inked shape
//   .hw-d  a dot, which just appears at its moment
// o.animOut.total receives the total writing time.
import { centroid, polyLength } from '../geometry.js';
import { centerPath, dotPath, fmt, inkPath } from './paths.js';

export function animatedInk(placed, o, penPx, color, maskAttr) {
    const speed = o.animSpeed || 900;
    const id = 'hw' + (o.idSuffix || '0');
    const uniform = o.pen === 'uniform';
    const out = [`<g${maskAttr}>`];
    let t = 0;
    let k = 0;
    const tv = (v) => `${v.toFixed(3)}s`;

    for (const g of placed) {
        for (const st of g.strokes) {
            const len = polyLength(st);
            const op = fmt(g.opacity);

            if (len < penPx * 1.2) {
                const dot = uniform ? dotPath(centroid(st), penPx * 0.8) : inkPath(st, penPx);
                out.push(`<path class="hw-d" d="${dot}" fill="${color}" opacity="${op}" style="--d:${tv(t)}"/>`);
                t += 0.03;
                continue;
            }

            const dur = Math.max(0.03, len / speed);
            const vars = `style="--d:${tv(t)};--t:${tv(dur)}"`;

            if (uniform) {
                out.push(
                    `<path class="hw-s" d="${centerPath(st)}" pathLength="1" fill="none" stroke="${color}" stroke-width="${fmt(penPx)}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}" ${vars}/>`,
                );
            } else {
                const mid = `${id}s${k++}`;

                out.push(
                    `<mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${o.width}" height="${o.height}">` +
                        `<path class="hw-s" d="${centerPath(st)}" pathLength="1" fill="none" stroke="#fff" stroke-width="${fmt(penPx * 3)}" stroke-linecap="round" stroke-linejoin="round" ${vars}/></mask>` +
                        `<path d="${inkPath(st, penPx)}" fill="${color}" opacity="${op}" mask="url(#${mid})"/>`,
                );
            }

            t += dur + 0.012; // lift the pen
        }

        t += 0.02; // move on to the next letter
    }

    out.push('</g>');
    if (o.animOut) o.animOut.total = Math.max(o.animOut.total || 0, t);

    return out.join('');
}
