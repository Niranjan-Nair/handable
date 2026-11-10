// Writing on the page. The page in the preview is the editor: the text lives in a
// hidden field (#g-text) that follows the caret, so typing, pasting, undo, IME input
// and screen readers all work as in any text field. Every time the text changes it's
// written out again, and the engine reports where each character went (the caret
// map); from that the caret, the selection and the box around an equation being
// edited are drawn over the sheet.
//  - markup (<sup>, <u>, <mark> …) is never shown: the arrow keys and Backspace step
//    over it, and the toolbar shows which formats the caret is inside
//  - an equation is shown written out until the caret goes inside it (a click, or the
//    arrow keys); then its TeX is written instead, in a dashed box
import { $, $$ } from '../dom.js';
import { listSettings, saveSettings, settings } from '../store.js';
import { caretAt, charsOn, lineStep, posAt } from './caret.js';
import { activeFormats, toggleFormat } from './formats.js';
import { leadKey, leadOf, listAutoformat } from './leads.js';
import { deleteAt, mathAround, stepLeft, stepRight, widenOverMath } from './markup.js';
import { drawOverlay } from './overlay.js';
import { createToolbar } from './toolbar.js';

// getResult(): the result of generate() on show; regenerate(): write the page again
export function createEditor({ getResult, regenerate }) {
  const ta = $('#g-text');
  const wrap = ta.closest('.page-editor');
  let raw = null; // the equation being edited: { a, b, … } (its source range, with delimiters)
  let goalX = null; // the x the caret keeps to going up and down
  let anchor = null; // where a mouse selection started

  const text = () => ta.value;
  const map = () => (getResult() && getResult().caretMap) || null;
  const focusPos = () => (ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd);
  const anchorPos = () => (ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart);

  // Makes a change (see change.js), through the field's own editing so it keeps its
  // undo history.
  function apply(c) {
    if (!c) return;

    if (c.a == null) {
      if (c.selA == null) return;

      ta.setSelectionRange(c.selA, c.selB == null ? c.selA : c.selB);
      changed();

      return;
    }

    ta.focus();
    ta.setSelectionRange(c.a, c.b);
    const ok = c.str ? document.execCommand('insertText', false, c.str) : document.execCommand('delete');

    if (!ok) {
      ta.setRangeText(c.str, c.a, c.b, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (c.selA != null) ta.setSelectionRange(c.selA, c.selB == null ? c.selA : c.selB);
    changed();
  }

  // The selection changed (or the text): the caret never stops inside a lead, and
  // going into or out of an equation writes the page again (its TeX shown, or not).
  function changed() {
    if (ta.selectionStart === ta.selectionEnd) {
      const L = leadOf(text(), ta.selectionStart);
      if (ta.selectionStart < L.b) ta.setSelectionRange(L.b, L.b);
    }

    const m =
      document.activeElement === ta && ta.selectionStart === ta.selectionEnd ? mathAround(text(), focusPos()) : null;

    const key = (x) => (x ? x.a + ':' + x.b : '');

    if (key(m) !== key(raw)) {
      raw = m;
      regenerate();

      return;
    }

    draw();
  }

  function draw() {
    toolbar.draw();
    drawOverlay(getResult(), ta, raw);
  }

  const ed = { ta, text, apply, changed, formats: () => activeFormats(text(), ta.selectionStart, ta.selectionEnd) };
  ed.toggleFormat = (k, color, off) => apply(toggleFormat(text(), ta.selectionStart, ta.selectionEnd, k, color, off));
  const toolbar = createToolbar(ed);

  function moveTo(k, extend) {
    k = Math.max(0, Math.min(text().length, k));
    if (extend) {
      const an = anchorPos();
      ta.setSelectionRange(Math.min(an, k), Math.max(an, k), k < an ? 'backward' : 'forward');
    } else ta.setSelectionRange(k, k);
    changed();
  }

  // ---- keys
  const plain = (e) => !e.altKey && !e.ctrlKey && !e.metaKey;

  // the caret keys: they move over what's written, not over the markup
  function moveKey(e) {
    const M = map();
    const k = focusPos();
    const key = e.key;
    const home = key === 'Home' || (e.metaKey && key === 'ArrowLeft');
    const end = key === 'End' || (e.metaKey && key === 'ArrowRight');

    if (home || end) {
      const li = (caretAt(M, text(), k) || { line: 0 }).line;
      const cs = charsOn(M, li);
      const L = M.lines[li];
      goalX = null;
      moveTo(home ? (cs.length ? cs[0].s : L.si) : cs.length ? cs[cs.length - 1].e : L.se, e.shiftKey);

      return true;
    }

    if ((key === 'ArrowLeft' || key === 'ArrowRight') && plain(e)) {
      goalX = null;
      if (ta.selectionStart !== ta.selectionEnd && !e.shiftKey)
        moveTo(key === 'ArrowLeft' ? ta.selectionStart : ta.selectionEnd);
      else moveTo(key === 'ArrowLeft' ? stepLeft(text(), k) : stepRight(text(), k), e.shiftKey);

      return true;
    }

    if ((key === 'ArrowUp' || key === 'ArrowDown') && plain(e)) {
      const p = caretAt(M, text(), k);
      if (!p) return true;
      if (goalX == null) goalX = p.x;
      const gx = goalX;
      moveTo(lineStep(M, text(), p, gx, key === 'ArrowUp' ? -1 : 1), e.shiftKey);
      goalX = gx;

      return true;
    }

    return false;
  }

  // the shortcuts, as in Google Docs
  const FORMAT_KEYS = { u: 'u', '.': 'sup', ',': 'sub' };
  const SHIFT_FORMAT_KEYS = { x: 's', h: 'mark' };

  function shortcut(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;

    // ⌘⇧8 bullets, ⌘⇧7 numbers
    if (e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7')) {
      toolbar.toggleList(e.code === 'Digit8' ? 'ul' : 'ol');

      return true;
    }

    // ⌘Enter: a page break (a form feed in the text), on paper
    if (e.key === 'Enter' && !e.shiftKey) {
      if (settings.gen.paper !== 'none' && !mathAround(text(), ta.selectionStart))
        apply({ a: ta.selectionStart, b: ta.selectionEnd, str: '\f' });

      return true;
    }

    const k = (e.shiftKey ? SHIFT_FORMAT_KEYS : FORMAT_KEYS)[e.key.toLowerCase()];
    if (!k) return false;

    ed.toggleFormat(k, k === 'mark' ? ed.formats().color || toolbar.lastHighlight() : undefined);

    return true;
  }

  // a key that edits: -> the change it makes, or null to let it do what it normally does
  function editKey(e) {
    const t = text();
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const collapsed = a === b;

    if (e.key === 'Backspace' && collapsed && plain(e)) {
      return deleteAt(t, focusPos(), false) || leadKey(t, a, b, 'Backspace', e.shiftKey);
    }

    if (e.key === 'Delete' && collapsed) return deleteAt(t, focusPos(), true);
    if (!plain(e)) return null;
    if (e.key === 'Tab' || e.key === 'Enter') return leadKey(t, a, b, e.key, e.shiftKey);

    if (e.key === ' ' && collapsed) {
      const auto = listAutoformat(t, a);
      if (!auto) return null;

      if (auto.ol) {
        const ls = listSettings();
        ls.last = 'ol';
        ls.ol = { pre: auto.ol.pre, kind: auto.ol.kind, post: auto.ol.post };
        saveSettings();
      }

      return auto.change;
    }

    return null;
  }

  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;

    if (map() && moveKey(e)) {
      e.preventDefault();

      return;
    }

    goalX = null;
    const change = editKey(e);
    if (change) {
      e.preventDefault();
      apply(change);
    } else if (shortcut(e)) e.preventDefault();
  });

  // Any other edit that takes away part of an equation's delimiters is widened to
  // the whole equation (see widenOverMath): taken back and done again, as one step.
  let before = null;
  let fixing = false;

  ta.addEventListener('beforeinput', () => {
    if (!fixing) before = text();
  });

  ta.addEventListener('input', (e) => {
    if (fixing || before == null) return;

    const old = before;
    before = null;
    const wide = widenOverMath(old, text());
    if (!wide) return;

    e.stopImmediatePropagation();
    fixing = true;

    try {
      ta.focus();
      document.execCommand('undo');
      if (text() !== old) ta.value = old;
      apply(wide);
    } finally {
      fixing = false;
    }
  });

  ['keyup', 'select', 'focus'].forEach((ev) => ta.addEventListener(ev, () => changed()));

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === ta) changed();
  });

  ta.addEventListener('focus', () => wrap.classList.add('editing'));

  ta.addEventListener('blur', () => {
    wrap.classList.remove('editing');
    if (raw) {
      raw = null;
      regenerate();
    } else draw();
  });

  // ---- the mouse
  // the caret position under the pointer (enterMath: a click inside an equation goes into it)
  function pointerPos(e, enterMath) {
    const sh = e.target.closest && e.target.closest('#g-preview .sheet');
    const M = map();
    if (!sh || !M) return text().length;

    const page = $$('#g-preview .sheet').indexOf(sh);
    const r = sh.getBoundingClientRect();
    const { width: W, height: H } = getResult();
    let x = ((e.clientX - r.left) / r.width) * W;
    let y = ((e.clientY - r.top) / r.height) * H;
    // undo the scan's tilt
    const sk = ((M.skews[page] || 0) * Math.PI) / 180;

    if (sk) {
      const dx = x - W / 2;
      const dy = y - H / 2;
      x = W / 2 + dx * Math.cos(sk) + dy * Math.sin(sk);
      y = H / 2 - dx * Math.sin(sk) + dy * Math.cos(sk);
    }

    return posAt(M, text(), page, x, y, enterMath);
  }

  $('#g-preview').addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !map()) return;

    e.preventDefault();
    ta.focus({ preventScroll: true });
    const k = pointerPos(e, e.detail < 2 && !e.shiftKey);
    goalX = null;

    if (e.detail === 2) {
      // a double click selects a word
      const t = text();
      let a = k;
      let b = k;
      while (a > 0 && /[\p{L}\p{N}_']/u.test(t[a - 1])) a--;
      while (b < t.length && /[\p{L}\p{N}_']/u.test(t[b])) b++;
      ta.setSelectionRange(a, b);
      changed();
    } else if (e.shiftKey) {
      moveTo(k, true);
      anchor = anchorPos();
    } else {
      moveTo(k);
      anchor = k;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (anchor == null || !(e.buttons & 1)) return;

    const k = pointerPos(e, false);
    ta.setSelectionRange(Math.min(anchor, k), Math.max(anchor, k), k < anchor ? 'backward' : 'forward');
    draw();
  });

  window.addEventListener('mouseup', () => {
    if (anchor == null) return;

    anchor = null;
    changed();
  });

  return {
    draw,
    changed,
    // where the equation being edited is, for generate(): its TeX is written instead
    rawAt: () => (raw ? raw.a + 1 : -1),
  };
}
