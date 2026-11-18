// Train: single characters, written one at a time on a pad.
import { $, esc, markChoice, status } from '../dom.js';
import { Pad } from '../pad.js';
import { data, persist, saveSettings, settings, uid } from '../store.js';

const CHARSETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    punct: '.,!?‘’“”-:;()&@#$%/+=*', // ’ is also the apostrophe
    // accented letters are made from the plain ones and these accents, so writing
    // them is only needed when you write one differently
    accents: '´`ˆ¨˜¸éèêëàâäçñöôüûùíîïøßæœ¿¡',
    cyrillic: 'абвгдежзийклмнопрстуфхцчшщъыьэюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    // written in cursive (as in a word), for italic text
    cursive: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

CHARSETS.all = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + CHARSETS.punct;

// is the set being trained the cursive one?
const cursive = () => settings.charset === 'cursive';

export const letterPad = new Pad($('#letter-pad'), { width: 340, height: 340, unit: 130, baseline: 228, originX: 0 });

let curChar = CHARSETS[settings.charset][0];

// samples per character, in the set's kind of writing (print or cursive)
function counts() {
    const c = {};
    for (const s of data.samples) if (!!s.cursive === cursive()) c[s.char] = (c[s.char] || 0) + 1;

    return c;
}

// a character's button (label: what it shows, if not the character)
export function chip(ch, n, extraClass, sub, forms, label = ch) {
    const cls = ['chip', n ? (n >= 3 ? 'ok' : '') : 'zero', extraClass || ''].join(' ');
    const title = `${n} sample${n === 1 ? '' : 's'}` + (forms > 1 ? ` in ${forms} forms` : '');

    return `<button class="${cls}" data-ch="${esc(ch)}" title="${title}">${esc(label)}<span class="n">${sub != null ? sub : n}</span></button>`;
}

export function renderLetterGrid() {
    const c = counts();

    $('#char-grid').innerHTML = Array.from(CHARSETS[settings.charset])
        .map((ch) => chip(ch, c[ch] || 0, ch === curChar ? 'sel' : ''))
        .join('');

    const n = c[curChar] || 0;
    $('#prompt-char').textContent = curChar;
    $('#prompt-char').classList.toggle('cursive', cursive());
    $('#cursive-hint').hidden = !cursive();
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
        ...(cursive() && { cursive: true }),
        strokes: letterPad.strokes,
        created: Date.now(),
    });

    letterPad.strokes = [];
    letterPad.t0 = null;
    letterPad.draw();
    status(`Saved “${curChar}”${cursive() ? ' in cursive' : ''}`);
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
