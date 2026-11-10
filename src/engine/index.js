/*
 * handwrite engine
 *
 * A small non-parametric generative model of a person's handwriting.
 *
 *  - Training data: vector pen strokes for characters, captured relative to a
 *    baseline (y = 0) where 1 unit = baseline-to-ascender height. y grows down.
 *  - Per character, samples are clustered into *variants* (e.g. a looped `y`
 *    and a straight `y`). Variant frequencies are learned, and also conditioned
 *    on position in a word (start / mid / end / solo) when sentence data exists.
 *  - New glyphs are synthesized by blending several samples of the same variant
 *    (morphing between real examples) and applying smooth random deformations
 *    whose strength is scaled by how consistent the writer is for that variant.
 *  - Global style (slant, x-height, letter & word spacing) is learned from the
 *    data and used for layout.
 *
 * Works in the browser and in Node (ES modules).
 */
import { inferPlan } from './model/parts.js';

export { DEFAULTS } from './options.js';
export { makeRng } from './util.js';
export { buildModel } from './model/build.js';
export { prepareSample } from './model/samples.js';
export { joinBetween, linkStats } from './model/sequences.js';
export { baseChars } from './model/skeleton.js';
export { sampleGlyph } from './glyph/synth.js';
export { generate } from './generate.js';
export { glyphSVG } from './render/svg.js';
export { parseRich, FORMAT_TAG, ANY_FORMAT_TAG, HIGHLIGHTS } from './text/rich.js';
export { mathSpans } from './text/math-spans.js';
export { listMarkerAt, listNumber } from './text/lists.js';
export { parseMath } from './text/tex.js';
export { segment, splitAt, mergeAt } from './reading/segment.js';
export { readLine, labelGroups } from './reading/read-line.js';
export { sentenceToSamples } from './reading/to-samples.js';

// How an untrained character would be built: { sources, matched, total }, or null
// when it's trained (or can't be built).
export function inferInfo(model, ch) {
    if (model.chars[ch]) return null;

    const plan = inferPlan(model, ch);

    return plan && { sources: plan.sources, matched: plan.matched, total: plan.total };
}
