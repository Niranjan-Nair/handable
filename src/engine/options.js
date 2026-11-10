// The options generate() takes, with their defaults, and layout constants.
export const DEFAULTS = {
    seed: null,
    randomness: 1, // 0 = exact copies of samples, 1 = natural, 2 = sloppy
    size: 48, // px per unit (baseline -> ascender height)
    maxWidth: 800, // px, content width before wrapping
    margin: 32, // px
    lineHeight: 1.55, // units (baseline to baseline); ~single-spaced handwriting
    penWidth: 0.055, // units
    pen: 'ink', // 'ink' (variable width) | 'pencil' (graphite texture) | 'uniform'
    color: '#1b2a57',
    paper: 'none', // 'none' | 'plain' | 'lined' (plain / lined = real pages, see pageSize)
    pageSize: 'letter', // 'letter' | 'a4' (paper modes)
    scan: true, // paper modes: look like a scanned sheet (uneven rules, a slightly bent page, soft detail)
    doubleSided: false, // lined paper: every second page is the back of a sheet, with the margin on the right
    slant: null, // degrees; null = learned slant
    letterSpacing: 1, // multiplier on learned letter gap
    wordSpacing: 1, // multiplier on learned word gap
    blend: true, // morph between samples of a variant
    variantThreshold: 0.14,
    sizeConsistency: 0.8, // 0 = keep sample sizes as written, 1 = force every sample to the learned size
    infer: true, // build untrained characters from parts of trained ones + the base skeleton font
    ligatures: true, // use the writer's own joined ligatures (never invented joins)
    smoothness: 0.25, // 0 = keep every wobble, 1 = smooth out trackpad / mouse jitter
    penConsistency: 0.6, // 0 = uneven pen (width & ink vary a lot), 1 = very even pen
    formality: 0, // 0 = as you write, 1 = formal: no ligatures, most recognizable forms, tidier
};
export const STEP = 0.02; // resampling step in units

// paper pages are laid out at 192 px per inch (so the default size is realistic handwriting)
export const PAGE_PPI = 192;
export const PAGE_SIZES = { letter: [8.5, 11], a4: [8.27, 11.69] };
