// Writing one glyph: a new instance of a character, morphed between the writer's
// samples (or built from parts, for an untrained one) and given natural variation.
import { bbox, centroid, dist, meanPointDist, polyLength, resample } from '../geometry.js';
import { finishGlyph, finishStrokes } from './finish.js';
import { inferPlan } from '../model/parts.js';
import { baseGlyph } from '../model/skeleton.js';
import { composeGlyph } from './compose.js';
import { DEFAULTS, STEP } from '../options.js';
import { clamp, makeRng } from '../util.js';

function synthInferred(model, plan, rng, o, extra = {}) {
    const picks = [];
    // size a borrowed piece halfway (geometrically) between the writer's own
    // proportion and what the skeleton calls for
    const gm = (target, own, ref) => target / Math.sqrt(Math.max(own, 0.03) * Math.max(ref, 0.03));

    const strokes = plan.strokes.map((segs) => {
        let out = [];

        for (const sp of segs) {
            let pts;
            let c = null;

            if (sp.cands) {
                const prevPick = extra.picks && extra.picks[picks.length];
                const idx =
                    prevPick != null && prevPick < sp.cands.length ? prevPick : Math.floor(rng() * sp.cands.length);
                picks.push(idx);
                c = sp.cands[idx];
            }

            if (c) {
                let u = rng.pick(c.part.user);
                if (c.rev) u = u.slice().reverse();
                const bb = bbox([u]);
                const w = bb.maxX - bb.minX;
                const h = bb.maxY - bb.minY;
                let kx;
                let ky;
                let cx;
                let cy;

                if (sp.whole) {
                    cx = (bb.minX + bb.maxX) / 2;
                    cy = (bb.minY + bb.maxY) / 2;

                    if (sp.uniform)
                        kx = ky = gm(Math.max(sp.wT, sp.hT), Math.max(w, h), Math.max(c.part.wT, c.part.hT));
                    else {
                        kx = gm(sp.wT, w, c.part.wT);
                        ky = gm(sp.hT, h, c.part.hT);
                    }
                } else {
                    const ct = centroid(u);
                    cx = ct.x;
                    cy = ct.y;
                    kx = ky = sp.dot ? 1 : gm(sp.sizeT, Math.max(w, h), c.part.sizeT);
                }

                pts = u.map((p) => ({
                    x: sp.cT.x + kx * (p.x - cx),
                    y: sp.cT.y + ky * (p.y - cy),
                    w: p.w == null ? 1 : p.w,
                }));
            } else pts = sp.segT.map((p) => ({ ...p }));

            if (out.length) {
                // join to the previous segment, fading the correction out along this one
                const e = out[out.length - 1];
                const ox = e.x - pts[0].x;
                const oy = e.y - pts[0].y;
                const fade = Math.max(1, Math.round(pts.length * 0.5));

                pts.forEach((p, i) => {
                    const f = Math.max(0, 1 - i / fade);
                    p.x += ox * f;
                    p.y += oy * f;
                });

                pts = pts.slice(1);
            }

            out = out.concat(pts);
        }

        const len = polyLength(out);

        return out.length > 1 ? resample(out, clamp(Math.round(len / STEP) + 2, 2, 300)) : out;
    });

    return finishGlyph(plan.char, finishStrokes(strokes, rng, o, model.style.spreadFactor || 1), {
        inferred: true,
        picks,
    });
}

// ----------------------------------------------------------- synthesis
function chooseVariant(entry, ctx, rng, prev, formality = 0) {
    const total = entry.variants.reduce((a, v) => a + v.weight, 0);

    // P(variant | position in word, previous letter), smoothed toward the
    // overall variant frequency
    const ws = entry.variants.map((v) => {
        let w = (v.ctx[ctx] || 0) + v.weight / total + (prev && v.prev ? 2 * (v.prev[prev] || 0) : 0);
        // formal / readable: lean toward the writer's main form and the more textbook-like
        // ones. A gentle preference (the floor keeps less textbook forms in the mix)
        if (formality > 0)
            w *=
                Math.pow(v.weight / total, formality) *
                Math.pow(0.25 + 0.75 * (v.recog == null ? 1 : v.recog), 1.5 * formality);

        return w;
    });

    return rng.weighted(entry.variants, ws);
}

// Align every stroke of `partner` to `base` (resampled to ns[i] points), fixing
// drawing direction. Returns null if the shapes don't correspond well enough to
// morph between (e.g. an `o` started at a different point).
function alignPartner(base, baseRs, partner, ns) {
    const out = [];

    for (let i = 0; i < base.strokes.length; i++) {
        const n = ns[i];
        const fwd = resample(partner.strokes[i], n);
        const bb = bbox([baseRs[i]]);
        const sz = Math.max(Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY), 0.12);
        const candidates = [fwd, fwd.slice().reverse()];
        // closed loops (o, 0, a's bowl...) may start anywhere: also try cyclic shifts
        const closed = n > 8 && dist(fwd[0], fwd[n - 1]) < 0.2 * sz && dist(baseRs[i][0], baseRs[i][n - 1]) < 0.2 * sz;

        if (closed) {
            const ring = fwd.slice(0, n - 1);

            for (let k = 1; k < 24; k++) {
                const sh = Math.round((k * (n - 1)) / 24);
                const rot = ring.slice(sh).concat(ring.slice(0, sh));
                rot.push({ ...rot[0] });
                candidates.push(rot, rot.slice().reverse());
            }
        }

        let best = null;
        let bd = Infinity;

        for (const c of candidates) {
            const d = meanPointDist(baseRs[i], c);

            if (d < bd) {
                bd = d;
                best = c;
            }
        }

        if (bd > 0.22 * sz) return null;

        out.push(best);
    }

    return out;
}

