// A sentence is written on one line, and we know what it was meant to say. To
// cut it into letters, the ink is first over-cut into small pieces: at every
// pen lift, and inside strokes wherever the pen turns (the bottoms and tops of
// strokes, and where it swings back to the left). A join between two letters
// always passes through one of those turns. A dynamic program then finds the
// grouping of pieces into letters that best matches the writer's own letter
// shapes, in order, with word breaks at the wide gaps. Letters or whole words
// the writer left out are skipped and stray ink is left unlabeled, so one slip
// doesn't shift every letter after it. Each letter also gets a confidence: a
// piece of ink that matches its letter badly is probably cut wrong.
import { sampleGlyph } from '../glyph/synth.js';
import { textLabels } from './labels.js';
import { makeGroup } from './segment.js';
import { clamp } from '../util.js';

const REC_STEP = 0.02;
const REC_N = 20;

// points every `step` along a raw stroke, remembering which raw point each came from
function arcSample(raw, step) {
  const out = [{ x: raw[0][0], y: raw[0][1], i: 0 }];
  let acc = 0;
  for (let k = 1; k < raw.length; k++) {
    let ax = raw[k - 1][0];
    let ay = raw[k - 1][1];
    const bx = raw[k][0];
    const by = raw[k][1];
    let d = Math.hypot(bx - ax, by - ay);
    while (d > 1e-9 && acc + d >= step) {
      const u = (step - acc) / d;
      ax += (bx - ax) * u;
      ay += (by - ay) * u;
      d = Math.hypot(bx - ax, by - ay);
      acc = 0;
      out.push({ x: ax, y: ay, i: k });
    }
    acc += d;
  }
  const L = raw[raw.length - 1];
  const e = out[out.length - 1];
  if (Math.hypot(L[0] - e.x, L[1] - e.y) > step * 0.3) out.push({ x: L[0], y: L[1], i: raw.length - 1 });
  return out;
}
// stroke direction as a doubled angle, so a line drawn either way matches
function withDirs(pts) {
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const c = dx / l;
    const s = dy / l;
    pts[k].c2 = c * c - s * s;
    pts[k].s2 = 2 * c * s;
  }
  return pts;
}

// where a stroke could be cut between two letters: its lowest and highest
// points and where it turns back left, a little way from the ends
function cutCandidates(r) {
  const n = r.length;
  const W = 3;
  const P = 0.025;
  const cand = [];
  const ext = (key, sign) => {
    for (let i = W; i < n - W; i++) {
      const v = sign * r[i][key];
      let top = true;
      let lo1 = Infinity;
      let lo2 = Infinity;
      for (let k = i - W; k <= i + W; k++)
        if (sign * r[k][key] > v + 1e-9) {
          top = false;
          break;
        }
      if (!top) continue;
      for (let k = Math.max(0, i - 3 * W); k < i; k++) lo1 = Math.min(lo1, sign * r[k][key]);
      for (let k = i + 1; k <= Math.min(n - 1, i + 3 * W); k++) lo2 = Math.min(lo2, sign * r[k][key]);
      if (v - lo1 > P && v - lo2 > P) cand.push(i);
    }
  };
  ext('y', 1);
  ext('y', -1);
  ext('x', 1);
  cand.sort((a, b) => a - b);
  const keep = [];
  for (const c of cand) if (c >= W && c <= n - 1 - W && (!keep.length || c - keep[keep.length - 1] >= W)) keep.push(c);
  // long smooth runs (a crossbar shared by "tt", a long join) get a few
  // evenly spaced cuts too, so they can be shared out between letters
  const RUN = 18;
  const out = [];
  const ends = [0].concat(keep, [n - 1]);
  for (let k = 0; k + 1 < ends.length; k++) {
    const a = ends[k];
    const b = ends[k + 1];
    if (k > 0) out.push(a);
    const m = Math.floor((b - a) / RUN);
    for (let q = 1; q <= m; q++) out.push(Math.round(a + ((b - a) * q) / (m + 1)));
  }
  return out.filter((c) => c >= W && c <= n - 1 - W);
}

