import test from 'node:test';
import assert from 'node:assert/strict';
import * as HW from '../src/engine/index.js';
import { glyphs } from '../src/engine/model/basefont.js';
import { joinLetters } from '../src/engine/layout/cursive.js';
import { makeDataset } from './fixtures.js';

const data = makeDataset(glyphs);
const model = HW.buildModel(data);

test('the model learns characters, variants and ligatures', () => {
    assert.ok(model.chars.a.variants.length >= 1);
    assert.equal(model.chars.a.count, 5);
    assert.ok(model.units.th, 'joined "th" in the sentences is a ligature');
    assert.ok(model.style.letterGap.learned);
});

test('the same seed writes the same thing, another seed something else', () => {
    const a = HW.generate(model, 'Hello there', { seed: 1 });
    const b = HW.generate(model, 'Hello there', { seed: 1 });
    const c = HW.generate(model, 'Hello there', { seed: 2 });
    assert.equal(a.svg, b.svg);
    assert.notEqual(a.svg, c.svg);
});

test('typing a word only changes that word', () => {
    const before = HW.generate(model, 'one two three', { seed: 's', paper: 'lined', layers: true });
    const after = HW.generate(model, 'one two three four', { seed: 's', paper: 'lined', layers: true });
    assert.equal(before.layers[0].paper, after.layers[0].paper);
    const glyphsOf = (res, word) => res.caretMap.chars.filter((c) => c.s < word.length).map((c) => c.x0);
    assert.deepEqual(glyphsOf(before, 'one two'), glyphsOf(after, 'one two'));
});

test('characters it cannot write are reported, and untrained ones are inferred', () => {
    const res = HW.generate(model, 'π 漢', { seed: 1 });
    assert.deepEqual(res.missing, ['漢']);
    assert.deepEqual(res.inferred, ['π']);
    assert.equal(HW.inferInfo(model, 'a'), null);
});

test('accented letters are your own letters with the accent added, however they were typed', () => {
    const e = HW.sampleGlyph(model, 'e', { seed: 1 });
    const é = HW.sampleGlyph(model, 'é', { seed: 1 });
    assert.ok(é.strokes.length > e.strokes.length, 'the e, and an accent');
    assert.ok(é.minY < e.minY - 0.05, 'the accent is above it');
    assert.ok(HW.sampleGlyph(model, '¿', { seed: 1 }).maxY > 0.2, '¿ hangs below the line');
    const typed = HW.generate(model, 'café', { seed: 1 });
    assert.deepEqual(typed.missing, []);
    assert.equal(HW.generate(model, 'cafe\u0301', { seed: 1 }).svg, typed.svg, 'e + a combining accent');
    assert.deepEqual(HW.generate(model, 'Øl, Łódź, straße, ¡olé!', { seed: 1 }).missing, []);
});

test('text boxes are written at their own size and width, where they were put', () => {
    const box = {
        id: 'n',
        text: 'a note in a box, long enough to wrap onto more lines',
        x: 900,
        y: 600,
        w: 300,
        size: 30,
        page: 1,
    };
    const res = HW.generate(model, 'main text\fpage two', { seed: 1, paper: 'plain', boxes: [box] });
    const [b] = res.boxes;
    const M = res.caretMap.boxes.n;
    assert.equal(b.page, 1);
    assert.ok(M.chars.length > 10 && M.chars.every((c) => c.page === 1), 'its caret places, on its page');
    assert.ok(
        M.chars.every((c) => c.x0 >= 900 - 1 && c.x1 <= 900 + 300 + 1),
        'within its width',
    );
    assert.ok(M.lines.length >= 2, 'wrapped');
    assert.equal(M.size, 30);

    const free = HW.generate(model, 'hi', { seed: 1, boxes: [{ ...box, page: 0 }] });
    assert.ok(free.width >= 1200 && free.height >= 600, 'without paper the page takes in the box');
    const without = HW.generate(model, 'main text\fpage two', { seed: 1, paper: 'plain' });
    assert.deepEqual(res.caretMap.chars, without.caretMap.chars, 'the main text is unchanged');
});

test('a sized stretch is larger or smaller about the same baseline', () => {
    const plain = HW.generate(model, 'ab cd', { seed: 1 });
    const sized = HW.generate(model, 'ab <size 96>cd</size>', { seed: 1 });
    const cd = (res) => res.caretMap.chars.filter((c) => c.s >= 3);
    assert.ok(
        cd(sized).every((c) => c.sc > 1.8),
        'twice the size',
    );
    // (a line slopes a little as it goes)
    assert.ok(Math.abs(sized.caretMap.chars[0].y - cd(sized)[0].y) < 2, 'on the same baseline');
    assert.ok(sized.width > plain.width);
});

test('on plain paper, lines sit on the same lines as lined paper, unseen', () => {
    const opts = { seed: 1, lineHeight: 2 };
    const lined = HW.generate(model, 'one\ntwo', { ...opts, paper: 'lined' });
    const plain = HW.generate(model, 'one\ntwo', { ...opts, paper: 'plain' });
    const gap = (res) => res.baselines[1] - res.baselines[0];
    assert.equal(gap(plain), gap(lined));
    assert.equal(gap(plain), 2 * 48);
});

