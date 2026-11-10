// The text's markup as the editor sees it: format tags (never shown, and stepped
// over), equations (one place for the caret until it goes inside), escaped \$, and
// characters outside the basic plane (two UTF-16 units each).
import * as HW from '../../engine/index.js';
import { leadOf } from './leads.js';

const TAG = new RegExp(HW.FORMAT_TAG.source, 'iy');

// the format tag starting at k: { end, closing, name, color }, or null
export function tagAt(t, k) {
  TAG.lastIndex = k;
  const m = TAG.exec(t);

  return m ? { end: k + m[0].length, closing: !!m[1], name: m[2].toLowerCase(), color: m[3] } : null;
}

// the start of the format tag ending at k, or -1
export function tagBefore(t, k) {
  if (t[k - 1] !== '>') return -1;

  const j = t.lastIndexOf('<', k - 1);
  if (j < 0) return -1;

  const m = tagAt(t, j);

  return m && m.end === k ? j : -1;
}

// is there nothing but format tags between a and b?
export const onlyTags = (t, a, b) => !t.slice(a, b).replace(HW.ANY_FORMAT_TAG, '');

// the length of the character at k / before k
export const cpAt = (t, k) => (t.codePointAt(k) > 0xffff ? 2 : 1);
export const cpBefore = (t, k) => (k >= 2 && t.codePointAt(k - 2) > 0xffff ? 2 : 1);

// The equations: [{ a, b, open, display }]. The engine decides, so the editor and
// the page always agree on what's an equation.
export const mathRanges = (t) => HW.mathSpans(t);
// the equation position k is inside (strictly), or null
export const mathAround = (t, k) => mathRanges(t).find((m) => k > m.a && k < m.b) || null;
// the equation the selection a … b touches the inside of, or covers, or null
export const mathTouching = (t, a, b) =>
  mathRanges(t).find((m) => (a > m.a && a < m.b) || (b > m.a && b < m.b) || (a < b && a <= m.a && b >= m.b)) || null;
// the equation one of whose delimiters ($, $$, \( …) has a character at i, or null
export function delimiterAt(t, i) {
  if (i < 0) return null;

  return mathRanges(t).find((m) => (i >= m.a && i < m.a + m.open) || (i >= m.b - m.open && i < m.b)) || null;
}

// where the caret goes from k with the right arrow
export function stepRight(t, k) {
  // only closing tags here: step out of the format first
  let j = k;
  let closingOnly = true;
  let any = false;

  for (let m = tagAt(t, j); m; m = tagAt(t, j)) {
    any = true;
    if (!m.closing) closingOnly = false;
    j = m.end;
  }

  if (any && closingOnly && j < t.length + 1 && j !== k) return j;

  const ms = mathRanges(t);
  const inM = ms.find((m) => k > m.a && k < m.b);
  if (inM && k >= inM.b - inM.open) return inM.b; // out past the closing $
  const at = ms.find((m) => m.a === j);
  if (at) return at.a + at.open; // into an equation
  if (j >= t.length) return t.length;
  if (t[j] === '\\' && t[j + 1] === '$' && !inM) return j + 2;

  return j + cpAt(t, j);
}

// where the caret goes from k with the left arrow
export function stepLeft(t, k) {
  // from the start of an indented paragraph straight to the end of the one before
  const L = leadOf(t, k);
  if (k === L.b && L.b > L.a) return L.a > 0 ? L.a - 1 : k;

  let j = k;
  let openingOnly = true;
  let any = false;

  for (let q = tagBefore(t, j); q >= 0; q = tagBefore(t, j)) {
    any = true;
    if (tagAt(t, q).closing) openingOnly = false;
    j = q;
  }

  if (any && openingOnly && j !== k) return j;

  const ms = mathRanges(t);
  const inM = ms.find((m) => k > m.a && k < m.b);
  if (inM && k <= inM.a + inM.open) return inM.a; // out before the opening $
  const at = ms.find((m) => m.b === j);
  if (at) return at.b - at.open; // into an equation, at its end
  if (j <= 0) return 0;
  if (t[j - 1] === '$' && t[j - 2] === '\\' && !inM) return j - 2;

  return j - cpBefore(t, j);
}

// Backspace (forward: Delete) with the caret at k and nothing selected: markup is
// skipped to the letter before (after) it, and one of an equation's $ signs takes
// the whole equation, so no other $ is paired up differently. A format left empty
// (<sup></sup>) goes too, in the same step. -> a change, or null for the usual delete
export function deleteAt(t, k, forward) {
  let j = k;
  if (forward) for (let m = tagAt(t, j); m; m = tagAt(t, j)) j = m.end;
  else for (let q = tagBefore(t, j); q >= 0; q = tagBefore(t, j)) j = q;
  const M = delimiterAt(t, forward ? j : j - 1);
  if (M) return { a: M.a, b: M.b, str: '', selA: M.a };
  if (forward ? j === k || j >= t.length : j === k || j <= 0) return null;
  if (forward) return removeRange(t, j, j + cpAt(t, j), k);

  const n = cpBefore(t, j);

  return removeRange(t, j - n, j, k - n);
}

// delete t[a … b) with the caret ending at k; a format left empty by it goes too
function removeRange(t, a, b, k) {
  const open = tagBefore(t, a);
  const close = tagAt(t, b);
  if (open >= 0 && close && close.closing && !tagAt(t, open).closing && tagAt(t, open).name === close.name)
    return { a: open, b: close.end, str: '', selA: open };

  return { a, b, str: '', selA: k };
}

// Any other edit that takes away part of an equation's delimiters (deleting a
// selection, a word at a time, cutting, typing over a selection) is widened to the
// whole equation, so the remaining $ signs aren't paired up differently and nothing
// else is read as math (or stops being math). old: the text before the edit; t2:
// after it. -> the widened edit (of old), or null if it's fine as it is
export function widenOverMath(old, t2) {
  const ms = mathRanges(old);
  let p = 0;
  while (p < old.length && p < t2.length && old[p] === t2[p]) p++;
  let q = 0;
  while (q < old.length - p && q < t2.length - p && old[old.length - 1 - q] === t2[t2.length - 1 - q]) q++;
  const inserted = t2.slice(p, t2.length - q);
  let lo = p;
  let hi = old.length - q;
  if (hi <= lo) return null; // nothing was taken away
  const hits = (m) => (lo < m.a + m.open && hi > m.a) || (lo < m.b && hi > m.b - m.open);

  for (let grew = true; grew;) {
    grew = false;

    for (const m of ms) {
      if (hits(m) && (m.a < lo || m.b > hi)) {
        lo = Math.min(lo, m.a);
        hi = Math.max(hi, m.b);
        grew = true;
      }
    }
  }

  if (lo === p && hi === old.length - q) return null;

  return { a: lo, b: hi, str: inserted, selA: lo + inserted.length };
}
