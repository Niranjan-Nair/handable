// The app's state: the training data and settings (both kept in localStorage), the
// handwriting model built from the data, and which tab is open.
import * as HW from '../engine/index.js';
import { status } from './dom.js';

const DATA_KEY = 'handwrite.dataset.v1';
const SETTINGS_KEY = 'handwrite.settings.v1';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

// the generate tab's settings, as they start
export const GEN_DEFAULTS = {
  text: 'The quick brown fox jumps over the lazy dog.\nHow vexingly quick daft zebras jump!',
  randomness: 1,
  size: 48,
  maxWidth: 800,
  lineHeight: HW.DEFAULTS.lineHeight,
  pageSize: 'letter',
  letterSpacing: 1,
  wordSpacing: 1,
  penWidth: 0.055,
  slantOn: false,
  slant: 0,
  pen: 'ink',
  paper: 'none',
  scan: true,
  doubleSided: false,
  color: '#1b2a57',
  seed: 'hello',
  sizeConsistency: HW.DEFAULTS.sizeConsistency,
  infer: true,
  ligatures: true,
  smoothness: HW.DEFAULTS.smoothness,
  penConsistency: HW.DEFAULTS.penConsistency,
  formality: HW.DEFAULTS.formality,
};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

const emptyData = () => ({ version: 1, samples: [], sentences: [], excludedUnits: [], marks: [] });

// The training data: { samples, sentences (spacing statistics), excludedUnits (deleted
// ligature forms), marks (trained strikethroughs and boxes) }. Only replaced by resetData.
export let data = load(DATA_KEY, null) || emptyData();

data.samples = data.samples || [];
data.sentences = data.sentences || [];
data.excludedUnits = data.excludedUnits || [];
data.marks = data.marks || [];

data.samples.forEach((s) => {
  if (!s.id) s.id = uid();
});

export const settings = load(SETTINGS_KEY, {});

settings.threshold = settings.threshold || HW.DEFAULTS.variantThreshold;
settings.charset = settings.charset || 'lower';
settings.gen = Object.assign({}, GEN_DEFAULTS, settings.gen || {});
// the old default line spacing (1.9) looked double-spaced
if (settings.gen.lineHeight === 1.9) settings.gen.lineHeight = GEN_DEFAULTS.lineHeight;

export const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
// the editor's list choices: the last kind used ('ul' or 'ol'), and the bullet and
// numbering last picked
export const listSettings = () =>
  (settings.list = settings.list || { last: 'ul', ul: '•', ol: { pre: '', kind: '1', post: '.' } });

// what's on screen: the open tab, and the training mode
export const ui = { tab: 'home', trainMode: 'letters' };

// The model, rebuilt when the data or the settings it depends on change.
let model = null;
let modelKey = '';
let modelDirty = true;

export const invalidateModel = () => {
  modelDirty = true;
};
export function getModel() {
  const key = settings.threshold + '|' + settings.gen.sizeConsistency;

  if (modelDirty || !model || key !== modelKey) {
    model = HW.buildModel(data, {
      variantThreshold: settings.threshold,
      sizeConsistency: settings.gen.sizeConsistency,
    });

    modelDirty = false;
    modelKey = key;
  }

  return model;
}

// Called (with no arguments) after the training data changes.
const listeners = [];

export const onDataChange = (fn) => listeners.push(fn);

// save the training data, and let everything that shows it update
export function persist() {
  modelDirty = true;

  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch {
    status('The browser has no room left to save samples. Export your data from the library to keep them.', 8000);
  }

  for (const fn of listeners) fn();
}

// delete all the training data
export function resetData() {
  data = emptyData();
  persist();
}
