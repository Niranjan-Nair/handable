// Small DOM helpers shared by the whole app.
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

// text made safe to put in HTML
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// a message in the status bar, for ms milliseconds
let statusTimer;

export function status(msg, ms = 2500) {
  $('#status').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($('#status').textContent = ''), ms);
}

// save content as a file called name
export function download(content, name, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// mark the button in a chooser whose data-val is v
export const markChoice = (box, v) =>
  box.querySelectorAll('[data-val]').forEach((b) => b.classList.toggle('on', b.dataset.val === String(v)));