test('aligned paragraphs: centered and right-aligned in the room their lines have', () => {
    const opts = { seed: 1, paper: 'plain' };
    const lineOf = (text, i) => HW.generate(model, text, opts).caretMap.lines[i];
    const left = lineOf('hi', 0).x;
    const center = lineOf('<align center>hi</align>', 0).x;
    const right = lineOf('<align right>hi</align>', 0).x;
    assert.ok(left < center && center < right);
    const res = HW.generate(model, 'x\n<align right>hi</align>', opts);
    const last = res.caretMap.chars.filter((c) => c.line === 1).at(-1);
    assert.ok(Math.abs(last.x1 - (res.width - 192)) < 5, 'ends at the right margin');
    assert.ok(lineOf('x\n<align center>hi</align>', 0).x < 200, 'only its own paragraph');
});

test('italic is cursive: the pen runs on from each letter into the next', () => {
    const rng = HW.makeRng(1);
    const line = (x0, y0, x1, y1) => [
        { x: x0, y: y0, w: 1 },
        { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: 1 },
        { x: x1, y: y1, w: 1 },
    ];
    // two cursive letters side by side, each joining by its first stroke; their dots come after
    const letter = (x, char = 'i') => ({
        g: { char, cursive: true, strokes: [line(0.1, -0.5, 0.1, 0), line(0.1, -0.7, 0.11, -0.7)] },
        x,
        y: 0,
        s: 1,
    });
    const a = letter(0);
    const b = letter(0.5);
    assert.ok(joinLetters(a, b, rng, 1));
    const out = a.g.strokes[0];
    assert.deepEqual([out.at(-1).x, out.at(-1).y], [0.6, -0.5], "a's stroke runs on to where b's starts");
    assert.ok(out.joinedEnd && b.g.strokes[0].joinedStart, 'no ink pools where they join');
    assert.equal(a.g.strokes[1].length, 3, 'a dot is never joined');
    assert.ok(
        !joinLetters(b, { g: { strokes: [line(0, 0, 0.1, 0)] }, x: 1, y: 0, s: 1 }, rng, 1),
        'only cursive letters join',
    );
    assert.ok(!joinLetters(letter(0), letter(0.5, 'D'), rng, 1), 'nothing joins into a capital');
    assert.ok(joinLetters(letter(0, 'A'), letter(0.5), rng, 1), 'A joins on');
    assert.ok(!joinLetters(letter(0, 'T'), letter(0.5), rng, 1), 'T does not');

    // out of a letter that leaves high (as w does) into a tall loop (as h's): entered a
    // little above the exit, so the join sweeps up into the loop
    const high = { g: { char: 'w', cursive: true, strokes: [line(0, -0.48, 0.3, -0.48)] }, x: 0, y: 0, s: 1 };
    const rise = Array.from({ length: 21 }, (_, k) => ({ x: 0.1 + k * 0.002, y: -0.55 - k * 0.02, w: 1 }));
    const loop = {
        g: { char: 'h', cursive: true, strokes: [[...rise, ...line(0.14, -0.95, 0.1, 0)]] },
        x: 0.4,
        y: 0,
        s: 1,
    };
    assert.ok(joinLetters(high, loop, rng, 1));
    assert.ok(loop.g.strokes[0][0].y < -0.6, 'enters the loop above the exit');

    const res = HW.generate(model, '<i>minimum</i> word', { seed: 1 });
    assert.deepEqual(res.missing, []);
    assert.equal(res.caretMap.chars.length, 12, 'every letter still has its place');
    const caps = HW.generate(model, '<i>The Quick Brown Fox, ÉLAN</i>', { seed: 1 });
    assert.deepEqual([caps.missing, caps.inferred], [[], []], 'capitals are cursive too');
});

test("cursive you've trained is used for italic, and leaves print alone", () => {
    const ds = makeDataset(glyphs);
    // an l written alone in cursive: up from the line into its loop, down, and off on an exit
    const path = [
        [0, 0],
        [0.26, -0.6],
        [0.3, -0.95],
        [0.18, -1],
        [0.12, -0.6],
        [0.13, -0.02],
        [0.2, 0],
        [0.32, -0.14],
    ];
    const stroke = [];
    for (let i = 0; i < path.length - 1; i++)
        for (let k = 0; k < 6; k++) {
            const t = k / 6;
            stroke.push([
                path[i][0] + (path[i + 1][0] - path[i][0]) * t,
                path[i][1] + (path[i + 1][1] - path[i][1]) * t,
                0,
                null,
            ]);
        }
    stroke.push([0.32, -0.14, 0, null]);
    for (let n = 0; n < 3; n++)
        ds.samples.push({ id: 'cl' + n, char: 'l', ctx: 'solo', cursive: true, strokes: [stroke] });
    const m = HW.buildModel(ds);
    assert.equal(m.cursive.l.count, 3);
    assert.equal(m.chars.l.count, model.chars.l.count, 'not a print l');
    const g = HW.sampleGlyph(m, 'l', { cursive: true, seed: 1, randomness: 0 });
    assert.ok(g.cursive, 'their own cursive l');
    const body = m.cursive.l.variants[0].medoid.strokes[0];
    assert.ok(body[0].y < -0.3, 'its way in is left out: it starts part way up the loop');
    assert.ok(body.at(-1).y > -0.06, 'and its way out: it ends on its turn at the line');
    assert.equal(
        HW.generate(m, 'lull', { seed: 1 }).svg,
        HW.generate(model, 'lull', { seed: 1 }).svg,
        'print as before',
    );
});