// Which strokes were one stroke when written (pieces of a stroke that was
// later cut continue each other in time and place): an id per stroke.
function strokeOrigins(strokes) {
  const order = strokes.map((s, i) => i).filter((i) => strokes[i].length && strokes[i][0][2] != null);
  order.sort((a, b) => strokes[a][0][2] - strokes[b][0][2]);
  const id = strokes.map((s, i) => i);
  for (let a = 0; a < order.length; a++) {
    const S = strokes[order[a]];
    const f = S[0];
    for (let b = a - 1; b >= 0 && b >= a - 6; b--) {
      const T = strokes[order[b]];
      const e = T[T.length - 1];
      if (e[2] == null) continue;
      const dt = f[2] - e[2];
      if (dt >= 0 && dt < 20 && Math.hypot(f[0] - e[0], f[1] - e[1]) < 0.06) {
        id[order[a]] = id[order[b]];
        break;
      }
    }
  }
  return id;
}

// A unit: one or more raw stroke pieces that are cut or kept together.
function makeUnit(parts) {
  const pts = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let len = 0;
  for (const p of parts) {
    const r = withDirs(arcSample(p.raw.length > 1 ? p.raw : [p.raw[0], [p.raw[0][0] + 0.01, p.raw[0][1]]], REC_STEP));
    for (const q of r) {
      pts.push(q);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    len += polyLen(p.raw);
  }
  const cx = pts.reduce((t, q) => t + q.x, 0) / pts.length;
  return { parts, pts, minX, maxX, minY, maxY, len, cx };
}
const polyLen = (raw) => {
  let l = 0;
  for (let k = 1; k < raw.length; k++) l += Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1]);
  return l;
};

// what a character should look like: the writer's own forms where they've
// trained it (the most common variants), otherwise the form the app would
// draw for it
function recTemplates(model, ch, cache) {
  if (cache.has(ch)) return cache.get(ch);
  const glyphs = [];
  const entry = model.chars[ch];
  if (entry) for (const v of entry.variants.slice(0, 3)) glyphs.push(v.medoid);
  else {
    let g = null;
    try {
      g = sampleGlyph(model, ch, { randomness: 0, seed: 'read', formality: 1 });
    } catch {
      g = null;
    }
    if (g && g.strokes && g.strokes.length) glyphs.push(g);
  }
  const out = glyphs
    .map((g) => {
      // a dot is a single point: give it a tiny length so it still has a shape
      const raw = g.strokes
        .filter((s) => s.length)
        .map((s) => (s.length > 1 ? s : [s[0], { x: s[0].x + 0.01, y: s[0].y }]).map((p) => [p.x, p.y]));
      const all = [];
      for (const r of raw) all.push(...withDirs(arcSample(r, REC_STEP)));
      if (!all.length) return null;
      const pts = pickN(all, REC_N);
      let minX = Infinity;
      let maxX = -Infinity;
      for (const q of all) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
      }
      let minY = Infinity;
      let maxY = -Infinity;
      for (const q of all) {
        minY = Math.min(minY, q.y);
        maxY = Math.max(maxY, q.y);
      }
      return {
        pts,
        cx: all.reduce((t, q) => t + q.x, 0) / all.length,
        w: maxX - minX,
        h: maxY - minY,
        ys: all.map((q) => q.y),
      };
    })
    .filter(Boolean);
  const t = { trained: !!entry, forms: out };
  cache.set(ch, t);
  return t;
}
const pickN = (pts, n) =>
  pts.length <= n
    ? pts.slice()
    : Array.from({ length: n }, (_, k) => pts[Math.round((k * (pts.length - 1)) / (n - 1))]);

