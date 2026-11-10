// Equations: parsed TeX atoms (see text/tex.js) laid out as boxes.
// disp = display math ($$…$$): bigger operators, limits underneath / on top.
import { INTEGRALS, MATRIX_ENVS } from '../text/tex.js';
import { addBox, charBox, emptyBox, handStroke, markGlyph, ruleStroke } from './boxes.js';
import { drawnDelimiter, handDelimiter } from './delimiters.js';
import { runBox } from './runs.js';

export const SCRIPT = 0.65; // scale of super / subscripts

// math spacing, in letter sizes: symbols sit this many letter gaps apart, with extra
// room around operators / relations and after big operators (∫, Σ) with their limits
const M_GAP = 1.7;
const M_OP = 0.38;
const M_BIG = 0.16;
const OPS = new Set('+−=<>×÷±≤≥≠≈→←·∈∉∋⊂⊃⊆⊇∪∩∖∧∨⊕⊗⊙⇒⇐⇔↔↦≡∼≃≅∝⊥∥≪≫∴∵');

// the space between two pieces of an equation that stay on one line
export const mathGlue = (writer) => Math.max(writer.letterGap(), 0.1) * M_GAP + M_OP;

// the math axis (where fraction bars and big operators are centered)
const axisOf = (writer, s) => -0.5 * writer.X * s;

export function mathList(writer, list, s, disp) {
  const b = emptyBox();
  let x = 0;
  let prevOp = false;
  let prevSign = false;
  let prevBig = false;
  let prevOpen = false;
  let first = true;

  for (const a of list) {
    const ab = mathAtom(writer, a, s, disp);
    // a + / − sign at the start, or after another operator / an opening bracket, is unary
    // (−x, (−1)): written up against what follows, with no operator room
    const isOp = a.t === 'ch' && OPS.has(a.ch) && !('+−±∓-'.includes(a.ch) && (first || prevSign || prevOpen));
    const isBig = (a.t === 'ch' && a.big) || (a.t === 'scripts' && a.base && a.base.big);
    // more than the writer's normal letter gap between symbols, plus room around operators /
    // relations and between a big operator and what it applies to
    if (!first && a.t !== 'sp')
      x += (Math.max(writer.letterGap(), 0.1) * M_GAP + (isOp || prevOp ? M_OP : 0) + (prevBig ? M_BIG : 0)) * s;
    addBox(b, ab, x, 0);
    x += ab.w;
    prevOp = isOp; // binary operators / relations only
    prevSign = a.t === 'ch' && OPS.has(a.ch);
    prevOpen = a.t === 'ch' && '([{⟨'.includes(a.ch);
    prevBig = isBig;
    first = false;
  }

  b.w = x;

  return b;
}

const ATOMS = {
  ch: charAtom,
  group: (writer, a, s, disp) => mathList(writer, a.list, s, disp),
  sp: (writer, a, s) => ({ ...emptyBox(), w: a.w * s }),
  text: textAtom,
  scripts: scriptsAtom,
  frac: fracAtom,
  sqrt: sqrtAtom,
  matrix: matrixAtom,
  boxed: boxedAtom,
  struck: struckAtom,
  rule: ruleAtom,
};

export function mathAtom(writer, a, s, disp) {
  const layout = ATOMS[a.t];

  return layout ? layout(writer, a, s, disp) : emptyBox();
}

function charAtom(writer, a, s, disp) {
  if (!a.big) return charBox(writer, a.ch, s, 'solo', { font: a.font }).b;

  // big operators: larger, centered on the math axis
  const { b } = charBox(writer, a.ch, s * (disp ? 1.6 : 1.3));
  const dy = axisOf(writer, s) - (b.top + b.bot) / 2;
  const out = emptyBox();
  addBox(out, b, 0, dy);
  out.w = b.w;

  return out;
}

// \text{…}, \mathrm{…}, function names (sin, lim …)
function textAtom(writer, a, s) {
  const b = emptyBox();
  let x = 0;

  for (const w of a.str.split(/(\s+)/)) {
    if (!w) continue;

    if (/^\s+$/.test(w)) {
      x += 0.3 * s;
      continue;
    }

    const cs = Array.from(w);
    const rb = runBox(writer, cs, s, { start: 0, n: cs.length, prev: null, font: a.font });
    addBox(b, rb, x, 0);
    x += rb.w;
  }

  b.w = x + (a.fn ? 0.14 * s : 0);

  return b;
}

