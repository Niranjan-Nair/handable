// The train tab: its modes (letters, joined letters, sentences, strikes and boxes)
// and keyboard shortcuts.
import { $, $$ } from '../dom.js';
import { settings, ui } from '../store.js';
import { letterPad, renderLetterGrid, saveLetter, stepChar } from './letters.js';
import { buildGuide, markPad, renderMarkCount, saveMark } from './marks.js';
import {
  exitSegEdit,
  fitSentencePad,
  renderComboSuggest,
  saveSentence,
  sentencePad,
  setCombo,
  setPrompt,
} from './sentences.js';

export { renderLetterGrid };

// the tab has just been opened: the pads take their size from the page
export function showTrainTab() {
  letterPad.resize();
  if (ui.trainMode === 'combos' || ui.trainMode === 'sentences') {
    sentencePad.resize();
    fitSentencePad();
  }
  if (ui.trainMode === 'marks') {
    markPad.resize();
    buildGuide();
  }
}

// switching between the training modes
$$('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    ui.trainMode = b.dataset.mode;
    $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#letters-mode').hidden = ui.trainMode !== 'letters';
    $('#combos-mode').hidden = ui.trainMode !== 'combos' && ui.trainMode !== 'sentences';
    $('#combo-only').hidden = ui.trainMode !== 'combos';
    $('#sentence-only').hidden = ui.trainMode !== 'sentences';
    $('#s-another').hidden = ui.trainMode !== 'sentences';
    $('#marks-mode').hidden = ui.trainMode !== 'marks';
    exitSegEdit();
    if (ui.trainMode === 'combos') {
      sentencePad.resize();
      renderComboSuggest();
      setCombo($('#c-combo').value || settings.combo || 'ge');
    }
    if (ui.trainMode === 'sentences') {
      sentencePad.resize();
      setPrompt(settings.prompt || 0);
    }
    if (ui.trainMode === 'marks') {
      markPad.resize();
      buildGuide();
      renderMarkCount();
    }
  }),
);

// keyboard shortcuts (train tab)
document.addEventListener('keydown', (e) => {
  if (ui.tab !== 'train') return;
  const typing = e.target.matches('input, textarea, select');
  const pad = ui.trainMode === 'letters' ? letterPad : ui.trainMode === 'marks' ? markPad : sentencePad;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (ui.trainMode === 'combos' || ui.trainMode === 'sentences') exitSegEdit();
    pad.undo();
    return;
  }
  if (typing) return;
  if (e.key === 'Escape') {
    if (ui.trainMode === 'combos' || ui.trainMode === 'sentences') exitSegEdit();
    pad.clear();
  } else if (ui.trainMode === 'letters') {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLetter(!e.shiftKey);
    } else if (e.key === 'ArrowRight') stepChar(1);
    else if (e.key === 'ArrowLeft') stepChar(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (ui.trainMode === 'marks') saveMark();
    else saveSentence();
  }
});
