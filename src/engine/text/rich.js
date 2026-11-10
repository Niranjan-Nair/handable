// Rich text: the markup the editor writes (formats, lists, indents, page breaks,
// equations) parsed into paragraphs of words.
import { listMarkerAt } from './lists.js';
import { mathSpans } from './math-spans.js';
import { parseMath, splitMathSrc, styledLetter } from './tex.js';

const SUP_MAP = {
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
    '⁺': '+',
    '⁻': '-',
    '⁼': '=',
    '⁽': '(',
    '⁾': ')',
    ⁿ: 'n',
    ⁱ: 'i',
};

const SUB_MAP = {
    '₀': '0',
    '₁': '1',
    '₂': '2',
    '₃': '3',
    '₄': '4',
    '₅': '5',
    '₆': '6',
    '₇': '7',
    '₈': '8',
    '₉': '9',
    '₊': '+',
    '₋': '-',
    '₌': '=',
    '₍': '(',
    '₎': ')',
    ₐ: 'a',
    ₑ: 'e',
    ₒ: 'o',
    ₓ: 'x',
    ᵢ: 'i',
    ⱼ: 'j',
    ₙ: 'n',
    ₖ: 'k',
    ₘ: 'm',
    ₜ: 't',
};

// A format tag: <sup> <sub> <u> <s> (or <del>, <strike>) <box> <mark> (with a color:
// <mark pink>, <mark color="pink">); groups: closing /, name, color
export const FORMAT_TAG = /<(\/?)(sup|sub|u|s|del|strike|box|mark)(?:\s+(?:colou?r\s*=\s*)?["']?([a-z]+)["']?)?\s*>/i;
// any format tag, for stripping them out of a stretch of text
export const ANY_FORMAT_TAG = /<\/?(?:sup|sub|u|s|del|strike|box|mark)\b[^<>]*>/gi;

const TAG_HERE = new RegExp('^' + FORMAT_TAG.source, 'i');

// Highlighter colors for <mark …>
export const HIGHLIGHTS = { yellow: '#ffe14d', pink: '#ff8fc8', orange: '#ffad5c', green: '#8ee07a', blue: '#7cc8ff' };

// Straight quotes typed on a keyboard -> the curly quote a person would write.
// An apostrophe is a right single quote (’), so they share one trained glyph.
const ELISIONS = /^(tis|twas|em|cause|til|bout|round|kay|n'|n\b)/i;

function smartQuote(src, i, q) {
    // the character before, looking through markup like <b>
    let j = i - 1;

    while (j >= 0 && src[j] === '>') {
        const k = src.lastIndexOf('<', j);
        if (k < 0 || !/^<\/?[a-z]+[^<>]*>$/i.test(src.slice(k, j + 1))) break;

        j = k - 1;
    }

    const prev = j >= 0 ? src[j] : '';
    const next = src[i + 1] || '';
    const opening = !prev || /[\s([{\u2014\u2013\-\/“‘"']/.test(prev);
    if (q === '"') return opening ? '“' : '”';
    if (!opening) return '’'; // it's / dogs' / 'quoted'
    if (/\d/.test(next) || ELISIONS.test(src.slice(i + 1, i + 8))) return '’'; // '90s, 'tis

    return '‘';
}

// Text -> paragraphs; each paragraph is a list of words, a word a list of nodes:
//   { t: 'ch', ch, lv, ...deco }    character; lv = nested script levels ['sup'|'sub']
//   { t: 'math', tree, lv, ...deco } inline TeX
// deco: u (underline), st (strikethrough), box (id of the <box> it's in), hl (highlighter color)
// Markup: <sup> <sub> <u> <s> <box> <mark pink|orange|yellow|green|blue>, Unicode ² ₂,
// $…$ inline math, $$…$$ display math (own centered line), \$ for a literal dollar sign.
// Every node knows where it came from in the text (si … se), and so does every
// paragraph, so an editor can put a caret on the page. Math is cut into pieces
// that can wrap onto the next line (after = + − and other relations and
// operators, as TeX does); \\ and \newline start a new line. A word that is a
// later piece of an equation carries glue (math spacing instead of a word gap) or
// brk (a forced line break). rawAt: a caret position; math containing it is
// given as the TeX itself, character by character, so it can be edited.

export function parseRich(text, literal = false, rawAt = -1) {
    return new RichParser(String(text), literal, rawAt).parse();
}

const isBlank = (s) => /^[ \t]*$/.test(s);

class RichParser {
    constructor(src, literal, rawAt) {
        this.src = src;
        this.literal = literal; // plain text: no markup or math, every character as written
        this.rawAt = rawAt;
        this.spans = new Map(literal ? [] : mathSpans(src).map((m) => [m.a, m])); // equations by start
        this.paras = [];
        this.para = { words: [], si: 0 };
        this.word = [];
        this.gaps = []; // the spaces and tabs since the last word
        this.afterDisplay = false; // just after a display equation (its line break is its own)
        // the formats open here
        this.lv = []; // script levels
        this.u = 0;
        this.st = 0;
        this.boxes = [];
        this.boxSeq = 0;
        this.marks = [];
        // the equation being edited (written as its TeX), and where it ends
        this.rawSpan = null;
        this.rawUntil = -1;
    }

    parse() {
        for (let i = 0; i < this.src.length;) i = this.step(i);
        this.endWord();
        this.para.se = this.src.length;
        if (this.gaps.length) this.para.trail = this.gaps;
        if (this.para.words.length || !this.afterDisplay) this.paras.push(this.para);

        return this.paras;
    }

    // reads what's at i -> where the next thing starts
    step(i) {
        const src = this.src;
        const c = src[i];
        if (c === '\r') return i + 1;
        if (c === '\n' || c === '\f') return this.paragraphBreak(i);

        if (this.mayStartList(i, c)) {
            const j = this.listMarker(i);
            if (j >= 0) return j;
        }

        if (c === ' ' || c === '\t') return this.space(i);
        if (i < this.rawUntil) return this.rawChar(i);
        if (this.literal) return this.literalChar(i);

        if (c === '\\' && src[i + 1] === '$') {
            this.pushChar('$', null, i, i + 2);

            return i + 2;
        }

        const span = (c === '$' || c === '\\') && this.spans.get(i);
        if (span) return this.equation(i, span);

        if (c === '<') {
            const j = this.tag(i);
            if (j >= 0) return j;
        }

        return this.char(i);
    }

    deco() {
        const { boxes, marks } = this;

        return {
            u: this.u > 0,
            st: this.st > 0,
            box: boxes.length ? boxes[boxes.length - 1] : 0,
            hl: marks.length ? marks[marks.length - 1] : null,
        };
    }

    // the spaces and tabs between words: every one counts (a tab as 4 spaces), so the
    // gap before a word grows with each; any after the last word are kept too (para.trail)
    endWord() {
        if (this.word.length) {
            if (this.gaps.length) {
                this.word.gapWs = this.gaps;
                this.gaps = [];
            }

            this.para.words.push(this.word);
        }

        this.word = [];
    }

    pushChar(ch, extraLv, si, se) {
        this.word.push({
            t: 'ch',
            ch,
            lv: extraLv ? this.lv.concat(extraLv) : this.lv.slice(),
            si,
            se,
            ...this.deco(),
        });
    }

    // \n ends a paragraph; \f (form feed) is a page break: what follows starts a new page (on paper)
    paragraphBreak(i) {
        const c = this.src[i];
        this.endWord();
        this.para.se = i;
        if (this.gaps.length) this.para.trail = this.gaps;
        if (this.para.words.length || !this.afterDisplay || c === '\f') this.paras.push(this.para);
        this.para = { words: [], si: i + 1, newPage: c === '\f' };
        this.gaps = [];
        this.afterDisplay = false;

        return i + 1;
    }

    // a list item's marker can only come first, after the paragraph's indent (and formats)
    mayStartList(i, c) {
        const { para } = this;

        return (
            !para.bullet &&
            !para.display &&
            !para.words.length &&
            !this.word.length &&
            (c === '<' || '-•+>'.includes(c)) &&
            isBlank(this.src.slice(para.si, i).replace(ANY_FORMAT_TAG, ''))
        );
    }

    // A list item (see listMarkerAt). The marker is written in the margin of the item,
    // and the item's lines hang after it. -> where its text starts, or -1 if it isn't one
    listMarker(i) {
        const m = listMarkerAt(this.src, i);
        if (!m) return -1;

        const bullet = { ch: m.ch, ol: m.ol, si: i, se: i + m.len, ws: [] };
        this.para.bullet = bullet;
        let j = i + m.len;
        while (this.src[j] === ' ' || this.src[j] === '\t') bullet.ws.push(j++);

        return j;
    }

    // spaces and tabs before a paragraph's first word indent it: a tab (4 spaces)
    // indents every line of the paragraph, a space only the first
    space(i) {
        const { para } = this;
        const tab = this.src[i] === '\t';
        const leading = !para.words.length && !this.word.length && isBlank(this.src.slice(para.si, i));
        if (leading) (para.lead = para.lead || []).push({ si: i, tab });
        this.endWord();
        if (!leading) this.gaps.push({ si: i, tab });

        return i + 1;
    }

    // a character of the equation being edited: its TeX as written, with \( \) and
    // \[ \] shown as $ and $$, as the equation's ends
    rawChar(i) {
        const src = this.src;
        const span = this.rawSpan;
        const raw = (si, se) => ({ t: 'ch', ch: '$', lv: this.lv.slice(), si, se, raw: true, ...this.deco() });

        if (span && src[span.a] === '\\' && (i === span.a || i === span.b - 2)) {
            if (src[i + 1] === '[' || src[i + 1] === ']') this.word.push(raw(i, i + 1), raw(i + 1, i + 2));
            else this.word.push(raw(i, i + 2));

            return i + 2;
        }

        const cp = String.fromCodePoint(src.codePointAt(i));
        this.word.push({ t: 'ch', ch: cp, lv: this.lv.slice(), si: i, se: i + cp.length, raw: true, ...this.deco() });

        return i + cp.length;
    }

    literalChar(i) {
        const cp = String.fromCodePoint(this.src.codePointAt(i));
        const se = i + cp.length;
        if (SUP_MAP[cp]) this.pushChar(SUP_MAP[cp], 'sup', i, se);
        else if (SUB_MAP[cp]) this.pushChar(SUB_MAP[cp], 'sub', i, se);
        else this.pushChar(cp === "'" || cp === '"' ? smartQuote(this.src, i, cp) : cp, null, i, se);

        return se;
    }

    // An equation, cut into the pieces it may wrap between. Inline, its pieces are words
    // (glued together unless a line break is forced); display math is a paragraph of
    // its own. One containing rawAt is written as its TeX instead.
    equation(i, span) {
        const { display, open } = span;
        const close = span.b - open;
        const end = span.b;

        if (this.rawAt > i && this.rawAt < end) {
            this.rawUntil = end;
            this.rawSpan = span;

            return i;
        }

        const node = (tree) => ({ t: 'math', tree, lv: this.lv.slice(), ...this.deco(), display, si: i, se: end });

        const pieces = splitMathSrc(this.src, i + open, close).map((pc) => ({
            node: node(parseMath(this.src.slice(pc.a, pc.b))),
            brk: pc.brk,
        }));

        if (!pieces.length) pieces.push({ node: node([]), brk: false });

        if (display) {
            this.endWord();
            const para = this.para;

            if (para.words.length) {
                para.se = i;
                this.paras.push(para);
            }

            const words = pieces.map((pc, k) => Object.assign([pc.node], k ? { glue: !pc.brk, brk: pc.brk } : {}));
            this.paras.push({ words, display: true, si: i, se: end, newPage: !para.words.length && !!para.newPage });
            this.para = { words: [], si: end };
            this.gaps = [];
            this.afterDisplay = true;
        } else {
            pieces.forEach((pc, k) => {
                if (k) {
                    this.endWord();
                    this.word.glue = !pc.brk;
                    this.word.brk = pc.brk;
                }

                this.word.push(pc.node);
            });
        }

        return end;
    }

    // a format tag opening or closing a format -> where it ends, or -1 if it isn't one
    tag(i) {
        const m = TAG_HERE.exec(this.src.slice(i, i + 40));
        if (!m) return -1;

        const name = m[2].toLowerCase();
        const closing = !!m[1];
        const step = closing ? -1 : 1;
        if (name === 'u') this.u = Math.max(0, this.u + step);
        else if (name === 's' || name === 'del' || name === 'strike') this.st = Math.max(0, this.st + step);
        else if (name === 'box') {
            if (closing) this.boxes.pop();
            else this.boxes.push(++this.boxSeq);
        } else if (name === 'mark') {
            if (closing) this.marks.pop();
            else {
                const color = (m[3] || 'yellow').toLowerCase();
                this.marks.push(HIGHLIGHTS[color] ? color : 'yellow');
            }
        } else if (closing) {
            const k = this.lv.lastIndexOf(name);
            if (k >= 0) this.lv.splice(k, 1);
        } else this.lv.push(name);

        return i + m[0].length;
    }

    // an ordinary character: Unicode super / subscripts and mathematical letters (ℝ, 𝐯)
    // are written as such, straight quotes as curly ones
    char(i) {
        const cp = String.fromCodePoint(this.src.codePointAt(i));
        const se = i + cp.length;
        const styled = styledLetter(cp);
        if (SUP_MAP[cp]) this.pushChar(SUP_MAP[cp], 'sup', i, se);
        else if (SUB_MAP[cp]) this.pushChar(SUB_MAP[cp], 'sub', i, se);
        else if (styled)
            this.word.push({
                t: 'math',
                tree: [{ t: 'ch', ch: styled[0], font: styled[1] }],
                lv: this.lv.slice(),
                si: i,
                se,
                ...this.deco(),
            });
        else if (cp === "'" || cp === '"') this.pushChar(smartQuote(this.src, i, cp), null, i, se);
        else this.pushChar(cp, null, i, se);

        return se;
    }
}
