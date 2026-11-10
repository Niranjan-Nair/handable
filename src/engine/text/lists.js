// List items. A paragraph is one when it starts (after its indent) with:
//   - • + >  and a space            a bulleted item with that marker
//   <ul X>                          a bulleted item marked X (any text; &gt; for >, &amp; for &)
//   <ol 1.>  <ol a)>  <ol (i)> …    a numbered item: 1 numbers, a / A letters, i / I roman
//                                   numerals, written as x. or x) or (x)
//   <ol 1. 0>                       … starting again from 0 (or any number)
// Numbered items count up through a list, each level of nesting (each tab further in)
// on its own; an item that isn't in a list, or a different style, starts again.
export function listMarkerAt(src, i) {
    const c = src[i];
    if ('-•+>'.includes(c) && (src[i + 1] === ' ' || src[i + 1] === '\t')) return { ch: c, len: 1 };
    if (c !== '<') return null;

    const rest = src.slice(i, i + 80);
    let m = /^<ul ((?:[^\s<>&]|&gt;|&lt;|&amp;)+)>/.exec(rest);
    if (m) return { ch: m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'), len: m[0].length };

    m = /^<ol (\(?)([1aAiI])([.)])(?: (-?\d{1,6}))?>/.exec(rest);
    if (m && (!m[1] || m[3] === ')'))
        return {
            ch: '',
            ol: { pre: m[1], kind: m[2], post: m[3], start: m[4] == null ? null : +m[4] },
            len: m[0].length,
        };

    return null;
}
// n written as a list number: 1 → 1, a, A, i, I (letters and roman numerals from 1 up)
export function listNumber(n, kind) {
    if (kind === '1' || n < 1) return String(n);

    if (kind === 'a' || kind === 'A') {
        let s = '';
        for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;

        return kind === 'A' ? s.toUpperCase() : s;
    }

    if (n >= 4000) return String(n);

    const R = [
        [1000, 'm'],
        [900, 'cm'],
        [500, 'd'],
        [400, 'cd'],
        [100, 'c'],
        [90, 'xc'],
        [50, 'l'],
        [40, 'xl'],
        [10, 'x'],
        [9, 'ix'],
        [5, 'v'],
        [4, 'iv'],
        [1, 'i'],
    ];

    let s = '';

    for (let k = n, j = 0; k > 0;) {
        if (k >= R[j][0]) {
            s += R[j][1];
            k -= R[j][0];
        } else j++;
    }

    return kind === 'I' ? s.toUpperCase() : s;
}
// the numbers of numbered items, worked out down the text
export function numberLists(paras) {
    let counters = [];

    for (const p of paras) {
        const b = p.bullet;

        if (!b) {
            counters = [];
            continue;
        }

        const lvl = (p.lead || []).filter((l) => l.tab).length;
        counters.length = Math.min(counters.length, lvl + 1);

        if (!b.ol) {
            counters[lvl] = null;
            continue;
        }

        const style = b.ol.pre + b.ol.kind + b.ol.post;
        const prev = counters[lvl];
        const n = b.ol.start != null ? b.ol.start : prev && prev.style === style ? prev.n + 1 : 1;
        counters[lvl] = { style, n };
        b.ch = b.ol.pre + listNumber(n, b.ol.kind) + b.ol.post;
    }

    return paras;
}
