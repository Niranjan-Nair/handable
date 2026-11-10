// The editor's text functions (they work on the text alone, without a page).
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceChange } from '../src/app/editor/change.js';
import { activeFormats, toggleFormat, toggleMath } from '../src/app/editor/formats.js';
import { leadKey, leadOf, listAutoformat, setList } from '../src/app/editor/leads.js';
import { deleteAt, stepLeft, stepRight, widenOverMath } from '../src/app/editor/markup.js';

// a change applied to t -> [text, selection start, selection end]
function applied(t, c, caret = 0) {
    if (!c || c.a == null) return [t, c && c.selA != null ? c.selA : caret, c && c.selB != null ? c.selB : caret];

    const t2 = t.slice(0, c.a) + c.str + t.slice(c.b);
    const end = c.a + c.str.length;

    return [t2, c.selA != null ? c.selA : end, c.selB != null ? c.selB : c.selA != null ? c.selA : end];
}

// presses keys at the caret, one after another -> the text and caret
function press(t, caret, keys) {
    for (const k of keys) {
        const [key, shift] = k.startsWith('Shift+') ? [k.slice(6), true] : [k, false];
        const c = leadKey(t, caret, caret, key, shift);
        [t, caret] = applied(t, c, caret);
    }

    return [t, caret];
}

test('replaceChange only touches what differs', () => {
    assert.deepEqual(replaceChange('abcdef', 'abXYef', 2), { a: 2, b: 4, str: 'XY', selA: 2, selB: 2 });
    assert.deepEqual(replaceChange('same', 'same', 1, 3), { selA: 1, selB: 3 });
});

test('Tab and Backspace indent like Google Docs', () => {
    assert.deepEqual(press('hi', 0, ['Tab']), ['    hi', 4], 'first line');
    assert.deepEqual(press('hi', 0, ['Tab', 'Tab']), ['\t    hi', 5], 'then the whole paragraph');
    assert.deepEqual(press('hi', 0, ['Tab', 'Tab', 'Backspace']), ['\thi', 1], 'the first-line indent goes first');
    assert.deepEqual(press('hi', 0, ['Tab', 'Tab', 'Backspace', 'Backspace']), ['hi', 0]);
    assert.deepEqual(applied('ab', leadKey('ab', 1, 1, 'Tab', false)), ['a\tb', 2, 2], 'inline, a wide gap');
});

test('lists: Enter continues, an empty item ends, Tab nests by the default hierarchy', () => {
    const t = '<ol 1.> one';
    assert.deepEqual(press(t, t.length, ['Enter']), ['<ol 1.> one\n<ol 1.> ', 20]);
    const [nested] = press(t + '\n<ol 1.> ', 20, ['Tab']);
    assert.equal(nested, '<ol 1.> one\n\t<ol a.> ');
    assert.equal(press(nested, nested.length, ['Shift+Tab'])[0], '<ol 1.> one\n<ol 1.> ');
    assert.equal(press('- x\n- ', 6, ['Enter'])[0], '- x\n', 'an empty item ends the list');
    assert.equal(press('- x', 2, ['Backspace'])[0], 'x', 'Backspace takes the marker off');
});

test('typing a marker and a space starts a list', () => {
    assert.deepEqual(listAutoformat('*', 1).change, { a: 0, b: 1, str: '• ' });
    const roman = listAutoformat('(iv)', 4);
    assert.equal(roman.change.str, '<ol (i) 4> ');
    assert.equal(listAutoformat('vv.', 3), null, 'not a roman numeral');
    assert.equal(listAutoformat('(3.', 3), null);
    assert.equal(leadOf('\t- item', 7).b, 3);
});

test('the list button, on several paragraphs at once', () => {
    const t = 'one\n\ttwo';
    const [t2] = applied(t, setList(t, 0, t.length, { ol: { pre: '', kind: '1', post: '.', start: null } }, true));
    assert.equal(t2, '<ol 1.> one\n\t<ol a.> two');
    assert.equal(applied(t2, setList(t2, 0, t2.length, null))[0], t);
});

test('formats: on and off for a selection, and at the caret', () => {
    const t = 'hello world';
    const [u, a, b] = applied(t, toggleFormat(t, 6, 11, 'u'));
    assert.equal(u, 'hello <u>world</u>');
    assert.ok(activeFormats(u, a, b).u);
    assert.equal(applied(u, toggleFormat(u, a, b, 'u'))[0], t);
    const [caret, at] = applied('ab', toggleFormat('ab', 2, 2, 'sup'));
    assert.deepEqual([caret, at], ['ab<sup></sup>', 7]);
});

test('the equation button wraps, unwraps, and never pairs with another $', () => {
    assert.equal(applied('a  b', toggleMath('a  b', 2, 2))[0], 'a \\(\\) b');
    assert.equal(applied('x $y$', toggleMath('x $y$', 3, 3))[0], 'x y');
    assert.equal(applied('a\\', toggleMath('a\\', 2, 2))[0], 'a\\ \\(\\)', 'a space after a lone backslash');
});

test('the caret steps over markup and into equations', () => {
    const t = 'a<u>b</u>c';
    assert.equal(stepRight(t, 1), 5, 'past an opening tag, onto the letter');
    assert.equal(stepRight(t, 5), 9, 'out of the format');
    assert.equal(stepLeft(t, 10), 9);
    assert.equal(stepRight('$x$ y', 0), 1, 'into the equation');
});

test('deleting an equation delimiter deletes the equation', () => {
    assert.deepEqual(deleteAt('a $x$ b', 5, false), { a: 2, b: 5, str: '', selA: 2 });
    assert.equal(deleteAt('ab', 2, false), null, 'an ordinary character: the usual delete');
    assert.deepEqual(widenOverMath('a $x$ b', 'a x$ b'), { a: 2, b: 5, str: '', selA: 2 });
    assert.equal(widenOverMath('a $x$ b', 'a $$ b'), null, 'only the inside: fine as it is');
});