// how far apart two point clouds are (each point to its nearest in the
// other, counting direction a little), both ways
function cloudDist(A, B, bx, s) {
  const tau = 0.3 * s;
  const lam = 0.05 * s * (0.05 * s);
  const nb = B.length;
  const minB = new Array(nb).fill(Infinity);
  let sumA = 0;
  for (const a of A) {
    let m = Infinity;
    for (let k = 0; k < nb; k++) {
      const b = B[k];
      const dx = a.x - (b.x + bx);
      const dy = a.y - b.y;
      const dc = a.c2 - b.c2;
      const ds = a.s2 - b.s2;
      const d = dx * dx + dy * dy + lam * (dc * dc + ds * ds);
      if (d < m) m = d;
      if (d < minB[k]) minB[k] = d;
    }
    sumA += Math.min(Math.sqrt(m), tau);
  }
  let sumB = 0;
  for (const d of minB) sumB += Math.min(Math.sqrt(d), tau);
  return [sumA / A.length, sumB / nb];
}

// Line up `units` (pieces, or letters already cut) with the characters of
// `text`: a dynamic program over (units used, letters done) that writes a letter
// from a few units, skips a letter or a whole word, or leaves a unit as stray ink,
// whichever costs least. span: the most units one letter may take; trust: the
// units were cut by hand. -> { groups, labels, missing (label indices), scale }
function alignInk(units, text, model, span, trust) {
  const labels = textLabels(text);
  if (!units.length) return { groups: [], labels, missing: labels.map((_, j) => j) };
  const cache = new Map();
  const tmpl = labels.map((l) => recTemplates(model, l.ch, cache));
  const fit = fitToModel(units, tmpl);
  const ink = { units, labels, tmpl, model, ...fit, style: model.style || {} };
  const cuts = cutCosts(ink);
  const path = bestPath(ink, cuts, letterCoster(ink), span);
  return toGroups(ink, path, trust);
}

// The writer's size and baseline compared to the model: match the spread and the
// middle of all the ink's heights to what the text should have. -> { s, dy }
function fitToModel(units, tmpl) {
  const inkY = [];
  const expY = [];
  for (const u of units) for (const q of u.pts) inkY.push(q.y);
  for (const t of tmpl) if (t.forms[0]) expY.push(...pickN(t.forms[0].ys, 30));
  const q = (arr, f) => {
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(f * a.length))];
  };
  let s = 1;
  let dy = 0;
  if (expY.length > 10 && inkY.length > 10) {
    s = clamp((q(inkY, 0.9) - q(inkY, 0.1)) / Math.max(0.05, q(expY, 0.9) - q(expY, 0.1)), 0.5, 2);
    dy = q(inkY, 0.5) - s * q(expY, 0.5);
    if (Math.abs(dy) > 0.25 * s) dy = clamp(dy, -0.25 * s, 0.25 * s); // the guides keep it near the line
  }
  return { s, dy };
}

