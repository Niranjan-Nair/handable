// Train: sentences and joined letters. Both are written on one line and split
// into letters. Sentences teach the spacing between letters and words (and which
// forms start and end words); joined letters ("ge ge ge ge") teach the joins.
import * as HW from '../../engine/index.js';
import { $, clamp, esc, markChoice, status } from '../dom.js';
import { Pad } from '../pad.js';
import { data, getModel, persist, saveSettings, settings, ui, uid } from '../store.js';

// Both are written on one line and split into letters. Sentences teach the
// spacing between letters and words (and which forms start and end words);
// joined letters ("ge ge ge ge") teach the joins.
export const sentencePad = new Pad($('#sentence-pad'), {
  fluid: true,
  height: 250,
  unit: 84,
  baseline: 155,
  originX: 0,
});

let segGroups = null; // the letters found in the writing (being checked)
let segMissing = []; // letters of the text that weren't found
const SEG_COLORS = ['#1f2b5b', '#b0414b', '#2f6a4d', '#6b3f94', '#8f6512'];
const DEFAULT_S_INFO = $('#s-info').innerHTML;

const SENTENCE_INFO =
  'When you’ve written it, save. The app reads it and finds each letter, comparing the ink with your own letter shapes. If anything looks unclear it stops so you can check first.';

// short enough to fit on the pad at a comfortable size, and between them they
// cover every letter, a few capitals, digits and the common punctuation
const PROMPTS = [
  'the quick brown fox jumps',
  'over the lazy dog.',
  'Pack my box with five dozen jugs.',
  'Jackdaws love my big sphinx.',
  'The five boxing wizards jump.',
  'Waltz, bad nymph, for quick jigs.',
  'How vexingly quick zebras jump!',
  'see you at 9:30 on the 14th',
  'yes, I will be there soon',
  'it was a very good day',
  'Call me at 555 0187, okay?',
  'a fresh cup of tea',
  // short ones, so a phone-sized pad still has sentences that fit
  'good morning',
  'yes, see you',
  'a big jump',
  'Okay, fine.',
];

// The pad keeps the text on one line: the guides shrink for longer text, so the
// writing fits (strokes are stored in units, so the size doesn't change what's
// learned). How wide the text will come out is measured with your own model.
const PAD_MIN_UNIT = 44;
const PAD_MAX_UNIT = 84;

function writtenWidth(text) {
  try {
    return (
      HW.generate(getModel(), text, { size: 100, margin: 0, maxWidth: 1e6, seed: 'fit', randomness: 0 }).width / 100
    );
  } catch {
    return text.length * 0.45; // a rough guess
  }
}

const padRoom = () => ((sentencePad.c.clientWidth || 900) - 30) * 0.9; // a little slack for writing bigger than usual
const unitFor = (text) => padRoom() / Math.max(1, writtenWidth(text) + 0.6);

export function fitSentencePad() {
  const unit = clamp(unitFor($('#s-text').value || 'abcdefghij'), PAD_MIN_UNIT, PAD_MAX_UNIT);
  if (Math.abs(unit - sentencePad.cfg.unit) < 0.5) return;

  sentencePad.cfg.unit = unit;
  sentencePad.cfg.height = Math.round(unit * 2.98);
  sentencePad.cfg.baseline = Math.round(unit * 1.85);
  sentencePad.resize();
}

window.addEventListener('resize', () => {
  if (ui.trainMode !== 'letters') fitSentencePad();
});

function onTextChange() {
  $('#s-target').textContent = $('#s-text').value;
  fitSentencePad();

  if (segGroups) {
    readPad();
    updateSeg();
  }
}

