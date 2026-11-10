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
// parts (pieces of letters, for inferring untrained ones), … }
export function buildModel(dataset, opts = {}) {
    const threshold = opts.variantThreshold != null ? opts.variantThreshold : DEFAULTS.variantThreshold;
    const sizeConsistency = opts.sizeConsistency != null ? +opts.sizeConsistency : DEFAULTS.sizeConsistency;
    const samples = (dataset && dataset.samples) || [];
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
    }

    const spreads = [];
    const chars = variantEntries(byChar, threshold, style, spreads);
    const units = variantEntries(byUnit, threshold, style, spreads);
    Object.assign(style, learnSpacing(byChar, (dataset && dataset.sentences) || [], style));
    style.spreadFactor = spreads.length ? median(spreads) : 1;

    const model = { chars, units, links: seq.links, style, threshold, sizeConsistency, parts: [], inferCache: {} };
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
