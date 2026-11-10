// Where the equations are in a text: [{ a, b, open, display }] (a … b includes the
// delimiters, each open characters long). An equation is written
//   \(…\)  or  $…$        in the line of text
//   \[…\]  or  $$…$$      on a line of its own, centered
// \$ is a dollar sign, and so is any $ that can't be a delimiter, so prices and the
// like are never taken for math: an opening $ has to be followed by something other
// than a space, a closing $ can't be followed by a digit ($5 and $10), and $…$ stays
// within its paragraph; a $$ with no $$ to close it is two dollar signs. The editor
// and the writing both use this, so they always agree on what's an equation.
export function mathSpans(text) {
  const src = String(text);
  const out = [];
  const n = src.length;

  // the closing delimiter from j on, or -1 (an escaped character is never one)
  const find = (j, tok, ok) => {
    for (; j < n; j++) {
      if (src[j] === '\\' && !src.startsWith(tok, j)) {
        j++;
        continue;
      }

      if (src.startsWith(tok, j) && (!ok || ok(j))) return j;
      if (ok && (src[j] === '\n' || src[j] === '\f')) return -1;
    }

    return -1;
  };

  for (let i = 0; i < n; i++) {
    const c = src[i];

    if (c === '\\') {
      const d = src[i + 1];

      if (d === '(' || d === '[') {
        const close = find(i + 2, d === '(' ? '\\)' : '\\]');

        if (close >= 0) {
          out.push({ a: i, b: close + 2, open: 2, display: d === '[' });
          i = close + 1;
          continue;
        }
      }

      i++; // an escaped character (\$ among them)
      continue;
    }

    if (c !== '$') continue;

    if (src[i + 1] === '$') {
      const close = find(i + 2, '$$');

      if (close < 0) {
        i++;
        continue;
      }

      out.push({ a: i, b: close + 2, open: 2, display: true });
      i = close + 1;
      continue;
    }

    if (i + 1 >= n || /\s/.test(src[i + 1])) continue;

    const close = find(i + 1, '$', (j) => !/[0-9]/.test(src[j + 1] || ''));
    if (close < 0) continue;

    out.push({ a: i, b: close + 1, open: 1, display: false });
    i = close;
  }

  return out;
}
