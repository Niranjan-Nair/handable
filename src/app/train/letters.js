// Train: single characters, written one at a time on a pad.
import { $, esc, markChoice, status } from '../dom.js';
import { Pad } from '../pad.js';
import { data, persist, saveSettings, settings, uid } from '../store.js';

const CHARSETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    punct: '.,!?‘’“”-:;()&@#$%/+=*', // ’ is also the apostrophe
};

CHARSETS.all = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + CHARSETS.punct;

export const letterPad = new Pad($('#letter-pad'), { width: 340, height: 340, unit: 130, baseline: 228, originX: 0 });

let curChar = CHARSETS[settings.charset][0];

function counts() {
    const c = {};
    for (const s of data.samples) c[s.char] = (c[s.char] || 0) + 1;

    return c;
}

export function chip(ch, n, extraClass, sub, forms) {
    const cls = ['chip', n ? (n >= 3 ? 'ok' : '') : 'zero', extraClass || ''].join(' ');
    const title = `${n} sample${n === 1 ? '' : 's'}` + (forms > 1 ? ` in ${forms} forms` : '');

    return `<button class="${cls}" data-ch="${esc(ch)}" title="${title}">${esc(ch)}<span class="n">${sub != null ? sub : n}</span></button>`;
}

export function renderLetterGrid() {
    const c = counts();

    $('#char-grid').innerHTML = Array.from(CHARSETS[settings.charset])
        .map((ch) => chip(ch, c[ch] || 0, ch === curChar ? 'sel' : ''))
        .join('');

    const n = c[curChar] || 0;
    $('#prompt-char').textContent = curChar;
    $('#prompt-count').textContent = `${n} sample${n === 1 ? '' : 's'}`;
}

function setChar(ch) {
    curChar = ch;
    letterPad.clear();
    renderLetterGrid();
}

export function stepChar(d) {
    const set = Array.from(CHARSETS[settings.charset]);
    let i = set.indexOf(curChar);
    i = i < 0 ? 0 : (i + d + set.length) % set.length;
    setChar(set[i]);
}

export function saveLetter(next) {
    if (letterPad.isEmpty()) {
        status('Draw the character first');

        return;
    }

    data.samples.push({
        id: uid(),
        char: curChar,
        ctx: 'solo',
        source: 'letter',
        strokes: letterPad.strokes,
        created: Date.now(),
    });

    letterPad.strokes = [];
    letterPad.t0 = null;
    letterPad.draw();
    status(`Saved “${curChar}”`);
    persist();
    if (next) stepChar(1);
}

markChoice($('#charset'), settings.charset);

$('#charset').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (!b) return;

    settings.charset = b.dataset.val;
    saveSettings();
    markChoice($('#charset'), settings.charset);
    setChar(CHARSETS[settings.charset][0]);
});

$('#custom-char').addEventListener('input', (e) => {
    const ch = Array.from(e.target.value.trim())[0];
    if (ch) setChar(ch);
});

$('#char-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) setChar(b.dataset.ch);
});

$('#l-undo').onclick = () => letterPad.undo();
$('#l-clear').onclick = () => letterPad.clear();
$('#l-save-next').onclick = () => saveLetter(true);
$('#l-save-again').onclick = () => saveLetter(false);
