// Written words, kept between calls (per model, per settings), so retyping a page
// only writes the words that changed. A word's box is keyed by everything it's made
// from: its letters and formats, the settings and seed, and which time it occurs.
const wordCache = new WeakMap();

// options that don't change how a word is written (the text, which callers may pass in
// the options too, and the text boxes: they'd start an empty cache every keystroke)
const IGNORED = new Set(['rawAt', 'shearDelta', 'text', 'boxes']);

// the cache for these options (o.seed must be set: unseeded writing is never reused)
export function wordCacheFor(model, o) {
    if (o.seed == null) return null;

    const optsKey = JSON.stringify(o, (k, v) => (IGNORED.has(k) ? undefined : v));
    // a few sets of settings at once (the page, its text boxes, the hint on an empty page, …)
    let byOpts = wordCache.get(model);
    if (!byOpts) wordCache.set(model, (byOpts = new Map()));
    let map = byOpts.get(optsKey);
    if (map) byOpts.delete(optsKey); // most recently used last
    if (!map || map.size > 20000) map = new Map();
    byOpts.set(optsKey, map);
    if (byOpts.size > 12) byOpts.delete(byOpts.keys().next().value);

    return map;
}
