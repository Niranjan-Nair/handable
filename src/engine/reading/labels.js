// The letters a written line should contain: one label per character of the text,
// { ch, word (its index), ctx (its place in the word: solo, start, mid or end) }.
export function textLabels(text) {
  const labels = [];

  String(text)
    .split(/\s+/)
    .filter(Boolean)
    .forEach((w, wi) => {
      const chars = Array.from(w);

      chars.forEach((ch, i) =>
        labels.push({
          ch,
          word: wi,
          ctx: chars.length === 1 ? 'solo' : i === 0 ? 'start' : i === chars.length - 1 ? 'end' : 'mid',
        }),
      );
    });

  return labels;
}
