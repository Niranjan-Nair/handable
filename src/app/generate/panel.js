// The generate tab's settings: every control (#g-<key>) is bound to settings.gen[key].
import { $, $$, status } from '../dom.js';
import { GEN_DEFAULTS, getModel, saveSettings, settings } from '../store.js';
import { runGen, scheduleGen, textChanged } from './preview.js';

const GEN_KEYS =
  'text randomness size maxWidth lineHeight smoothness penConsistency formality pageSize sizeConsistency infer ligatures letterSpacing wordSpacing penWidth slantOn slant pen paper scan doubleSided color seed'.split(
    ' ',
  );

// the values shown next to the controls, and the controls that apply
export function updateOutputs() {
  const g = settings.gen;

  const set = (k, v) => {
    const o = $('#o-' + k);
    if (o) o.textContent = v;
  };

  set('randomness', (+g.randomness).toFixed(2));
  set('size', g.size + 'px');
  set('maxWidth', g.maxWidth + 'px');
  set('lineHeight', (+g.lineHeight).toFixed(2));
  set('sizeConsistency', Math.round(g.sizeConsistency * 100) + '%');
  set('smoothness', Math.round(g.smoothness * 100) + '%');
  set('penConsistency', Math.round(g.penConsistency * 100) + '%');
  set('formality', Math.round(g.formality * 100) + '%');
  set('letterSpacing', (+g.letterSpacing).toFixed(2) + '×');
  set('wordSpacing', (+g.wordSpacing).toFixed(2) + '×');
  set('penWidth', `${(g.penWidth * g.size).toFixed(1)}px`);
  set('slant', g.slantOn ? `${g.slant}°` : `(learned ${getModel().style.slantDeg.toFixed(1)}°)`);
  $('#g-slant').disabled = !g.slantOn;
  // paper = real pages: page size matters, line width is set by the page
  $('#g-page-row').hidden = g.paper === 'none';
  $('#g-doubleSided-row').hidden = g.paper !== 'lined';
  $('#g-width-row').hidden = g.paper !== 'none';

  // choosers & swatches reflect the current values
  $$('.chooser[data-for]').forEach((c) => {
    const v = settings.gen[c.dataset.for.slice(2)];
    c.querySelectorAll('[data-val]').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
  });

  $$('.swatches [data-color]').forEach((b) =>
    b.classList.toggle('on', b.dataset.color.toLowerCase() === String(g.color).toLowerCase()),
  );
}

const INK_DEFAULT = GEN_DEFAULTS.color;
const GRAPHITE = '#45454b';

// set a control's value, as if it had been changed by hand
function setGen(k, v) {
  const el = $('#g-' + k);
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v;
  el.dispatchEvent(new Event('input'));
}

$$('.chooser[data-for] [data-val]').forEach((b) =>
  b.addEventListener('click', () => {
    const key = b.closest('.chooser').dataset.for.slice(2);

    if (key === 'pen') {
      // pencil defaults to graphite; going back to a pen restores the ink color
      const c = String(settings.gen.color).toLowerCase();
      if (b.dataset.val === 'pencil' && c === INK_DEFAULT) setGen('color', GRAPHITE);
      else if (b.dataset.val !== 'pencil' && c === GRAPHITE) setGen('color', INK_DEFAULT);
    }

    setGen(key, b.dataset.val);
  }),
);

$$('.swatches [data-color]').forEach((b) => b.addEventListener('click', () => setGen('color', b.dataset.color)));

$('#g-reset').onclick = () => {
  const text = settings.gen.text;
  settings.gen = Object.assign({}, GEN_DEFAULTS, { text });

  for (const k of GEN_KEYS) {
    const el = $('#g-' + k);
    if (el.type === 'checkbox') el.checked = !!settings.gen[k];
    else el.value = settings.gen[k];
  }

  saveSettings();
  updateOutputs();
  runGen();
  status('Settings reset');
};

$('#g-fit').addEventListener('change', (e) => $('#g-preview').classList.toggle('fit', e.target.checked));

for (const k of GEN_KEYS) {
  const el = $('#g-' + k);
  if (el.type === 'checkbox') el.checked = !!settings.gen[k];
  else el.value = settings.gen[k];

  el.addEventListener('input', () => {
    settings.gen[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;

    if (k === 'slantOn' && el.checked) {
      settings.gen.slant = Math.round(getModel().style.slantDeg);
      $('#g-slant').value = settings.gen.slant;
    }

    saveSettings();
    updateOutputs();
    if (k === 'text') textChanged();
    else scheduleGen();
  });
}
