// Words (lists of parsed nodes, see text/rich.js) and list markers, as boxes.
import { finishGlyph } from '../glyph/synth.js';
import { addBox, emptyBox, handStroke } from './boxes.js';
import { mathList, SCRIPT } from './math.js';
import { runBox } from './runs.js';

// script levels (['sup', 'sub', …]) -> scale and baseline shift
function levelOf(writer, lv) {
  let s = 1;
  let dy = 0;

  for (const l of lv) {
    dy += l === 'sup' ? -0.9 * writer.X * s : 0.25 * s;
    s *= SCRIPT;
  }

  return { s, dy };
}

// consecutive nodes with the same format, as runs: { chars, sis } of plain letters,
// or { math } for an equation
function formatRuns(nodes) {
  const runs = [];

  for (const nd of nodes) {
    const deco = { u: nd.u, st: nd.st, box: nd.box, hl: nd.hl };
    const key = nd.lv.join(',') + '|' + nd.u + '|' + nd.st + '|' + nd.box + '|' + nd.hl;
    const last = runs[runs.length - 1];
    if (nd.t === 'ch' && last && last.chars && last.key === key) {
      last.chars.push(nd.ch);
      last.sis.push([nd.si, nd.se]);
    } else if (nd.t === 'ch') runs.push({ key, chars: [nd.ch], sis: [[nd.si, nd.se]], lv: nd.lv, ...deco });
    else runs.push({ math: nd, lv: nd.lv, ...deco });
  }

  return runs;
}

export function wordBox(writer, nodes) {
  const runs = formatRuns(nodes);
  const nChars = nodes.filter((n) => n.t === 'ch').length;
  const b = emptyBox();
  let x = 0;
  let ci = 0;
  let prevS = 1;
  let prevCh = null;

  runs.forEach((run, k) => {
    const { s, dy } = levelOf(writer, run.lv);

    const rb = run.math
      ? mathList(writer, run.math.tree, s, run.math.display)
      : runBox(writer, run.chars, s, { start: ci, n: nChars, prev: prevCh, sis: run.sis });

    // an equation is one place for a caret (it's edited as TeX once the caret is inside)
    if (run.math && run.math.si != null)
      rb.cmap = [{ s: run.math.si, e: run.math.se, a: 0, b: rb.w, dy: 0, sc: s, math: true }];
    if (k > 0) x += writer.letterGap() * Math.min(s, prevS);
    addBox(b, rb, x, dy);
    // decorations, merged across words and drawn once the line is placed
    const span = { a: x, b: x + rb.w, top: rb.top + dy, bot: rb.bot + dy, s, mid: dy - 0.5 * writer.X * s };
    if (run.u) b.deco.push({ k: 'u', ...span });
    if (run.st) b.deco.push({ k: 'st', ...span });
    if (run.box) b.deco.push({ k: 'box', id: run.box, ...span });
    if (run.hl) b.deco.push({ k: 'hl', id: run.hl, ...span });
    x += rb.w;

    if (run.chars) {
      ci += run.chars.length;
      prevCh = run.chars[run.chars.length - 1];
    }

    prevS = s;
  });

  b.w = x;

  return b;
}

// points every little way along a polyline (so straight sides render as strokes)
function densify(pts) {
  const out = [pts[0]];

  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.02));
    for (let q = 1; q <= n; q++) out.push([x0 + ((x1 - x0) * q) / n, y0 + ((y1 - y0) * q) / n]);
  }

  return out;
}

// A list item's marker (b: the paragraph's bullet, see text/rich.js): your own - or +
// when you've written one, a dash, cross or chevron drawn by hand when you haven't,
// and a bullet as a small dot gone over a couple of times.
export function bulletBox(writer, b) {
  const { rng, seen } = writer;
  // keyed by the marker and which time it's been used, so it stays put while typing
  const n = (seen.get('bullet' + b.ch) || 0) + 1;
  seen.set('bullet' + b.ch, n);
  const key = 'bullet' + b.ch + '#' + n;
  rng.reseed('w' + key);
  // the dot is always drawn; letters and signs are your own writing
  let box = b.ch === '•' ? null : writtenMarker(writer, b);
  if (!box) box = drawnMarker(writer, b);
  box.key = key;
  box.ws = 1;
  box.src = b;

  return box;
}

function writtenMarker(writer, b) {
  const chars = Array.from(b.ch);

  const wb = wordBox(
    writer,
    chars.map((ch) => ({ t: 'ch', ch, lv: [], si: b.si, se: b.se, u: false, st: false, box: 0, hl: null })),
  );

  // (a single - + > you haven't written is drawn by hand instead)
  if (!wb.items.length && chars.length === 1 && '-+>'.includes(b.ch)) return null;

  wb.cmap = [{ s: b.si, e: b.se, a: 0, b: wb.w, dy: 0, sc: 1 }];

  return wb;
}

function drawnMarker(writer, b) {
  const { rng, X, o } = writer;
  const mid = -X * 0.5;
  const dot = b.ch === '•';
  let strokes;

  if (dot) {
    // about a third of the x-height across (clearly more than a full stop), gone round a few times
    const R = Math.max(0.085 * (X / 0.5), o.penWidth * 1.4);
    const pts = [];

    for (let k = 0; k <= 30; k++) {
      const t = k / 30;
      const a = t * 6 * Math.PI;
      const q = R * (1 - 0.85 * t);
      pts.push([R + q * Math.cos(a), mid + q * Math.sin(a)]);
    }

    strokes = [pts];
  } else {
    const L = 0.26 * (X / 0.5);

    strokes =
      b.ch === '>'
        ? [
            [
              [0, mid - L * 0.45],
              [L * 0.75, mid],
              [0, mid + L * 0.45],
            ],
          ]
        : [
            [
              [0, mid],
              [L, mid],
            ],
          ];

    if (b.ch === '+')
      strokes.push([
        [L / 2, mid - L / 2],
        [L / 2, mid + L / 2],
      ]);
  }

  const box = emptyBox();
  let w = 0;

  for (const pts of strokes) {
    // (the dot is too small to smooth: smoothing would shrink it to a point)
    const g = dot
      ? finishGlyph(b.ch, [
          densify(pts).map(([x, y]) => ({ x: x + rng.normal() * 0.003, y: y + rng.normal() * 0.003, w: 1 })),
        ])
      : handStroke(writer, pts, 0.25);

    box.items.push({ g, x: 0, y: 0, s: 1 });
    w = Math.max(w, g.width);
  }

  box.w = w;
  box.cmap = [{ s: b.si, e: b.se, a: 0, b: w, dy: 0, sc: 1 }];

  return box;
}
