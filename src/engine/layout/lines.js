// Paragraphs (from text/rich.js) broken into lines of written words.
import { clamp } from '../util.js';
import { bulletBox, wordBox } from './words.js';
import { mathGlue } from './math.js';

// how many spaces a run of spaces and tabs is worth (a tab is 4)
export const tabUnits = (ws) => ws.reduce((n, w) => n + (w.tab ? 4 : 1), 0);

const nestingOf = (para) => (para.lead || []).filter((l) => l.tab).length;

// A word's key: its source text and which time that text has come up. Its writing
// is seeded by it (and cached under it), so it stays put while other words change.
function wordKey(writer, nodes, src) {
  let a = Infinity;
  let b = -1;

  for (const nd of nodes) {
    if (nd.si != null && nd.si < a) a = nd.si;
    if (nd.se != null && nd.se > b) b = nd.se;
  }

  const str = b > a ? src.slice(a, b) : nodes.map((nd) => nd.ch || '').join('');
  const n = (writer.seen.get(str) || 0) + 1;
  writer.seen.set(str, n);

  return str + '#' + n;
}

// List markers, written first. The items of one list (one level of it) all start
// their text at the same place, after the widest marker (as 9. and 10. do).
// -> { markers: Map(para -> marker box, with .run), runW: [widest marker per run] }
function listMarkers(writer, paras) {
  const markers = new Map();
  const runW = [];
  let runs = [];

  for (const p of paras) {
    if (!p.bullet || p.display) {
      if (!p.bullet) runs = [];
      continue;
    }

    const level = nestingOf(p);
    runs.length = Math.min(runs.length, level + 1);
    if (runs[level] == null) runs[level] = runW.push(0) - 1;
    const box = bulletBox(writer, p.bullet);
    box.run = runs[level];
    runW[box.run] = Math.max(runW[box.run], box.w);
    markers.set(p, box);
  }

  return { markers, runW };
}

// shift the source positions in a word box's caret map by d
const shiftCmap = (cmap, d) =>
  cmap.map((c) => ({ ...c, s: c.s == null ? c.s : c.s + d, e: c.e == null ? c.e : c.e + d }));

// A word (or piece of one) written out, or reused from the cache: a word that only
// moved is a hit, as its source positions are kept relative to the word.
function buildWord(writer, nodes, display, cache, src) {
  const { rng, found } = writer;
  const key = wordKey(writer, nodes, src);
  let base = Infinity;
  for (const nd of nodes) if (nd.si != null && nd.si < base) base = nd.si;
  if (base === Infinity) base = 0;

  const sig =
    cache &&
    key +
      '\u0002' +
      !!display +
      '\u0002' +
      JSON.stringify(nodes, (k, v) => ((k === 'si' || k === 'se') && v != null ? v - base : v));

  const hit = cache && cache.get(sig);
  let wb;

  if (hit) {
    for (const [kind, v] of hit.notes) found[kind].add(v);
    wb = { ...hit.wb, cmap: shiftCmap(hit.wb.cmap, base) };
  } else {
    rng.reseed('w' + key);
    writer.noting = [];
    wb = wordBox(writer, nodes);
    wb.ws = display ? 1 : clamp(1 + rng.normal() * 0.03 * writer.r, 0.85, 1.15); // its own size, a little off
    const notes = writer.noting;
    writer.noting = null;
    if (cache) cache.set(sig, { notes, wb: { ...wb, cmap: shiftCmap(wb.cmap, -base) } });
  }

  wb.key = key;
  wb.wsp = nodes.gapWs || null;
  // what comes next (the gap after this word) draws from its own generator, the
  // same whether this word was written now or reused
  rng.reseed('g' + key);

  return wb;
}

// the first k letters of a word with a hyphen after them (the hyphen isn't in the
// text, so it has no place for the caret)
function hyphenated(nodes, k) {
  const last = nodes[k - 1];

  return [...nodes.slice(0, k), { ...last, ch: '-', si: null, se: null }];
}

