// The library tab: what the model learned (stats, every character's forms, joined
// letters, strikes and boxes), deleting samples, and importing / exporting the data.
import * as HW from '../engine/index.js';
import { $, download, esc, status } from './dom.js';
import { data, getModel, invalidateModel, persist, resetData, saveSettings, settings, uid } from './store.js';
import { chip } from './train/letters.js';

let libChar = null; // what's picked: a character, a ligature, or 'mark:strike' / 'mark:box'

export function renderLibrary() {
  const m = getModel();
  const chars = Object.keys(m.chars).sort();
  const inferable = data.samples.length ? HW.baseChars().filter((c) => !m.chars[c] && HW.inferInfo(m, c)) : [];
  renderStats(m, chars, inferable);
  $('#threshold').value = settings.threshold;
  $('#lib-chars').innerHTML = chars.length
    ? chars
        .map((c) => chip(c, m.chars[c].count, c === libChar ? 'sel' : '', null, m.chars[c].variants.length))
        .join('') +
      inferredChips(inferable) +
      comboChips(m) +
      markChips()
    : '<p class="muted">No samples yet.</p>';
  renderDetail();
}

function renderStats(m, chars, inferable) {
  const st = m.style;
  const nVariants = chars.reduce((a, c) => a + m.chars[c].variants.length, 0);
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $('#lib-stats').innerHTML =
    [
      stat(data.samples.length, 'samples'),
      stat(chars.length, 'trained characters'),
      stat(inferable.length, 'inferred characters'),
      stat(nVariants, 'variants'),
      stat(Object.keys(m.units).length, 'ligatures'),
      stat(data.marks.length, 'strikes and boxes'),
      stat(`${st.slantDeg.toFixed(1)}°`, 'learned slant'),
      stat(`${Math.round((st.zones.X / st.zones.A) * 100)}%`, 'x-height / ascender'),
      stat(`${st.aspect.lower.toFixed(2)}×`, 'width vs. base font'),
      stat(st.letterGap.mean.toFixed(2) + (st.letterGap.learned ? '' : '*'), 'letter gap'),
      stat(st.wordGap.mean.toFixed(2) + (st.wordGap.learned ? '' : '*'), 'word gap'),
    ].join('') +
    (st.letterGap.learned
      ? ''
      : '<span class="muted small">* A default value. Write a few sentences under Train and the app learns your spacing.</span>');
}

const note = (text) => `<p class="grid-note muted small">${text}</p>`;

function inferredChips(inferable) {
  if (!inferable.length) return '';
  return (
    note('Worked out from your writing, not trained') +
    inferable
      .map(
        (c) =>
          `<button class="chip inferred ${c === libChar ? 'sel' : ''}" data-ch="${esc(c)}" title="inferred">${esc(c)}</button>`,
      )
      .join('')
  );
}

function comboChips(m) {
  const combos = HW.linkStats(m).combos.filter((c) => c.c > 0);
  if (!combos.length) return note('No joined letters yet. Write some under Train, in Joined letters.');
  return (
    note('Joined letters, with how many times you joined them out of how many you wrote') +
    combos
      .map(
        (c) =>
          `<button class="chip combo ${c.s === libChar ? 'sel' : ''}" data-ch="${esc(c.s)}">${esc(c.s)}<span class="n">${c.c}/${c.n}</span></button>`,
      )
      .join('')
  );
}

function markChips() {
  const n = (k) => data.marks.filter((mk) => mk.kind === k).length;
  return (
    note('Strikethroughs and boxes') +
    ['strike', 'box']
      .map(
        (k) =>
          `<button class="chip combo ${libChar === 'mark:' + k ? 'sel' : ''}" data-ch="mark:${k}">${k}<span class="n">${n(k)}</span></button>`,
      )
      .join('')
  );
}

// a dozen freshly written copies of ch
function synthRow(m, ch) {
  const gs = settings.gen;
  let row = '';
  for (let i = 0; i < 12; i++) {
    const g = HW.sampleGlyph(m, ch, {
      seed: `${ch}-${i}-${Date.now()}`,
      randomness: gs.randomness,
      smoothness: gs.smoothness,
      penConsistency: gs.penConsistency,
      formality: gs.formality,
    });
    if (g) row += `<div class="thumb synth">${HW.glyphSVG(g, { box: 64, guides: true })}</div>`;
  }
  return row;
}

// new copies, written again when clicked (note: what to say about them first)
const attemptsRow = (row, note = '') =>
  `<div class="variant"><h3>New attempts <small>${note}Click them for another set.</small></h3><div class="thumbs" id="synth-row">${row}</div></div>`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// a saved strike or box, drawn with the guide word's position as a faint box
