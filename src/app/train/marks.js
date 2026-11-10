// Train: strikethroughs and boxes.
import * as HW from '../../engine/index.js';
import { $, markChoice, status } from '../dom.js';
import { Pad } from '../pad.js';
import { data, getModel, persist, uid } from '../store.js';

// You strike through (or box) a word written in your own hand. The word's
// extent is saved with the strokes, so the generator can redraw the mark over
// any other text (see src/engine/model/marks.js).
export const markPad = new Pad($('#mark-pad'), { fluid: true, height: 240, unit: 92, baseline: 150, originX: 0 });
const MARK_WORDS = {
  strike: ['mistake', 'wrong word', 'crossed out', 'typo', 'never mind'],
  box: ['answer', 'x = 4', 'important', 'total', 'Note'],
};
const MARK_HINTS = {
  strike:
    'Cross the word out the way you normally do. One line, two lines or a scribble all work. Do it a few times, and the generator picks one of yours each time.',
  box: 'Draw a box around the word, starting wherever you usually start and leaving the gap you usually leave.',
};
let markKind = 'strike'; // or 'box'
let markIdx = 0; // which guide word
let markGuide = null; // { word, left, ref (its extent), img }
export function buildGuide() {
  const word = MARK_WORDS[markKind][markIdx % MARK_WORDS[markKind].length];
  const u = markPad.cfg.unit;
  const left = 0.8;
  const guide = { word, left, ref: null, img: null };
  markGuide = guide;
  {
    const m = getModel();
    const res = HW.generate(m, word, {
      seed: 'guide|' + word,
      size: u,
      margin: 0,
      pen: 'uniform',
      penWidth: 0.05,
      color: '#9a9ea5',
      paper: 'none',
      randomness: 0.3,
      formality: 0.8,
      maxWidth: 1e5,
    });
    if (res.ink && !res.missing.length) {
      const b0 = res.baselines[0];
      guide.ref = {
        x0: left + res.ink.minX / u,
        x1: left + res.ink.maxX / u,
        top: (res.ink.minY - b0) / u,
        bot: (res.ink.maxY - b0) / u,
        mid: -m.style.zones.X / 2,
      };
      const img = new Image();
      img.onload = () => {
        if (markGuide === guide) {
          guide.img = img;
          guide.dy = b0;
          markPad.draw();
        }
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(res.svg);
    }
  }
  $('#m-hint').textContent = MARK_HINTS[markKind];
  markPad.draw();
}
markPad.underlay = (ctx, pad) => {
  const g = markGuide;
  if (!g) return;
  const u = pad.cfg.unit;
  const x = pad.cfg.originX + g.left * u;
  if (g.img) {
    ctx.drawImage(g.img, x, pad.cfg.baseline - g.dy);
    return;
  }
  // no handwriting yet: a stand-in typeface
  ctx.save();
  ctx.fillStyle = '#9a9ea5';
  ctx.font = `${Math.round(u * 0.62)}px Kalam, "Bradley Hand", cursive`;
  ctx.fillText(g.word, x, pad.cfg.baseline);
  const mt = ctx.measureText(g.word);
  g.ref = g.ref || {
    x0: g.left,
    x1: g.left + mt.width / u,
    top: -mt.actualBoundingBoxAscent / u,
    bot: mt.actualBoundingBoxDescent / u,
    mid: -0.25,
  };
  ctx.restore();
};
export function saveMark() {
  if (markPad.isEmpty()) {
    status(markKind === 'strike' ? 'Strike through the word first' : 'Draw the box first');
    return;
  }
  if (!markGuide || !markGuide.ref) {
    status('The guide word is still loading. Try again in a moment.');
    return;
  }
  data.marks.push({
    id: uid(),
    kind: markKind,
    word: markGuide.word,
    ref: markGuide.ref,
    strokes: markPad.strokes,
    created: Date.now(),
  });
  markPad.strokes = [];
  markPad.t0 = null;
  markIdx++;
  persist();
  status(markKind === 'strike' ? 'Saved the strikethrough' : 'Saved the box');
  buildGuide();
  renderMarkCount();
}
export function renderMarkCount() {
  const n = data.marks.filter((mk) => mk.kind === markKind).length;
  $('#m-count').textContent = `${n} saved`;
}
markChoice($('#m-kind'), markKind);
$('#m-kind').addEventListener('click', (e) => {
  const b = e.target.closest('[data-val]');
  if (!b) return;
  markKind = b.dataset.val;
  markChoice($('#m-kind'), markKind);
  markPad.clear();
  buildGuide();
  renderMarkCount();
});
$('#m-undo').onclick = () => markPad.undo();
$('#m-clear').onclick = () => markPad.clear();
$('#m-next').onclick = () => {
  markIdx++;
  markPad.clear();
  buildGuide();
};
$('#m-save').onclick = saveMark;
