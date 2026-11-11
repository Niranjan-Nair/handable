import test from 'node:test';
import assert from 'node:assert/strict';
import * as HW from '../src/engine/index.js';
import { glyphs } from '../src/engine/model/basefont.js';
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