function scriptsAtom(writer, a, s, disp) {
  const X = writer.X;
  const base = a.base ? mathAtom(writer, a.base, s, disp) : emptyBox();
  const sup = a.sup && mathAtom(writer, a.sup, s * SCRIPT);
  const sub = a.sub && mathAtom(writer, a.sub, s * SCRIPT);
  const b = emptyBox();
  // limits underneath / on top: \underset/\overset always; \limits forces it; \nolimits
  // prevents it; otherwise sums, products, lim, max… in display math (not integrals)
  const op = a.base;
  const limitOp = op && ((op.t === 'ch' && op.big && !INTEGRALS.includes(op.ch)) || (op.t === 'text' && op.limOp));
  const stacked = a.stack || (op && op.limits != null ? op.limits : !!(disp && limitOp));

  if (stacked) {
    const W = Math.max(base.w, sup ? sup.w : 0, sub ? sub.w : 0);
    addBox(b, base, (W - base.w) / 2, 0);
    if (sup)
      addBox(b, sup, (W - sup.w) / 2 + (a.accent ? 0.04 * s : 0), base.top - (a.accent ? 0.05 : 0.12) * s - sup.bot);
    if (sub) addBox(b, sub, (W - sub.w) / 2, base.bot + 0.12 * s - sub.top);
    b.w = W;

    return b;
  }

  addBox(b, base, 0, 0);
  const sx = base.w + (a.base && a.base.big ? 0.16 : 0.09) * s; // big operators (∫, Σ) get more clearance
  let supY = Math.min(-0.9 * X * s, base.top + 0.25 * s);
  let subY = Math.max(0.22 * s, base.bot * 0.6);

  if (sup && sub) {
    const gap = subY + sub.top - (supY + sup.bot);

    if (gap < 0.12 * s) {
      const d = (0.12 * s - gap) / 2;
      supY -= d;
      subY += d;
    }
  }

  if (sup) addBox(b, sup, sx, supY);
  if (sub) addBox(b, sub, sx, subY);
  b.w = sx + Math.max(sup ? sup.w : 0, sub ? sub.w : 0);

  return b;
}

function fracAtom(writer, a, s) {
  const fs = s * 0.8;
  const num = mathAtom(writer, a.num, fs);
  const den = mathAtom(writer, a.den, fs);
  const axis = axisOf(writer, s);
  const pad = 0.1 * s;
  const barW = Math.max(num.w, den.w) + 0.32 * s;
  const b = emptyBox();
  b.items.push({ g: ruleStroke(writer, barW), x: pad, y: axis, s: 1 });
  addBox(b, num, pad + (barW - num.w) / 2, axis - 0.15 * s - num.bot);
  addBox(b, den, pad + (barW - den.w) / 2, axis + 0.17 * s - den.top);
  b.w = barW + 2 * pad;
  b.top = Math.min(b.top, axis);
  b.bot = Math.max(b.bot, axis);

  return b;
}

function sqrtAtom(writer, a, s, disp) {
  const body = mathAtom(writer, a.body, s, disp);
  const top = Math.min(body.top, -writer.X * s) - 0.14 * s;
  const bot = Math.max(body.bot, 0) + 0.04 * s;
  const mid = bot - (bot - top) * 0.42;
  const ib = a.index ? mathAtom(writer, a.index, s * 0.5) : null;
  const off = ib ? Math.max(0, ib.w - 0.08 * s) : 0;
  const rw = 0.3 * s;
  const b = emptyBox();

  const radical = handStroke(
    writer,
    [
      [off, mid + 0.02 * s],
      [off + 0.08 * s, mid - 0.05 * s],
      [off + 0.16 * s, bot],
      [off + rw, top],
      [off + rw + body.w + 0.14 * s, top],
    ],
    0.4,
  );

  b.items.push({ g: radical, x: 0, y: 0, s: 1 });
  if (ib) addBox(b, ib, 0, mid - 0.08 * s - ib.bot);
  addBox(b, body, off + rw + 0.08 * s, 0);
  b.top = Math.min(b.top, top - 0.02);
  b.bot = Math.max(b.bot, bot);
  b.w = off + rw + body.w + 0.2 * s;

  return b;
}

