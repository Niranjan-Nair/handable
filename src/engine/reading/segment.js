// Cutting a written line into letters by hand: strokes grouped where they
// overlap, and groups split or merged where the writer clicks.
// Raw strokes: [[x, y, t, p], ...]. Groups: { strokes, minX, maxX, minY, maxY }.
export function makeGroup(strokes) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const s of strokes)
        for (const p of s) {
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]);
            maxY = Math.max(maxY, p[1]);
        }

    return { strokes, minX, maxX, minY, maxY };
}

function shouldMerge(a, b) {
    const ov = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const wa = a.maxX - a.minX;
    const wb = b.maxX - b.minX;
    const mn = Math.min(wa, wb);
    if (mn < 0.08) return ov > -0.03; // dots, accents, small marks join what's under them

    return ov > 0.5 * mn;
}

function groupStrokes(strokes) {
    const groups = strokes.filter((s) => s && s.length).map((s) => makeGroup([s]));
    groups.sort((a, b) => a.minX - b.minX);
    let changed = true;

    while (changed) {
        changed = false;

        outer: for (let i = 0; i < groups.length; i++)
            for (let j = i + 1; j < groups.length; j++)
                if (shouldMerge(groups[i], groups[j])) {
                    groups[i] = makeGroup(groups[i].strokes.concat(groups[j].strokes));
                    groups.splice(j, 1);
                    changed = true;
                    break outer;
                }
    }

    return groups.sort((a, b) => a.minX - b.minX);
}

function crossings(g, x) {
    let c = 0;
    for (const s of g.strokes) for (let i = 1; i < s.length; i++) if ((s[i - 1][0] - x) * (s[i][0] - x) < 0) c++;

    return c;
}

function bestCut(g) {
    const w = g.maxX - g.minX;
    let best = null;
    let bestCost = Infinity;

    for (let k = 0; k <= 60; k++) {
        const x = g.minX + w * (0.2 + (0.6 * k) / 60);
        const cost = crossings(g, x) + (1.5 * Math.abs(x - (g.minX + w / 2))) / w;

        if (cost < bestCost) {
            bestCost = cost;
            best = x;
        }
    }

    return best;
}

function splitGroup(g, x) {
    const left = [];
    const right = [];

    for (const s of g.strokes) {
        let run = [];
        let side = null;

        for (const p of s) {
            const sd = p[0] < x ? 'L' : 'R';

            if (side !== null && sd !== side) {
                (side === 'L' ? left : right).push(run);
                run = [];
            }

            side = sd;
            run.push(p);
        }

        if (run.length) (side === 'L' ? left : right).push(run);
    }

    if (!left.length || !right.length) return null;

    return [makeGroup(left), makeGroup(right)];
}

export function mergeAt(groups, i) {
    if (i < 0 || i >= groups.length - 1) return groups;

    const g = groups.slice();
    g.splice(i, 2, makeGroup(groups[i].strokes.concat(groups[i + 1].strokes)));

    return g;
}

export function splitAt(groups, i, x) {
    const parts = splitGroup(groups[i], x);
    if (!parts) return groups;

    const g = groups.slice();
    g.splice(i, 1, parts[0], parts[1]);

    return g;
}

export function segment(strokes, target) {
    let groups = groupStrokes(strokes);
    if (!target) return groups;

    while (groups.length > target && groups.length > 1) {
        let bi = 0;
        let bg = Infinity;

        for (let i = 0; i < groups.length - 1; i++) {
            const gap = groups[i + 1].minX - groups[i].maxX;

            if (gap < bg) {
                bg = gap;
                bi = i;
            }
        }

        groups = mergeAt(groups, bi);
    }

    let guard = 0;

    while (groups.length < target && guard++ < 500) {
        let bi = -1;
        let bw = 0.05;

        groups.forEach((g, i) => {
            if (g.maxX - g.minX > bw) {
                bw = g.maxX - g.minX;
                bi = i;
            }
        });

        if (bi < 0) break;

        const next = splitAt(groups, bi, bestCut(groups[bi]));
        if (next === groups) break;

        groups = next;
    }

    return groups;
}