// What cutting between units k-1 and k costs, as a letter break and as a word
// break, from the gap there and whether the cut falls inside one stroke (the pen
// didn't lift). -> { letterCut(k), wordCut(k), inStroke[k] }
function cutCosts({ units, model, style, s, dy }) {
  const P = units.length;
  const X = ((model.style && model.style.zones && model.style.zones.X) || 0.5) * s;
  const lg = ((style.letterGap && style.letterGap.mean) || 0.1) * s;
  const wg = ((style.wordGap && style.wordGap.mean) || 0.45) * s;
  const mid = lg + 0.45 * (wg - lg);
  // the gap at each possible cut, measured on the body of the letters (loops below
  // the line and ascenders often reach over their neighbours)
  const core = units.map((u) => {
    let a = Infinity;
    let b = -Infinity;
    for (const p of u.pts) {
      if (p.y > dy - 1.25 * X && p.y < dy + 0.2 * X) {
        a = Math.min(a, p.x);
        b = Math.max(b, p.x);
      }
    }
    return a <= b ? [a, b] : null;
  });
  const preMax = new Array(P).fill(-Infinity);
  const sufMin = new Array(P + 1).fill(Infinity);
  for (let k = 0; k < P; k++) preMax[k] = Math.max(k ? preMax[k - 1] : -Infinity, core[k] ? core[k][1] : -Infinity);
  for (let k = P - 1; k >= 0; k--) sufMin[k] = Math.min(sufMin[k + 1], core[k] ? core[k][0] : Infinity);
  const gapAt = (k) => (k <= 0 || k >= P ? Infinity : sufMin[k] - preMax[k - 1]);
  const origin = units.map((u) => u.parts.map((p) => p.origin));
  const lastIdx = new Map();
  const firstIdx = new Map();
  origin.forEach((os, k) =>
    os.forEach((o) => {
      if (!firstIdx.has(o)) firstIdx.set(o, k);
      lastIdx.set(o, k);
    }),
  );
  const inStroke = new Array(P + 1).fill(false);
  for (const [o, a] of firstIdx) for (let k = a + 1; k <= lastIdx.get(o); k++) inStroke[k] = true;
  const ramp = (v) => clamp(v, 0, 4);
  return {
    inStroke,
    letterCut: (k) => (inStroke[k] ? 0.02 : 0) + 0.25 * ramp((gapAt(k) - mid) / (0.12 * s)),
    wordCut: (k) => (inStroke[k] ? 1.2 : 0) + 0.3 * ramp((mid - gapAt(k)) / (0.1 * s)),
  };
}

// letterCost(a, b, j): how well units a..b-1 match letter j (memoized)
function letterCoster({ units, labels, tmpl, style, s, dy }) {
  const P = units.length;
  const clouds = new Map();
  function cloud(a, b) {
    const key = a * (P + 1) + b;
    let c = clouds.get(key);
    if (c) return c;
    const all = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let len = 0;
    for (let k = a; k < b; k++) {
      const u = units[k];
      all.push(...u.pts);
      minX = Math.min(minX, u.minX);
      maxX = Math.max(maxX, u.maxX);
      minY = Math.min(minY, u.minY);
      maxY = Math.max(maxY, u.maxY);
      len += u.len;
    }
    c = {
      pts: pickN(all, REC_N),
      cx: all.reduce((t, p) => t + p.x, 0) / all.length,
      w: maxX - minX,
      h: maxY - minY,
      len,
    };
    clouds.set(key, c);
    return c;
  }
  const costs = new Map();
  return (a, b, j) => {
    const key = a * (P + 1) + b + '|' + labels[j].ch;
    if (costs.has(key)) return costs.get(key);
    const c = cloud(a, b);
    const t = tmpl[j];
    let best = Infinity;
    if (!t.forms.length)
      best = 0.35 + 0.15 * Math.abs(Math.log((c.w + 0.1 * s) / (((style.meanWidth || 0.42) + 0.1) * s)));
    for (const f of t.forms) {
      const tw = f.w * s;
      const wr = (c.w + 0.12 * s) / (tw + 0.12 * s);
      if (wr > 3.2 || wr < 0.3) continue;
      // overall height too (a full stop is a dot, not part of a letter's tail)
      const hr = 0.12 * Math.abs(Math.log((c.h + 0.12 * s) / (f.h * s + 0.12 * s)));
      const scaled = f.pts.map((p) => ({ x: p.x * s, y: p.y * s + dy, c2: p.c2, s2: p.s2 }));
      for (const sh of [-0.06, 0, 0.06]) {
        const bx = c.cx - f.cx * s + sh * s;
        const [dInk, dForm] = cloudDist(c.pts, scaled, bx, s);
        const v =
          (0.7 * dInk + dForm) / (1.7 * s) +
          0.12 * Math.abs(Math.log(wr)) +
          0.25 * Math.max(0, Math.log(wr) - 0.35) +
          hr;
        if (v < best) best = v;
      }
    }
    // a poor match costs more than leaving the letter out, so missing ink is
    // skipped rather than forcing letters onto scraps of their neighbours
    if (best < Infinity) best += 3 * Math.max(0, best - 0.14);
    costs.set(key, best);
    return best;
  };
}