export function setPrompt(i) {
  // on a narrow pad, skip sentences that wouldn't fit at a comfortable size
  for (let k = 0; k < PROMPTS.length; k++) {
    const j = (((i + k) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length;

    if (unitFor(PROMPTS[j]) >= PAD_MIN_UNIT) {
      i = j;
      break;
    }
  }

  settings.prompt = ((i % PROMPTS.length) + PROMPTS.length) % PROMPTS.length;
  saveSettings();
  exitSegEdit();
  sentencePad.clear();
  $('#s-text').value = PROMPTS[settings.prompt];
  onTextChange();
}

$('#s-another').onclick = () => setPrompt((settings.prompt || 0) + 1);

const targetLabels = () => Array.from($('#s-text').value.replace(/\s+/g, ''));

// Read the pad: find each letter of the text in the ink, or (after the boxes
// were fixed by hand) just work out which letter each box is.
function readPad(fixed) {
  const text = $('#s-text').value;
  const m = getModel();
  const r = fixed ? HW.labelGroups(segGroups, text, m) : HW.readLine(sentencePad.strokes, text, m);
  segGroups = r.groups;
  segMissing = r.missing.map((j) => r.labels[j].ch);
}

// which neighbouring letters were written without lifting the pen
function segLinks() {
  return segGroups.slice(1).map((g, i) => {
    const a = segGroups[i].label;
    const b = g.label;

    return !!(a && b && a.word === b.word && a.i + 1 === b.i && HW.joinBetween(segGroups[i], g));
  });
}

function drawSeg(ctx, pad) {
  segGroups.forEach((g, i) => {
    // unlabeled ink is grey; a letter that didn't match well is red
    const color = !g.label ? '#9a9a9a' : g.sure ? SEG_COLORS[i % SEG_COLORS.length] : '#cf3b47';
    const [x0, y0] = pad.toPx(g.minX - 0.03, g.minY - 0.03);
    const [x1, y1] = pad.toPx(g.maxX + 0.03, g.maxY + 0.03);
    ctx.fillStyle = color + '14';
    ctx.strokeStyle = color + '66';
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    for (const s of g.strokes) pad.drawStroke(s, color);
    ctx.fillStyle = color;
    ctx.font = '700 17px Kalam, "Bradley Hand", cursive';
    ctx.textAlign = 'center';
    ctx.fillText(!g.label ? '·' : g.label.ch + (g.sure ? '' : '?'), (x0 + x1) / 2, Math.max(14, y0 - 5));
  });

  // mark detected joins (pen stayed down between letters)
  segLinks().forEach((linked, i) => {
    if (!linked) return;

    const a = segGroups[i];
    const b = segGroups[i + 1];
    const [x, y] = pad.toPx((a.maxX + b.minX) / 2, Math.max(a.maxY, b.maxY) + 0.12);
    ctx.strokeStyle = '#2f6a4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 6, 7, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#2f6a4d';
    ctx.font = '400 13px Kalam, "Bradley Hand", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('joined', x, y + 10);
  });
}

// anything worth a second look before saving
const segDoubts = () => segGroups.some((g) => !g.label || !g.sure) || segMissing.length > 0;

// what the app read in the writing, under the pad
function updateSeg() {
  const doubts = segDoubts();

  $('#s-info').innerHTML =
    `<b class="${doubts ? 'bad' : 'good'}">Read ${segGroups.filter((g) => g.label).length} of ${targetLabels().length} letters.</b> ` +
    segNotes() +
    `Click inside a box to split it there. Shift-click or right-click a box to join it to the next one.` +
    (doubts ? ' Save keeps only the clear letters.' : ' If it all looks right, save it.') +
    joinedNote();

  sentencePad.draw();
}

// what's wrong with the reading, if anything
function segNotes() {
  const unclear = segGroups.filter((g) => g.label && !g.sure).length;
  const notes = [];

  if (unclear) {
    const one = unclear === 1;

    notes.push(
      `${one ? 'One letter' : unclear + ' letters'} in red didn’t match your usual shapes, so ${one ? 'it' : 'they'} won’t be saved.`,
    );
  }

  if (segMissing.length)
    notes.push(`Couldn’t find ${esc(segMissing.map((c) => '“' + c + '”').join(', '))} in the writing.`);
  if (segGroups.some((g) => !g.label)) notes.push('Grey marks aren’t part of any letter.');

  return notes.length ? notes.join(' ') + ' ' : '';
}

function joinedNote() {
  const joined = segLinks()
    .map((linked, i) => (linked ? `${segGroups[i].label.ch}→${segGroups[i + 1].label.ch}` : null))
    .filter(Boolean);

  if (!joined.length) return '';

  return `<br><span class="good">You joined ${esc(joined.join(', '))}. The app will learn the shape of the join and how often you make it.</span>`;
}

function enterSegEdit() {
  if (sentencePad.isEmpty()) {
    status('Write the letters first');

    return false;
  }

  readPad();
  sentencePad.overlay = drawSeg;
  sentencePad.tapHandler = onSegTap;
  sentencePad.c.classList.add('tap');
  $('#s-edit').hidden = false;
  $('#s-segment').hidden = true;
  updateSeg();

  return true;
}

export function exitSegEdit() {
  segGroups = null;
  segMissing = [];
  sentencePad.overlay = null;
  sentencePad.tapHandler = null;
  sentencePad.c.classList.remove('tap');
  $('#s-edit').hidden = true;
  $('#s-segment').hidden = false;
  $('#s-info').innerHTML = ui.trainMode === 'sentences' ? SENTENCE_INFO : DEFAULT_S_INFO;
  sentencePad.draw();
}

function onSegTap(x, y, e) {
  let best = -1;
  let bd = Infinity;

  segGroups.forEach((g, i) => {
    if (x >= g.minX - 0.04 && x <= g.maxX + 0.04) {
      const d = Math.abs(x - (g.minX + g.maxX) / 2);

      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  });

  if (best < 0) return;

  if (e.shiftKey || e.altKey || e.button === 2) {
    segGroups = HW.mergeAt(segGroups, best === segGroups.length - 1 ? best - 1 : best);
  } else {
    segGroups = HW.splitAt(segGroups, best, x);
  }

  readPad(true);
  updateSeg();
}

export function saveSentence() {
  const text = $('#s-text').value.trim();

  if (!text) {
    status(ui.trainMode === 'sentences' ? 'Pick a sentence to write first' : 'Choose some letters to write first');

    return;
  }

  if (!segGroups) {
    if (!enterSegEdit()) return;

    // stop for a check if anything was unclear; otherwise save straight away
    if (segDoubts()) {
      status('Some letters were unclear. Check them, then save again.', 4000);

      return;
    }
  }

  const { samples, stats, unclear } = HW.sentenceToSamples(segGroups, text, uid);

  if (!samples.length) {
    status('Nothing was clear enough to save. Fix the boxes, or clear it and write it again.', 4500);

    return;
  }

  data.samples.push(...samples);
  data.sentences.push(stats);
  exitSegEdit();
  sentencePad.strokes = [];
  sentencePad.t0 = null;
  sentencePad.draw();
  persist();
  status(`Saved ${samples.length} letters` + (unclear ? `, left out ${unclear} unclear` : ''));
  if (ui.trainMode === 'sentences') setPrompt((settings.prompt || 0) + 1);
  else renderComboSuggest();
}

$('#s-undo').onclick = () => {
  exitSegEdit();
  sentencePad.undo();
};

$('#s-clear').onclick = () => {
  exitSegEdit();
  sentencePad.clear();
};

$('#s-segment').onclick = () => enterSegEdit();
$('#s-edit').onclick = () => exitSegEdit();
$('#s-save').onclick = saveSentence;

// ------------------------------------------------ combos & ligatures
const COMMON_COMBOS =
  'ge th he in er an re on at en nd es or te ed is it ar st to ng ou ea ch sh wh gh ck qu ly oo ee ll ss tt ing the and ion ent'.split(
    ' ',
  );

export function setCombo(c) {
  c = (c || '').replace(/\s+/g, '');
  $('#c-combo').value = c;
  settings.combo = c;
  saveSettings();
  if (!c) return;

  $('#s-text').value = Array(+settings.comboTimes || 4)
    .fill(c)
    .join(' ');

  onTextChange();
}
export function renderComboSuggest() {
  const ls = HW.linkStats(getModel());
  const seen = {};

  ls.combos.forEach((c) => {
    seen[c.s] = c;
  });

  const learned = ls.combos.filter((c) => c.c > 0).map((c) => c.s);
  const list = Array.from(new Set(learned.concat(COMMON_COMBOS)));

  $('#c-suggest').innerHTML = list
    .map((c) => {
      const st = seen[c];

      return `<button data-combo="${esc(c)}" class="${st && st.c ? 'learned' : ''}">${esc(c)}${st ? ` <small>${st.c}/${st.n}</small>` : ''}</button>`;
    })
    .join('');
}

$('#c-combo').addEventListener('input', (e) => setCombo(e.target.value));
markChoice($('#c-times'), settings.comboTimes || 4);

$('#c-times').addEventListener('click', (e) => {
  const b = e.target.closest('[data-val]');
  if (!b) return;

  settings.comboTimes = +b.dataset.val;
  markChoice($('#c-times'), settings.comboTimes);
  setCombo($('#c-combo').value);
});

$('#c-suggest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-combo]');
  if (b) setCombo(b.dataset.combo);
});
