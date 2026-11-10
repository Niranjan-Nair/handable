// The state shared by everything that writes one text: the model and options, the
// keyed random numbers, and what was noticed along the way (characters that are
// missing, inferred, or written as ligatures).
import { clamp, makeRng } from '../util.js';

const RNG_METHODS = ['normal', 'range', 'pick', 'weighted', 'shuffle'];

// Randomness is keyed, not one stream: every word draws from its own generator,
// seeded by the seed plus the word itself (and which time it occurs), every line by
// its first word, and the paper by the seed alone. So typing only changes the word
// being typed (and lines that rewrap); the rest of the page, and the paper, stay
// exactly as they were until the seed changes (New variation).
function keyedRng(seed) {
  const base = seed == null ? 'r' + Math.random() : String(seed);
  let current = makeRng(base);
  const rng = () => current();
  for (const k of RNG_METHODS) rng[k] = (...args) => current[k](...args);

  rng.reseed = (key) => {
    current = makeRng(base + '\u0001' + key);
  };

  return rng;
}

export function createWriter(model, o) {
  const style = model.style;
  const rng = keyedRng(o.seed);
  const r = o.randomness;
  const found = { missing: new Set(), inferred: new Set(), ligatures: new Set() };

  const writer = {
    model,
    o,
    style,
    rng,
    r,
    X: style.zones.X, // x-height, units
    formality: clamp(+o.formality || 0, 0, 1),
    spaceW: style.wordGap.mean * o.wordSpacing, // one space (for indents): about a word gap
    seen: new Map(), // how many times each word (and list marker) has come up so far
    found,
    // what's being noted while a word is written, so a cached copy can note it again
    noting: null,
    note(kind, value) {
      found[kind].add(value);
      if (writer.noting) writer.noting.push([kind, value]);
    },
    letterGap() {
      const g = style.letterGap;

      return Math.max(0.02 * o.letterSpacing, g.mean * o.letterSpacing + rng.normal() * g.std * Math.min(r, 1.5));
    },
    wordGap() {
      const g = style.wordGap;

      return Math.max(0.7 * g.mean * o.wordSpacing, g.mean * o.wordSpacing + rng.normal() * g.std * Math.min(r, 1.5));
    },
  };

  return writer;
}