// small marks (full stops, commas, quotes) are always their own strokes, never a
// scrap cut from the end of a letter
const LIFTED = new Set(Array.from('.,;:\'’‘"“”`´'));
const SKIP_LETTER = 0.6;

// The cheapest way through: [{ a, b (units), j (letter, or -1 for stray ink), cost }]
function bestPath({ units, labels, tmpl, style, s }, cuts, letterCost, span) {
  const P = units.length;
  const L = labels.length;
  const wg = ((style.wordGap && style.wordGap.mean) || 0.45) * s;
  // rough position each letter should start at, so far-off pairings aren't tried
  const x0 = Math.min(...units.map((u) => u.minX));
  const x1 = Math.max(...units.map((u) => u.maxX));
  const wOf = (j) => ((tmpl[j].forms[0] ? tmpl[j].forms[0].w : style.meanWidth || 0.42) + 0.1) * s;
  const ex = [];
  let acc = 0;
  labels.forEach((l, j) => {
    ex.push(acc);
    acc += wOf(j) + (j + 1 < L && labels[j + 1].word !== l.word ? wg : 0);
  });
  const exX = (j) => x0 + (acc ? (ex[j] / acc) * (x1 - x0) : 0);
  const band = 0.4 * (x1 - x0) + 2 * s;
  const maxW = (j) => 2.6 * wOf(j) + 0.3 * s;
  const junk = (k) => 0.12 + (0.6 * units[k].len) / s;
  const wordStart = labels.map((l, j) => j === 0 || labels[j - 1].word !== l.word);
  const nextWord = labels.map((l, j) => {
    let k = j;
    while (k < L && labels[k].word === l.word) k++;
    return k;
  });
  const { inStroke } = cuts;
  const D = new Float64Array((P + 1) * (L + 1)).fill(Infinity);
  const B = new Array((P + 1) * (L + 1));
  const id = (k, j) => k * (L + 1) + j;
  const relax = (k, j, v, from) => {
    const i = id(k, j);
    if (v < D[i]) {
      D[i] = v;
      B[i] = from;
    }
  };
  D[0] = 0;
  for (let k = 0; k <= P; k++) {
    for (let j = 0; j <= L; j++) {
      const cur = D[id(k, j)];
      if (cur === Infinity) continue;
      if (j < L) {
        relax(k, j + 1, cur + SKIP_LETTER, { k, j, t: 'skip' });
        if (wordStart[j]) relax(k, nextWord[j], cur + 0.4 + 0.3 * (nextWord[j] - j), { k, j, t: 'skipword' });
      }
      if (k < P) relax(k + 1, j, cur + junk(k), { k, j, t: 'junk' });
      if (j < L && k < P && Math.abs(units[k].minX - exX(j)) < band && !(LIFTED.has(labels[j].ch) && inStroke[k])) {
        let mx = -Infinity;
        let mn = Infinity;
        for (let k2 = k + 1; k2 <= Math.min(P, k + span); k2++) {
          mx = Math.max(mx, units[k2 - 1].maxX);
          mn = Math.min(mn, units[k2 - 1].minX);
          if (mx - mn > maxW(j)) break;
          if (LIFTED.has(labels[j].ch) && inStroke[k2]) continue;
          const c = letterCost(k, k2, j);
          if (c === Infinity) continue;
          const cut =
            k2 < P && j + 1 < L ? (labels[j + 1].word === labels[j].word ? cuts.letterCut(k2) : cuts.wordCut(k2)) : 0;
          relax(k2, j + 1, cur + c + cut, { k, j, t: 'char', c });
        }
      }
    }
  }
  // walk back through the best path
  const segs = [];
  let k = P;
  let j = L;
  while (k > 0 || j > 0) {
    const b = B[id(k, j)];
    if (!b) break;
    if (b.t === 'char') segs.push({ a: b.k, b: k, j: b.j, cost: b.c });
    else if (b.t === 'junk') segs.push({ a: b.k, b: k, j: -1 });
    k = b.k;
    j = b.j;
  }
  return segs.reverse();
}

