import { bbox, meanPointDist, polyLength } from '../geometry.js';
import { prepareMarks } from './marks.js';
import { buildParts } from './parts.js';
import { clusterGlyphs, prepareSample, signature } from './samples.js';
import { analyzeSequences } from './sequences.js';
import { baseGlyph } from './skeleton.js';
import { learnAspect, learnShear, learnSpacing, learnZones, skeletonTransform, normalizeSizes } from './style.js';
import { DEFAULTS } from '../options.js';
import { clamp, median } from '../util.js';

// The model of a writer's hand, from their training data (see the README):
// { chars, units (ligatures), links (how often they join letters), style, marks,
// parts (pieces of letters, for inferring untrained ones), cursive (their cursive
// letters), … }. Cursive samples (cursive: true) are kept apart: the style (heights,
// slant, widths, spacing) and joined letters are learned from print.
export function buildModel(dataset, opts = {}) {
    const threshold = opts.variantThreshold != null ? opts.variantThreshold : DEFAULTS.variantThreshold;
    const sizeConsistency = opts.sizeConsistency != null ? +opts.sizeConsistency : DEFAULTS.sizeConsistency;
    const all = (dataset && dataset.samples) || [];
    const samples = all.filter((s) => s && !s.cursive);
    const byCursive = cursiveSamples(all.filter((s) => s && s.cursive));
    const seq = analyzeSequences(samples, new Set((dataset && dataset.excludedUnits) || []));
    const byChar = letterSamples(samples, seq);
    const byUnit = {};

    for (const u of seq.units) {
        const g = prepareSample(u);
        if (g) (byUnit[u.char] = byUnit[u.char] || []).push(g);
    }

    // "finetune" global style against the base-font prior
    const style = learnShape(byChar);

    // make sizes semi-consistent
    if (sizeConsistency > 0) {
        normalizeSizes(byChar, style, clamp(sizeConsistency, 0, 1));
        normalizeSizes(byUnit, style, clamp(sizeConsistency, 0, 1));
        normalizeSizes(byCursive, style, clamp(sizeConsistency, 0, 1));
    }

    const spreads = [];
    const chars = variantEntries(byChar, threshold, style, spreads);
    const units = variantEntries(byUnit, threshold, style, spreads);
    const cursive = variantEntries(byCursive, threshold, style, []);
    const sentences = ((dataset && dataset.sentences) || []).filter((s) => !s.cursive);
    Object.assign(style, learnSpacing(byChar, sentences, style));
    style.spreadFactor = spreads.length ? median(spreads) : 1;

    const model = {
        chars,
        units,
        cursive,
        links: seq.links,
        style,
        threshold,
        sizeConsistency,
        parts: [],
        inferCache: {},
    };
    model.marks = prepareMarks((dataset && dataset.marks) || []);
    model.parts = buildParts(model);

    return model;
}

// every usable sample, prepared, by character (seq: what analyzeSequences found)
function letterSamples(samples, seq) {
    const byChar = {};

    for (const s of samples) {
        if (!s || !s.char) continue;

        const g = prepareSample(s);
        if (!g) continue;

        const meta = seq.meta.get(s);
        if (meta) Object.assign(g, meta);
        (byChar[s.char] = byChar[s.char] || []).push(g);
    }

    // A letter cut out of joined writing is often truncated where the split ran
    // through the connection. It lives on inside the ligature; as a standalone
    // letter form it's only used if there's nothing cleaner.
    for (const ch of Object.keys(byChar)) {
        const clean = byChar[ch].filter((g) => !g.joinL && !g.joinR);
        if (clean.length && clean.length < byChar[ch].length) byChar[ch] = clean;
    }

    return byChar;
}

// The writer's cursive letters, prepared, by character. Each is kept as it's written
// in a word: with the stroke into it, but only down to the last turn at the line,
// where a short stroke out of it ends (the way on out is the join into the next
// letter, drawn when it's written).
function cursiveSamples(samples) {
    const byChar = {};

    for (const s of samples) {
        if (!s.char || !s.strokes || !s.strokes.length) continue;

        const g = prepareSample({ ...s, strokes: [withoutExit(s.strokes[0]), ...s.strokes.slice(1)] });
        if (g) (byChar[s.char] = byChar[s.char] || []).push(g);
    }

    return byChar;
}

