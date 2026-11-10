// Written words, kept between calls (per model, per settings), so retyping a page
// only writes the words that changed. A word's box is keyed by everything it's made
// from: its letters and formats, the settings and seed, and which time it occurs.
const wordCache = new WeakMap();

// the cache for these options (o.seed must be set: unseeded writing is never reused)
export function wordCacheFor(model, o) {
    if (o.seed == null) return null;

    // (not the text, which callers may pass in the options too: then every keystroke
    // would start an empty cache)
    const optsKey = JSON.stringify(o, (k, v) => (k === 'rawAt' || k === 'shearDelta' || k === 'text' ? undefined : v));
    // a few sets of settings at once (the page, the hint on an empty page, …)
    let byOpts = wordCache.get(model);
    if (!byOpts) wordCache.set(model, (byOpts = new Map()));
    let map = byOpts.get(optsKey);
    if (map) byOpts.delete(optsKey); // most recently used last
    if (!map || map.size > 20000) map = new Map();
    byOpts.set(optsKey, map);
    if (byOpts.size > 4) byOpts.delete(byOpts.keys().next().value);

    return map;
}