// The path as groups of strokes, each a letter (with how sure we are) or stray ink.
function toGroups({ units, labels, tmpl, s }, segs, trust) {
  // runs of stray pieces become one unlabeled group
  const merged = [];
  for (const g of segs) {
    const last = merged[merged.length - 1];
    if (g.j < 0 && last && last.j < 0 && last.b === g.a) last.b = g.b;
    else merged.push(Object.assign({}, g));
  }
  const used = new Set(merged.filter((g) => g.j >= 0).map((g) => g.j));
  const groups = merged.map((g) => {
    const parts = [];
    for (let u = g.a; u < g.b; u++) parts.push(...units[u].parts);
    const grp = makeGroup(joinParts(parts));
    grp.origins = Array.from(new Set(parts.map((p) => p.origin)));
    if (g.j >= 0) {
      grp.label = Object.assign({ i: g.j }, labels[g.j]);
      grp.cost = +g.cost.toFixed(3);
      // a badly matching letter was probably cut wrong; untrained letters are
      // compared with the app's own forms, so they get more room (boxes the writer
      // fixed by hand are taken mostly on trust)
      grp.sure = g.cost < (tmpl[g.j].trained ? 0.2 : 0.3) * (trust ? 1.4 : 1);
    } else grp.label = null;
    return grp;
  });
  return { groups, labels, missing: labels.map((_, j) => j).filter((j) => !used.has(j)), scale: s };
}

// pieces of the same stroke that ended up in one letter are put back together
function joinParts(parts) {
  const sorted = parts.slice().sort((p, q) => p.origin - q.origin || p.seq - q.seq);
  const out = [];
  let prev = null;
  for (const p of sorted) {
    if (prev && prev.origin === p.origin && prev.seq + 1 === p.seq)
      out[out.length - 1] = out[out.length - 1].concat(p.raw.slice(1));
    else out.push(p.raw.slice());
    prev = p;
  }
  return out.sort((a, b) => (a[0][2] || 0) - (b[0][2] || 0));
}

// Read a freshly written line: cut it into pieces and line them up with the text.
export function readLine(strokes, text, model) {
  const raw = strokes.filter((s) => s && s.length);
  const units = [];
  raw.forEach((st, si) => {
    if (st.length < 2) {
      units.push(makeUnit([{ raw: st, origin: si, seq: 0 }]));
      return;
    }
    const r = arcSample(st, REC_STEP);
    for (const p of r) {
      p.x = +p.x;
      p.y = +p.y;
    }
    // light smoothing so pen jitter doesn't make turns
    const sm = r.map((p, k) => {
      const a = r[Math.max(0, k - 1)];
      const b = r[Math.min(r.length - 1, k + 1)];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, i: p.i };
    });
    const cuts = cutCandidates(sm).map((c) => sm[c].i);
    const idx = [0];
    for (const c of cuts) if (c - idx[idx.length - 1] >= 2 && st.length - 1 - c >= 2) idx.push(c);
    idx.push(st.length - 1);
    for (let k = 0; k + 1 < idx.length; k++)
      units.push(makeUnit([{ raw: st.slice(idx[k], idx[k + 1] + 1), origin: si, seq: k }]));
  });
  units.sort((a, b) => a.cx - b.cx);
  return alignInk(units, text, model, 14);
}

// Label letters that are already cut (after the writer fixed the boxes by hand).
export function labelGroups(groups, text, model) {
  const all = [];
  groups.forEach((g) => g.strokes.forEach((s) => all.push(s)));
  const ids = strokeOrigins(all);
  let n = 0;
  // seq keeps pieces of one stroke in order when they're joined back up
  const units = groups.map((g) => makeUnit(g.strokes.map((s) => ({ raw: s, origin: ids[n], seq: n++ }))));
  units.sort((a, b) => a.cx - b.cx);
  return alignInk(units, text, model, 1, true);
}