// a cursive letter's first stroke without its exit: cut at its last low point near the
// line, when what comes after is a short stroke out to the right (not o's tie, not g's
// loop back up); raw points are [x, y, …] in units, y down
function withoutExit(st) {
    if (!st || st.length < 8) return st;

    let low = -1;
    for (let i = Math.floor(st.length * 0.5); i < st.length; i++) if (low < 0 || st[i][1] >= st[low][1]) low = i;

    const len = (a, b) => {
        let d = 0;
        for (let i = a + 1; i <= b; i++) d += Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1]);

        return d;
    };

    const nearLine = Math.abs(st[low][1]) < 0.12;
    const shortExit = len(low, st.length - 1) < 0.3 * len(0, st.length - 1);
    const outRight = st.at(-1)[0] > st[low][0];

    return nearLine && shortExit && outRight && st.length - low > 2 ? st.slice(0, low + 2) : st;
}

// the writer's letter shapes: zones (heights), slant and widths
function learnShape(byChar) {
    const zones = learnZones(byChar);
    const shear = learnShear(byChar);
    const style = { zones, shear, slantDeg: (Math.atan(shear) * 180) / Math.PI };
    style.aspect = learnAspect(byChar, style);
    style.xHeight = zones.X;
    style.ascHeight = zones.A;

    return style;
}

// Each character's samples clustered into variants (its different forms), most
// common first: { [ch]: { char, count, variants } }. Each variant's spread factor
// (how loosely it's written) is also added to spreads.
function variantEntries(byKey, threshold, style, spreads) {
    const entries = {};

    for (const ch of Object.keys(byKey)) {
        const variants = clusterGlyphs(byKey[ch], threshold)
            .map((c) => {
                const ctx = { solo: 0, start: 0, mid: 0, end: 0 };

                c.members.forEach((m) => {
                    ctx[m.ctx] = (ctx[m.ctx] || 0) + 1;
                });

                // spread of ~0.06 is "normal" variation; scale noise relative to that
                const spreadFactor = c.spread == null ? 1 : clamp(c.spread / 0.06, 0.5, 1.8);
                if (c.spread != null) spreads.push(spreadFactor);
                const prev = {};

                c.members.forEach((m) => {
                    if (m.prev) prev[m.prev] = (prev[m.prev] || 0) + 1;
                });

                return {
                    members: c.members,
                    medoid: c.medoid,
                    weight: c.members.length,
                    ctx,
                    prev,
                    spread: c.spread,
                    spreadFactor,
                };
            })
            .sort((a, b) => b.weight - a.weight);

        for (const v of variants) for (const m of v.members) m.dMed = meanPointDist(m.sig, v.medoid.sig);
        scoreRecognizability(style, ch, variants);
        entries[ch] = { char: ch, count: byKey[ch].length, variants };
    }

    return entries;
}

// How much a variant looks like the textbook form of its character: distance of
// its medoid from the style-mapped skeleton, relative to the closest variant.
function scoreRecognizability(style, ch, variants) {
    const b = Array.from(ch).length === 1 ? baseGlyph(ch) : null;

    if (!b) {
        variants.forEach((v) => {
            v.recog = 1;
        });

        return;
    }

    const T = skeletonTransform(style, ch);
    const strokes = b.strokes.map((s) => s.pts.map((p) => ({ ...T(p.x, p.y), w: 1 })));
    const bb = bbox(strokes);

    strokes.forEach((s) =>
        s.forEach((p) => {
            p.x -= bb.minX;
        }),
    );

    const sig = signature({ strokes, lens: strokes.map(polyLength) });
    const ds = variants.map((v) => meanPointDist(v.medoid.sig, sig));
    const dmin = Math.min(...ds);

    variants.forEach((v, i) => {
        v.recog = Math.exp(-(ds[i] - dmin) / 0.06);
    });
}