// cells laid out in a grid on the math axis, then hand-drawn delimiters stretched to
// its height (amsmath: centered columns; cases: left-aligned, brace on the left only)
function matrixAtom(writer, a, s, disp) {
  const X = writer.X;
  const small = a.env === 'smallmatrix';
  const cs = small ? s * 0.7 : s;
  const cases = a.env === 'cases';
  const cells = a.rows.map((row) => row.map((cell) => mathList(writer, cell, cs, disp && !small)));
  const nCols = Math.max(...cells.map((r) => r.length));
  const colW = Array.from({ length: nCols }, (_, j) => Math.max(0, ...cells.map((r) => (r[j] ? r[j].w : 0))));
  const colGap = (cases ? 0.9 : small ? 0.35 : 0.6) * s;
  const rowGap = (small ? 0.12 : 0.22) * s;
  // each row is at least a line of letters tall, so rows stay evenly spaced
  const rowTop = cells.map((r) => Math.min(-X * 1.6 * cs, ...r.map((c) => c.top)));
  const rowBot = cells.map((r) => Math.max(0.3 * cs, ...r.map((c) => c.bot)));
  const grid = emptyBox();
  let y = 0;

  cells.forEach((r, ri) => {
    if (ri > 0) y += rowBot[ri - 1] + rowGap - rowTop[ri];
    let x = 0;

    for (let j = 0; j < nCols; j++) {
      const c = r[j];
      if (c) addBox(grid, c, x + (cases ? 0 : (colW[j] - c.w) / 2), y);
      x += colW[j] + colGap;
    }
  });

  grid.w = colW.reduce((t, w) => t + w, 0) + colGap * (nCols - 1);
  // center the grid on the math axis
  const top = rowTop[0];
  const bot = y + rowBot[rowBot.length - 1];
  const dy = axisOf(writer, s) - (top + bot) / 2;
  const [L, R] = MATRIX_ENVS[a.env];
  const T = top + dy - 0.12 * s;
  const B = bot + dy + 0.12 * s;
  const dw = (L === '{' ? 0.26 : L === '(' ? 0.22 : 0.16) * s;
  const pad = (L ? 0.22 : 0) * s;

  // your own bracket glyphs, stretched; a plain drawn one only if the model has none
  const delim = (kind, at, left) =>
    handDelimiter(writer, kind, at, T, B, s) ||
    Object.assign(drawnDelimiter(writer, kind, at, dw, T, B, left), { w: dw });

  const b = emptyBox();
  let x = 0;

  if (L) {
    const g = delim(L, x, true);
    b.items.push({ g, x: 0, y: 0, s: 1 });
    x += g.w + pad;
  }

  addBox(b, grid, x, dy);
  x += grid.w;

  if (R) {
    x += pad;
    const g = delim(R, x, false);
    b.items.push({ g, x: 0, y: 0, s: 1 });
    x += g.w;
  }

  b.w = x;
  b.top = Math.min(b.top, T - 0.04);
  b.bot = Math.max(b.bot, B + 0.04);

  return b;
}

// a box around the body, drawn like the boxes you trained
function boxedAtom(writer, a, s, disp) {
  const body = mathAtom(writer, a.body, s, disp);
  const pad = 0.22 * s;
  const b = emptyBox();
  addBox(b, body, pad, 0);
  const T = Math.min(body.top, -writer.X * s);
  const Bt = Math.max(body.bot, 0.05 * s);
  const g = markGlyph(writer, 'box', pad, pad + body.w, T, Bt, axisOf(writer, s), s);
  b.items.push({ g, x: 0, y: 0, s: 1 });
  b.w = body.w + 2 * pad;
  b.top = Math.min(b.top, g.minY - 0.03);
  b.bot = Math.max(b.bot, g.maxY + 0.03);

  return b;
}

function struckAtom(writer, a, s, disp) {
  const body = mathAtom(writer, a.body, s, disp);
  const b = emptyBox();
  addBox(b, body, 0, 0);

  b.items.push({
    g: markGlyph(writer, 'strike', 0, body.w, body.top, body.bot, axisOf(writer, s), s),
    x: 0,
    y: 0,
    s: 1,
  });

  b.w = body.w;

  return b;
}

// \overline, \bar, \underline
function ruleAtom(writer, a, s, disp) {
  const body = mathAtom(writer, a.body, s, disp);
  const X = writer.X;
  const b = emptyBox();
  addBox(b, body, 0, 0);
  const y = a.over ? Math.min(body.top, -X * s) - 0.12 * s : Math.max(body.bot, 0.05 * s) + 0.12 * s;
  b.items.push({ g: ruleStroke(writer, body.w + 0.04 * s), x: -0.02 * s, y, s: 1 });
  if (a.over) b.top = Math.min(b.top, y - 0.03);
  else b.bot = Math.max(b.bot, y + 0.03);
  b.w = body.w;

  return b;
}