// Greek and Cyrillic letters written exactly like a Latin one (or a variant written
// like the main form): if you haven't trained the Greek or Cyrillic one, your
// trained letter is used.
const LOOKALIKE = {
    Α: 'A',
    Β: 'B',
    Ε: 'E',
    Ζ: 'Z',
    Η: 'H',
    Ι: 'I',
    Κ: 'K',
    Μ: 'M',
    Ν: 'N',
    Ο: 'O',
    Ρ: 'P',
    Τ: 'T',
    Χ: 'X',
    ο: 'o',
    ϖ: 'π',
    ϱ: 'ρ',
    ϑ: 'θ',
    ϕ: 'φ',
    ϵ: 'ε',
    А: 'A',
    В: 'B',
    Е: 'E',
    К: 'K',
    М: 'M',
    Н: 'H',
    О: 'O',
    Р: 'P',
    С: 'C',
    Т: 'T',
    Х: 'X',
    Ѕ: 'S',
    І: 'I',
    Ј: 'J',
    а: 'a',
    е: 'e',
    о: 'o',
    р: 'p',
    с: 'c',
    у: 'y',
    х: 'x',
    ѕ: 's',
    і: 'i',
    ј: 'j',
    һ: 'h',
    ԛ: 'q',
    ԝ: 'w',
    // curly quotes fall back to the straight ones you trained (an apostrophe is ’)
    '’': "'",
    '‘': "'",
    '”': '"',
    '“': '"',
};

// Synthesize one new instance of `ch`. Returns null if the character is unknown
// (not trained, and inference is off or there is no base skeleton for it).
export function synthGlyph(model, ch, ctx, rng, o, extra = {}) {
    const like = LOOKALIKE[ch];
    if (like && !model.chars[ch] && (model.chars[like] || !baseGlyph(ch))) ch = like;
    const entry = model.chars[ch] || (model.units && model.units[ch]);

    if (!entry) {
        // a letter made of parts (é = e + ´): the letter is written in its place in the word
        const write = (part) => synthGlyph(model, part, ctx, rng, o, /\p{L}/u.test(part) ? extra : {});
        const composed = composeGlyph(ch, { write, rng, o, X: model.style.zones.X });
        if (composed) return composed;

        const plan = o.infer !== false ? inferPlan(model, ch) : null;

        return plan ? synthInferred(model, plan, rng, o, extra) : null;
    }

    const f = clamp(+o.formality || 0, 0, 1);

    const v =
        extra.variant && entry.variants.includes(extra.variant)
            ? extra.variant
            : chooseVariant(entry, ctx, rng, extra.prev, f);

    // formal: prefer the samples closest to the variant's typical shape
    const base =
        f > 0
            ? rng.weighted(
                  v.members,
                  v.members.map((m) => Math.exp((-f * (m.dMed || 0)) / 0.03)),
              )
            : rng.pick(v.members);

    const r = o.randomness;

    const partners =
        o.blend && r > 0
            ? rng.shuffle(v.members.filter((m) => m !== base && m.nStrokes === base.nStrokes)).slice(0, 2)
            : [];

    const ns = base.lens.map((l) => clamp(Math.round(l / STEP) + 2, 2, 300));
    const baseRs = base.strokes.map((s, i) => resample(s, ns[i]));
    const aligned = [baseRs];

    for (const p of partners) {
        const a = alignPartner(base, baseRs, p, ns);
        if (a) aligned.push(a);
    }

    let strokes = baseRs;

    if (aligned.length > 1) {
        // random convex combination; the base dominates more at low randomness
        let ws = aligned.map((_, i) => (i === 0 ? 1 : rng() * Math.min(1, r)));
        const tot = ws.reduce((s2, w) => s2 + w, 0);
        ws = ws.map((w) => w / tot);

        strokes = baseRs.map((bs, i) =>
            bs.map((_, k) => {
                let x = 0;
                let y = 0;
                let w = 0;

                for (let j = 0; j < aligned.length; j++) {
                    const q = aligned[j][i][k];
                    x += q.x * ws[j];
                    y += q.y * ws[j];
                    w += q.w * ws[j];
                }

                return { x, y, w };
            }),
        );
    }

    strokes = finishStrokes(strokes, rng, o, v.spreadFactor);

    return finishGlyph(ch, strokes, { variant: v });
}

export function sampleGlyph(model, ch, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    o.shearDelta = 0;

    return synthGlyph(model, ch, opts && opts.ctx ? opts.ctx : 'solo', makeRng(o.seed), o);
}
