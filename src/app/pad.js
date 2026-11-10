// A writing pad: a canvas you write on with a pen, finger or mouse, ruled like a
// notebook. Strokes are kept in units (1 = baseline to ascender), as
// [[x, y, t (ms), pressure | null], …].
export class Pad {
  constructor(canvas, cfg) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = cfg;
    this.strokes = [];
    this.cur = null;
    this.t0 = null;
    this.overlay = null;
    this.tapHandler = null;
    this.onChange = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.cfg.fluid ? this.c.clientWidth || 900 : this.cfg.width; // clientWidth excludes the border
    const h = this.cfg.height;
    this.w = w;
    this.h = h;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    if (!this.cfg.fluid) this.c.style.width = w + 'px';
    this.c.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  toUnits(e) {
    const r = this.c.getBoundingClientRect();
    // measured from inside the pad's border (pads are drawn as boxes)
    return [
      (e.clientX - r.left - this.c.clientLeft - this.cfg.originX) / this.cfg.unit,
      (e.clientY - r.top - this.c.clientTop - this.cfg.baseline) / this.cfg.unit,
    ];
  }
  toPx(x, y) {
    return [this.cfg.originX + x * this.cfg.unit, this.cfg.baseline + y * this.cfg.unit];
  }
  down(e) {
    if (this.tapHandler) {
      e.preventDefault();
      const [x, y] = this.toUnits(e);
      this.tapHandler(x, y, e);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.c.setPointerCapture(e.pointerId);
    if (this.t0 == null) this.t0 = e.timeStamp || performance.now();
    this.cur = [];
    this.strokes.push(this.cur);
    this.addPoint(e);
    this.draw();
  }
  move(e) {
    if (!this.cur) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) this.addPoint(ev);
    this.draw();
  }
  up() {
    if (!this.cur) return;
    this.cur = null;
    if (this.onChange) this.onChange();
  }
  addPoint(e) {
    const [x, y] = this.toUnits(e);
    const t = Math.max(0, Math.round((e.timeStamp || performance.now()) - this.t0));
    const p = e.pointerType === 'pen' ? +(+e.pressure).toFixed(3) : null;
    this.cur.push([+x.toFixed(4), +y.toFixed(4), t, p]);
  }
  undo() {
    this.strokes.pop();
    if (!this.strokes.length) this.t0 = null;
    this.draw();
    if (this.onChange) this.onChange();
  }
  clear() {
    this.strokes = [];
    this.t0 = null;
    this.draw();
    if (this.onChange) this.onChange();
  }
  isEmpty() {
    return !this.strokes.length;
  }
  line(y, style, dash) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = style;
    ctx.lineWidth = 1;
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(this.w, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawStroke(s, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 0.05 * this.cfg.unit;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (s.length === 1) {
      const [x, y] = this.toPx(s[0][0], s[0][1]);
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    s.forEach((p, i) => {
      const [x, y] = this.toPx(p[0], p[1]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  draw() {
    const ctx = this.ctx;
    const b = this.cfg.baseline;
    const u = this.cfg.unit;
    ctx.clearRect(0, 0, this.w, this.h);
    // notebook ruling: solid baseline, dashed x-height, dotted ascender / descender
    this.line(b - u, '#c3d3e2', [2, 4]);
    this.line(b - 0.5 * u, '#a3bdd6', [6, 5]);
    this.line(b, '#7f9fbf');
    this.line(b + 0.5 * u, '#c3d3e2', [2, 4]);
    if (this.underlay) this.underlay(ctx, this);
    if (this.overlay) {
      this.overlay(ctx, this);
      return;
    }
    for (const s of this.strokes) this.drawStroke(s, '#45484e');
  }
}