test('Cyrillic is written too', () => {
    assert.deepEqual(HW.generate(model, 'Съешь же ещё этих мягких булок', { seed: 1 }).missing, []);
});

test('paper: page breaks start new pages, long text flows on', () => {
    assert.equal(HW.generate(model, 'one\ftwo\fthree', { seed: 1, paper: 'plain' }).nPages, 3);
    assert.equal(HW.generate(model, 'one\ftwo', { seed: 1 }).nPages, 1, 'no pages without paper');
    assert.ok(HW.generate(model, 'word '.repeat(2000), { seed: 1, paper: 'lined' }).nPages > 1);
    const layered = HW.generate(model, 'a\nb', { seed: 1, paper: 'lined', layers: true });
    assert.equal(layered.svg, null);
    assert.equal(layered.layers[0].strips.length, 2, 'one strip per line');
});

test('every character of the text has a place for the caret', () => {
    const text = 'ab <u>cd</u> $x^2$\n\t- item';
    const res = HW.generate(model, text, { seed: 1 });
    const covered = new Set();
    for (const c of res.caretMap.chars) for (let i = c.s; i < c.e; i++) covered.add(i);
    for (const i of [0, 1, 6, 7, 13, 21, 22]) assert.ok(covered.has(i), `position ${i}`);
});

test('mathSpans: what is an equation and what is a dollar sign', () => {
    const spans = (t) => HW.mathSpans(t).map((m) => t.slice(m.a, m.b));
    assert.deepEqual(spans('a $b$ c'), ['$b$']);
    assert.deepEqual(spans('costs $5 and $10'), []);
    assert.deepEqual(spans('$ 5 and $'), []);
    assert.deepEqual(spans('one $$ alone'), []);
    assert.deepEqual(spans('$$x$$ and \\(y\\) and \\[z\\]'), ['$$x$$', '\\(y\\)', '\\[z\\]']);
    assert.deepEqual(spans('\\$5 $a$'), ['$a$']);
    assert.deepEqual(spans('$a\nb$'), [], 'inline math stays in its paragraph');
});

test('lists: markers and numbers', () => {
    assert.deepEqual(HW.listMarkerAt('- x', 0), { ch: '-', len: 1 });
    assert.equal(HW.listMarkerAt('-x', 0), null);
    assert.equal(HW.listMarkerAt('<ul &gt;&amp;> x', 0).ch, '>&');
    assert.deepEqual(HW.listMarkerAt('<ol (i)> x', 0).ol, { pre: '(', kind: 'i', post: ')', start: null });
    assert.equal(HW.listMarkerAt('<ol (i.> x', 0), null);

    assert.deepEqual(
        [1, 26, 27, 702].map((n) => HW.listNumber(n, 'a')),
        ['a', 'z', 'aa', 'zz'],
    );

    assert.deepEqual(
        [4, 9, 14, 1994].map((n) => HW.listNumber(n, 'I')),
        ['IV', 'IX', 'XIV', 'MCMXCIV'],
    );
});

test('parseRich: indents, gaps and page breaks', () => {
    const [p1, p2, p3] = HW.parseRich('\t  ab  cd \n\fx');

    assert.deepEqual(
        p1.lead.map((l) => l.tab),
        [true, false, false],
    );

    assert.equal(p1.words.length, 2);
    assert.equal(p1.words[1].gapWs.length, 2, 'both spaces count');
    assert.equal(p1.trail.length, 1);
    assert.ok(p3.newPage || p2.newPage);
});

test('reading a written line finds its letters', () => {
    const line = [];
    let x = 0;
    let t = 0;

    for (const ch of 'the cat') {
        if (ch === ' ') {
            x += 0.5;
            continue;
        }

        const s = data.samples.find((q) => q.char === ch && q.source === 'letter');
        for (const st of s.strokes) line.push(st.map((p) => [p[0] + x, p[1], p[2] + t, p[3]]));
        x += 0.5;
        t += 500;
    }

    const read = HW.readLine(line, 'the cat', model);
    assert.equal(read.groups.map((g) => (g.label ? g.label.ch : '?')).join(''), 'thecat');
    const { samples } = HW.sentenceToSamples(read.groups, 'the cat');
    assert.equal(samples.filter((s) => s.ctx === 'start').length, 2);
});
