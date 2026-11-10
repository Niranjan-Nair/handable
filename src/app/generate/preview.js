// The generate tab's page: the text written out (the page is also the editor, see
// editor/editor.js), and saving it as SVG or PDF.
import * as HW from '../../engine/index.js';
import { $, download, status } from '../dom.js';
import { createEditor } from '../editor/editor.js';
import { svgPagesToPDF } from '../pdf.js';
import { data, getModel, saveSettings, settings, ui } from '../store.js';

let lastRes = null; // the last result of HW.generate, as shown
let lastGenMs = 0; // how long writing it took
let genTimer = null;

const editor = createEditor({ getResult: () => lastRes, regenerate: () => runGen() });

// the options for HW.generate, from the settings
const genOptions = (extra) => {
  const g = settings.gen;

  return { ...g, slant: g.slantOn ? g.slant : null, ...extra };
};

export function scheduleGen(delay = 120) {
  clearTimeout(genTimer);
  genTimer = setTimeout(runGen, delay);
}

// Typing on the page: written out straight away. While a key is held the repeats
// keep coming, so a rewrite already waiting isn't pushed back (it picks up the
// latest text when it runs); long pages get a short gap so the browser can still
// draw and take keys in between.
export function textChanged() {
  if (genTimer == null) genTimer = setTimeout(runGen, lastGenMs > 60 ? Math.min(80, lastGenMs / 2) : 0);
}

export function runGen() {
  clearTimeout(genTimer);
  genTimer = null;
  if (ui.tab !== 'generate') return;

  const pv = $('#g-preview');

  if (!data.samples.length) {
    pv.innerHTML =
      '<p class="muted empty">There\'s nothing to write with yet. Go to Train and write some characters first.</p>';

    $('#g-missing').textContent = '';
    $('#g-inferred').textContent = '';

    return;
  }

  const t0 = performance.now();
  // on paper, the page comes as layers (see showLayers); the whole pages, for
  // downloads, are written when one is asked for (fullRes)
  const res = HW.generate(getModel(), settings.gen.text, genOptions({ rawAt: editor.rawAt(), layers: true }));
  lastGenMs = performance.now() - t0;
  lastRes = res;
  showSheets(pv, res);
  editor.draw();
  $('#g-pages').textContent = res.page ? `${res.nPages} page${res.nPages > 1 ? 's' : ''}` : '';

  $('#g-missing').textContent = res.missing.length
    ? `Left blank because the app can't write them: ${res.missing.join(' ')}`
    : '';

  $('#g-inferred').textContent = [
    res.ligatures.length ? `Joined the way you join them: ${res.ligatures.join(' ')}.` : '',
    res.inferred.length ? `Worked out from your other letters: ${res.inferred.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// the result's pages in the preview, reusing the sheets already there
function showSheets(pv, res) {
  pv.classList.toggle('paged', !!res.page);
  const kind = res.layers ? 'sheet layered' : res.page ? 'sheet' : 'sheet free';
  let have = [...pv.children].filter((el) => el.classList.contains('sheet'));

  if (have.length !== pv.children.length || have.some((el) => el.className !== kind)) {
    pv.innerHTML = '';
    have = [];
  }

  const n = res.layers ? res.layers.length : 1;

  for (let i = 0; i < n; i++) {
    let el = have[i];

    if (!el) {
      el = document.createElement('div');
      el.className = kind;
      pv.appendChild(el);
    }

    if (res.layers) showLayers(el, res.layers[i], res.width, res.height);
    else if (el._svg !== res.svg) {
      el.innerHTML = res.svg;
      el._svg = res.svg;
    }
  }

  for (let i = n; i < have.length; i++) {
    dropLayers(have[i]);
    have[i].remove();
  }
}

// A page on screen as its layers: the paper as a picture (drawn once, and again only
// when it changes), and the writing as a strip per line on top, multiplied onto it like
// ink. Typing changes a strip or two, so only those are drawn again, not the page and
// its paper texture, pencil grain and scan effects.
function showLayers(el, L, W, H) {
  if (el._paper !== L.paper) showPaper(el, L.paper, W);
  const old = el._strips || new Map();
  const now = new Map();

  for (const s of L.strips) {
    let d = old.get(s.svg);

    if (d) old.delete(s.svg);
    else {
      d = document.createElement('div');
      d.className = 'strip';
      d.style.top = (s.y / H) * 100 + '%';
      d.style.height = (s.h / H) * 100 + '%';
      d.innerHTML = s.svg;
      el.appendChild(d);
    }

    now.set(s.svg, d);
  }

  for (const d of old.values()) d.remove();
  el._strips = now;
}

function showPaper(el, paper, W) {
  el._paper = paper;
  const url = URL.createObjectURL(new Blob([paper], { type: 'image/svg+xml' }));
  const img = new Image();
  img.className = 'paper';
  img.alt = '';
  img.width = W;
  img.src = url;

  // the new paper replaces the old once it's ready, so there's no blank frame
  const swap = () => {
    if (el._paper !== paper) return URL.revokeObjectURL(url);

    const old = el.querySelector('img.paper');
    if (old) {
      URL.revokeObjectURL(old.src);
      old.replaceWith(img);
    } else el.prepend(img);
  };

  // (the first paper goes in straight away: it gives the page its size)
  if (!el.querySelector('img.paper')) swap();
  else img.decode().then(swap, swap);
}

function dropLayers(el) {
  const img = el.querySelector('img.paper');
  if (img) URL.revokeObjectURL(img.src);
}

// the whole pages, for a download (written out properly: an equation being edited is
// shown on the page as its TeX)
const fullRes = () => HW.generate(getModel(), settings.gen.text, genOptions({ rawAt: null }));

$('#g-reroll').onclick = () => {
  settings.gen.seed = Math.random().toString(36).slice(2, 8);
  $('#g-seed').value = settings.gen.seed;
  saveSettings();
  runGen();
};

$('#g-download').onclick = () => {
  if (lastRes) download(fullRes().svg, 'handwriting.svg', 'image/svg+xml');
};

$('#g-pdf').onclick = async () => {
  if (!lastRes) return;

  const res = fullRes();
  const btn = $('#g-pdf');

  // paper: Letter / A4 sheets; transparent: one page the size of the writing (at 96 px/in)
  const size = res.page
    ? { pxW: res.width, pxH: res.height, ptW: res.page.widthIn * 72, ptH: res.page.heightIn * 72, scale: 1.25 }
    : { pxW: res.width, pxH: res.height, ptW: res.width * 0.75, ptH: res.height * 0.75, scale: 2.5 };

  btn.disabled = true;

  try {
    const blob = await svgPagesToPDF(res.pages, {
      ...size,
      onProgress: (i, n) => {
        btn.textContent = `Making page ${i} of ${n}`;
      },
    });

    download(blob, 'handwriting.pdf');
    status(`PDF saved (${res.pages.length} page${res.pages.length > 1 ? 's' : ''})`);
  } catch (err) {
    status('PDF export failed: ' + err.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download PDF';
  }
};

$('#g-copy').onclick = async () => {
  if (!lastRes) return;

  try {
    await navigator.clipboard.writeText(fullRes().svg);
    status('SVG copied');
  } catch {
    status('This browser blocked the clipboard. Use Download SVG instead.', 4000);
  }
};
