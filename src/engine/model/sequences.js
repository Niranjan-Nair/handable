// Connected writing: which letters the writer joins (the pen kept down from one
// to the next), and their joined ligatures.
const JOIN_DT = 45;
const JOIN_DIST = 0.15;

// Was the pen kept down from sample L into sample R? Letters cut from one
// continuous stroke end / start within a few milliseconds of each other.
export function joinBetween(L, R) {
  let best = null;
  (L.strokes || []).forEach((a, i) => {
    const e = a[a.length - 1];
    if (!e || e[2] == null) return;
    (R.strokes || []).forEach((b, j) => {
      const f = b[0];
      if (!f || f[2] == null) return;
      const dt = f[2] - e[2];
      // tiny time gaps allow a bigger jump (fast flick between letters)
      if (dt < 0 || dt > JOIN_DT || Math.hypot(f[0] - e[0], f[1] - e[1]) > (dt <= 25 ? 0.5 : JOIN_DIST)) return;
      if (!best || dt < best.dt) best = { i, j, dt };
    });
  });
  return best;
}

// Group sentence samples back into the words they were written in.
function sentenceWords(samples) {
  const words = [];
  const bySeq = new Map();
  let cur = null;
  let prevIdx = -2;
  let prevCreated = 0;
  samples.forEach((s, idx) => {
    if (!s || s.source !== 'sentence' || !s.char) {
      cur = null;
      return;
    }
    if (s.seq && s.seq.id != null) {
      const key = s.seq.id + '|' + s.seq.w;
      if (!bySeq.has(key)) bySeq.set(key, []);
      bySeq.get(key).push(s);
      return;
    }
    // older samples: consecutive in the list, saved together, word edges from ctx
    const contiguous = idx === prevIdx + 1 && Math.abs((s.created || 0) - prevCreated) < 2000;
    if (!cur || !contiguous || s.ctx === 'start' || s.ctx === 'solo') {
      cur = [];
      words.push(cur);
    }
    cur.push(s);
    if (s.ctx === 'end' || s.ctx === 'solo') cur = null;
    prevIdx = idx;
    prevCreated = s.created || 0;
  });
  for (const arr of bySeq.values()) words.push(arr.sort((a, b) => a.seq.i - b.seq.i));
  return words.filter((w) => w.length);
}

// Rejoin the strokes of consecutive connected samples into continuous strokes.
function mergeConnected(run) {
  const owner = new Map();
  const list = [];
  run.forEach((s) =>
    s.strokes.forEach((st) => {
      const m = { pts: st.map((p) => p.slice()) };
      owner.set(st, m);
      list.push(m);
    }),
  );
  for (let k = 1; k < run.length; k++) {
    const jn = joinBetween(run[k - 1], run[k]);
    if (!jn) continue;
    const A = owner.get(run[k - 1].strokes[jn.i]);
    const B = owner.get(run[k].strokes[jn.j]);
    if (!A || !B || A === B) continue;
    A.pts = A.pts.concat(B.pts);
    for (const [key, val] of owner) if (val === B) owner.set(key, A);
    list.splice(list.indexOf(B), 1);
  }
  return list.map((m) => m.pts).sort((a, b) => (a[0][2] || 0) - (b[0][2] || 0));
}

// Connection habits + ligature units from everything written in sentences.
const unitId = (run) => 'u:' + run.map((x) => x.id).join('+');

// `excluded`: ids of ligature forms the writer deleted. They are skipped as
// training forms and dropped from the join counts, like deleting a letter sample.
export function analyzeSequences(samples, excluded = new Set()) {
  const meta = new Map();
  const ngram = {};
  const out = {};
  const inn = {};
  let gn = 0;
  let gc = 0;
  const units = [];
  for (const word of sentenceWords(samples)) {
    const chars = word.map((s) => s.char);
    const joins = [];
    for (let k = 1; k < word.length; k++) joins.push(!!joinBetween(word[k - 1], word[k]));
    word.forEach((s, k) =>
      meta.set(s, {
        prev: k ? chars[k - 1] : null,
        next: k < word.length - 1 ? chars[k + 1] : null,
        joinL: k ? joins[k - 1] : false,
        joinR: k < word.length - 1 ? joins[k] : false,
      }),
    );
    joins.forEach((j, k) => {
      if (j && excluded.has(unitId(word.slice(k, k + 2)))) return;
      const a = chars[k];
      const b = chars[k + 1];
      gn++;
      if (j) gc++;
      (out[a] = out[a] || { n: 0, c: 0 }).n++;
      if (j) out[a].c++;
      (inn[b] = inn[b] || { n: 0, c: 0 }).n++;
      if (j) inn[b].c++;
    });
    for (const L of [2, 3])
      for (let k = 0; k + L <= word.length; k++) {
        const s = chars.slice(k, k + L).join('');
        const run = word.slice(k, k + L);
        const joined = joins.slice(k, k + L - 1).every(Boolean);
        const id = unitId(run);
        if (joined && excluded.has(id)) continue;
        const st = (ngram[s] = ngram[s] || { n: 0, c: 0 });
        st.n++;
        if (!joined) continue;
        st.c++;
        const ctx = word.length === L ? 'solo' : k === 0 ? 'start' : k + L === word.length ? 'end' : 'mid';
        units.push({ id, char: s, ctx, source: 'unit', strokes: mergeConnected(run) });
      }
  }
  return { meta, units, links: { ngram, out, inn, gn, gc } };
}

// probability of writing the n-gram `s` as one of the writer's own joined
// ligatures: purely how often they actually joined it (lightly smoothed)
export function unitProb(model, s) {
  const st = (model.links && model.links.ngram[s]) || { n: 0, c: 0 };
  return (st.c + 0.5) / (st.n + 1);
}

export function linkStats(model) {
  const L = model.links || { ngram: {}, out: {}, gn: 0, gc: 0 };
  const combos = Object.keys(L.ngram)
    .map((s) => ({ s, n: L.ngram[s].n, c: L.ngram[s].c, samples: model.units[s] ? model.units[s].count : 0 }))
    .sort((a, b) => b.c - a.c || b.n - a.n);
  const outs = Object.keys(L.out)
    .map((a) => ({ a, n: L.out[a].n, c: L.out[a].c }))
    .filter((x) => x.c)
    .sort((x, y) => y.c / y.n - x.c / x.n);
  return { combos, outs, pairs: L.gn, connected: L.gc };
}
