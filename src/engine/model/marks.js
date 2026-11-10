// A trained mark is a strike or a box drawn over a guide word whose extent is
// known (ref: x0..x1, top..bot, mid = middle of the x-height, in units). Each
// point is stored relative to that word: inside it, as a fraction; outside it,
// as an absolute distance past the nearest edge. Drawn over other text, the
// mark then stretches along its length but keeps its overshoot, corners and
// padding, the way a real pen would.
export function prepareMarks(marks) {
  const out = { strike: [], box: [] };
  for (const m of marks) {
    if (!m || !out[m.kind] || !m.ref || !Array.isArray(m.strokes)) continue;
    const r = m.ref;
    const w = Math.max(1e-3, r.x1 - r.x0);
    const h = Math.max(1e-3, r.bot - r.top);
    const hx = (x) => (x < r.x0 ? [-1, x - r.x0] : x > r.x1 ? [1, x - r.x1] : [0, (x - r.x0) / w]);
    const hy = (y) => (y < r.top ? [-1, y - r.top] : y > r.bot ? [1, y - r.bot] : [0, (y - r.top) / h]);
    const strokes = m.strokes
      .filter((st) => st && st.length)
      .map((st) =>
        st.map((q) => {
          const [kx, vx] = hx(+q[0]);
          const [ky, vy] = m.kind === 'strike' ? [2, +q[1] - r.mid] : hy(+q[1]);
          return { kx, vx, ky, vy };
        }),
      );
    if (strokes.length) out[m.kind].push({ id: m.id, kind: m.kind, strokes, refW: w, refH: h });
  }
  return out;
}