// All the lines of the text. A line: { words (placed word boxes, each with .x),
// display, psi / pse (its paragraph's source range), indent, lead, newPage,
// bullet, hang, trail }.
export function breakLines(writer, paras, src, maxW, cache) {
  const lines = [];
  const { markers, runW } = listMarkers(writer, paras);
  for (const para of paras) breakParagraph(writer, para, { lines, markers, runW, src, maxW, cache });

  return lines;
}

function breakParagraph(writer, para, { lines, markers, runW, src, maxW, cache }) {
  const { rng, spaceW } = writer;
  const lead = para.display ? [] : para.lead || [];
  // a list item hangs: every line starts a space and a half after its marker
  const bullet = markers.get(para) || null;
  const hang = bullet ? 0.04 + runW[bullet.run] + 1.5 * spaceW : 0;
  // tabs indent every line, spaces only the first
  let block = Math.min(maxW * 0.6, lead.filter((l) => l.tab).length * 4 * spaceW);
  let first = Math.min(maxW * 0.6 - block, lead.filter((l) => !l.tab).length * spaceW);

  if (bullet) {
    block = Math.min(maxW * 0.6, block + first) + hang;
    first = 0;
  }

  let line = [];
  let x = 0;
  let firstLine = true;
  const indent = () => block + (firstLine ? first : 0);
  const lineMax = () => maxW - indent(); // the room on this line, after its indent

  const push = () => {
    lines.push({
      words: line,
      display: !!para.display,
      psi: para.si,
      pse: para.se,
      indent: indent(),
      lead: firstLine && lead.length ? lead : null,
      newPage: firstLine && !!para.newPage,
      bullet: firstLine ? bullet : null,
      hang,
    });

    line = [];
    x = 0;
    firstLine = false;
  };

  const build = (nodes) => buildWord(writer, nodes, para.display, cache, src);

  const place = (wb, gap) => {
    x += gap;
    wb.x = x;
    wb.gap = gap;
    line.push(wb);
    x += wb.w * wb.ws;
  };

  // a quick measure (its own randomness, so the keys the real pieces use aren't spent)
  const fits = (nodes, room) => {
    rng.reseed('probe');

    return wordBox(writer, nodes).w * 1.03 <= room;
  };

  for (const nodes of para.words) {
    if (nodes.brk && line.length) push();
    const units = nodes.gapWs ? tabUnits(nodes.gapWs) : 0;

    const gap = !line.length
      ? 0
      : units > 1
        ? writer.wordGap() + (units - 1) * spaceW
        : nodes.glue
          ? mathGlue(writer)
          : writer.wordGap();

    const wb = build(nodes);
    const W = wb.w * wb.ws;

    if (W <= lineMax() || nodes.some((nd) => nd.t !== 'ch') || nodes.length < 2) {
      // the usual case: whole words wrap to the next line
      if (line.length && x + gap + W > lineMax()) {
        push();
        place(wb, 0);
      } else place(wb, gap);
      continue;
    }

    // a word longer than a whole line: hyphenate it. Fill what's left of this line
    // (if a few letters fit), then whole lines, then the rest on the last line
    let rest = nodes;

    while (rest.length) {
      const g = line.length ? (rest === nodes ? gap : writer.wordGap()) : 0;
      const room = lineMax() - x - g;

      if (rest !== nodes && fits(rest, room)) {
        place(build(rest), g);
        break;
      }

      // the most letters that fit with their hyphen (at least 3 when sharing a line)
      let lo = 0;
      let hi = rest.length - 1;

      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fits(hyphenated(rest, mid), room)) lo = mid;
        else hi = mid - 1;
      }

      if (line.length && lo < 3) {
        push();
        continue;
      }

      let k = Math.max(1, lo);
      let pb = build(hyphenated(rest, k));
      // the written piece came out a touch wider than measured: give back a letter
      while (k > 1 && pb.w * pb.ws > room) pb = build(hyphenated(rest, --k));
      if (rest === nodes) pb.wsp = nodes.gapWs || null;
      place(pb, g);
      push();
      rest = rest.slice(k);
    }
  }

  push();
  if (para.trail && !para.display) lines[lines.length - 1].trail = para.trail;
}