function markThumb(mk) {
  const pts = mk.strokes.map((st) => st.map((q) => ({ x: +q[0], y: +q[1], w: 1 })));
  const minX = Math.min(...pts.flat().map((q) => q.x));
  pts.forEach((st) =>
    st.forEach((q) => {
      q.x -= minX;
    }),
  );
  const width = Math.max(...pts.flat().map((q) => q.x));
  return HW.glyphSVG({ strokes: pts, width }, { box: 64 });
}

function renderDetail() {
  const m = getModel();
  const el = $('#lib-detail');
  if (libChar && libChar.startsWith('mark:')) el.innerHTML = markDetail(m, libChar.slice(5));
  else if (libChar && m.units[libChar]) el.innerHTML = unitDetail(m, libChar);
  else if (libChar && m.chars[libChar]) el.innerHTML = charDetail(m, libChar);
  else {
    const info = libChar && data.samples.length ? HW.inferInfo(m, libChar) : null;
    el.innerHTML = info
      ? inferredDetail(m, libChar, info)
      : '<p class="muted">Pick a character to see the forms the app learned.</p>';
  }
}

const detailTitle = (ch) => `<h2 class="detail-title">${esc(ch)}</h2>`;

function markDetail(m, kind) {
  const list = data.marks.filter((mk) => mk.kind === kind);
  let html = `<div class="row"><h2 class="detail-title">${kind === 'strike' ? 'Strikethroughs' : 'Boxes'}</h2><span class="muted">${list.length} saved</span></div>`;
  if (!list.length)
    html += `<p class="hint">None yet. Until you train some, the generator draws a plain line or box in your pen. Add yours under Train, in Strikes and boxes.</p>`;
  const demo = kind === 'strike' ? '<s>crossed out</s>' : '<box>boxed</box>';
  let attempts = '';
  if (data.samples.length) {
    for (let i = 0; i < 4; i++) {
      const opts = {
        ...settings.gen,
        slant: null,
        seed: `${kind}-${i}-${Date.now()}`,
        size: 30,
        margin: 14,
        paper: 'none',
        maxWidth: 1e5,
      };
      attempts += `<div class="thumb synth">${HW.generate(m, demo, opts).svg}</div>`;
    }
  }
  if (attempts) html += attemptsRow(attempts);
  if (list.length) {
    html += `<div class="variant"><h3>Yours</h3><div class="thumbs">`;
    for (const mk of list)
      html += `<div class="thumb" title="Drawn over “${esc(mk.word || '')}”">${markThumb(mk)}<button class="del" data-delmark="${esc(mk.id)}" title="Delete this one">×</button></div>`;
    html += '</div></div>';
  }
  return html;
}

// a ligature: its forms, and how often it's joined
function unitDetail(m, s) {
  const unit = m.units[s];
  const ls = HW.linkStats(m);
  const st = ls.combos.find((c) => c.s === s) || { n: 0, c: 0 };
  let html =
    `<div class="row">${detailTitle(s)}<span class="muted">You joined these ${st.c} of the ${st.n} times you wrote them (${Math.round((st.c / Math.max(1, st.n)) * 100)}%).</span></div>
    <p class="hint">When ${esc(s)} comes up in your text, it's written with one of your joined versions about that often.
    The rest of the time the letters are written separately. Deleting a form removes it from the examples and the count,
    and keeps the single letters.</p>` + attemptsRow(synthRow(m, s));
  unit.variants.forEach((v, i) => {
    html += `<div class="variant"><h3>Form ${i + 1} <small>${plural(v.weight, 'sample')}, ${Math.round((v.weight / unit.count) * 100)}%</small></h3><div class="thumbs">`;
    for (const g of v.members)
      html += `<div class="thumb" title="From your joined writing">${HW.glyphSVG(g, { box: 64, guides: true })}<button class="del" data-delunit="${esc(g.id)}" title="Delete this form">×</button></div>`;
    html += '</div></div>';
  });
  const outs = ls.outs
    .slice(0, 8)
    .map((o) => `${esc(o.a)} ${Math.round((o.c / o.n) * 100)}%`)
    .join(', ');
  if (outs) html += `<p class="hint">The letters you most often join to the next one are ${outs}.</p>`;
  return html;
}

// an untrained character the model can build from your other letters
function inferredDetail(m, ch, info) {
  const pct = Math.round((info.matched / info.total) * 100);
  const sources = info.sources.length
    ? `Built from pieces of your ${info.sources.map((c) => `<b>${esc(c)}</b>`).join(', ')}.`
    : 'None of your letters had a matching piece.';
  return (
    `<div class="row">${detailTitle(ch)}<span class="muted">Worked out, not trained</span></div>
    <p class="hint">${sources}
    ${pct}% of its strokes come from your own writing. The rest follow a standard letter shape, stretched and slanted
    to match yours. If you train this character, your samples replace this.</p>` + attemptsRow(synthRow(m, ch))
  );
}

// a trained character: its forms (variants) and their samples
function charDetail(m, ch) {
  const entry = m.chars[ch];
  const n = entry.variants.length;
  let html =
    `<div class="row">${detailTitle(ch)}
    <span class="muted">${entry.count} samples in ${n} form${n > 1 ? 's' : ''}</span></div>` +
    attemptsRow(synthRow(m, ch), `At randomness ${settings.gen.randomness}. `);
  entry.variants.forEach((v, i) => {
    const pct = Math.round((v.weight / entry.count) * 100);
    const ctxs = ['start', 'mid', 'end']
      .filter((k) => v.ctx[k])
      .map((k) => `${k}: ${v.ctx[k]}`)
      .join(', ');
    const consistency =
      v.spread == null ? 'one sample' : v.spread < 0.04 ? 'very consistent' : v.spread < 0.08 ? 'consistent' : 'loose';
    html += `<div class="variant"><h3>Form ${i + 1} <small>${plural(v.weight, 'sample')}, used ${pct}% of the time, ${consistency}${ctxs ? '. In words, ' + ctxs : ''}</small></h3><div class="thumbs">`;
    for (const g of v.members)
      html += `<div class="thumb" title="Shown after evening out the size">${HW.glyphSVG(g, { box: 64, guides: true })}<button class="del" data-del="${esc(g.id)}" title="Delete sample">×</button></div>`;
    html += '</div></div>';
  });
  return html;
}

// ---- picking and deleting
$('#lib-chars').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ch]');
  if (!b) return;
  libChar = b.dataset.ch;
  renderLibrary();
});
$('#lib-detail').addEventListener('click', (e) => {
  const sample = e.target.closest('[data-del]');
  if (sample) {
    data.samples = data.samples.filter((s) => s.id !== sample.dataset.del);
    persist();
    status('Sample deleted');
    return;
  }
  const mark = e.target.closest('[data-delmark]');
  if (mark) {
    data.marks = data.marks.filter((mk) => mk.id !== mark.dataset.delmark);
    persist();
    status('Deleted');
    return;
  }
  const unit = e.target.closest('[data-delunit]');
  if (unit) {
    if (!data.excludedUnits.includes(unit.dataset.delunit)) data.excludedUnits.push(unit.dataset.delunit);
    persist();
    if (!getModel().units[libChar]) libChar = null; // last form of this ligature deleted
    renderLibrary();
    status('Ligature form deleted');
    return;
  }
  if (e.target.closest('#synth-row')) renderDetail();
});
$('#threshold').addEventListener('input', (e) => {
  settings.threshold = +e.target.value;
  saveSettings();
  invalidateModel();
  renderLibrary();
});

// ---- the data as a file
$('#export').onclick = () => download(JSON.stringify(data), 'handwriting-data.json', 'application/json');
$('#import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const added = importData(JSON.parse(await f.text()));
    persist();
    status(`Imported ${added} samples`);
  } catch (err) {
    status('Import failed: ' + err.message, 5000);
  }
  e.target.value = '';
});
$('#wipe').onclick = () => {
  if (!confirm('Delete all training samples? Export first if you want to keep them.')) return;
  resetData();
};

// merge exported data d into ours (skipping what we already have) -> samples added
function importData(d) {
  if (!Array.isArray(d.samples)) throw new Error('no samples array');
  const ids = new Set(data.samples.map((s) => s.id));
  let added = 0;
  for (const s of d.samples) {
    if (!s.char || !Array.isArray(s.strokes)) continue;
    if (!s.id) s.id = uid();
    if (ids.has(s.id)) continue;
    data.samples.push(s);
    ids.add(s.id);
    added++;
  }
  const texts = new Set(data.sentences.map((s) => s.created + s.text));
  for (const s of d.sentences || []) if (!texts.has(s.created + s.text)) data.sentences.push(s);
  for (const id of d.excludedUnits || []) if (!data.excludedUnits.includes(id)) data.excludedUnits.push(id);
  const markIds = new Set(data.marks.map((mk) => mk.id));
  for (const mk of d.marks || []) if (mk && mk.id && !markIds.has(mk.id)) data.marks.push(mk);
  return added;
}
