// A written line, cut into letters, as training samples and spacing statistics.
import { textLabels } from './labels.js';

// a gap between two letters, kept when it's plausible (a slightly-off cut gives odd ones)
function recordGap(gaps, a, b, sameWord) {
  const gap = b.minX - a.maxX;
  if (sameWord) {
    if (gap > -0.2 && gap < 0.8) gaps.letterGaps.push(+gap.toFixed(4));
  } else if (gap > 0 && gap < 2.5) gaps.wordGaps.push(+gap.toFixed(4));
}

const sentenceSample = (makeId, label, seq, strokes) => ({
  id: makeId ? makeId() : undefined,
  char: label.ch,
  ctx: label.ctx,
  seq,
  source: 'sentence',
  strokes,
  created: Date.now(),
});

// groups: the line's letters, in order (one per character of the text), or as
// labeled by readLine / labelGroups. -> { samples, stats, unclear }
export function sentenceToSamples(groups, text, makeId) {
  if (groups.some((g) => g.label !== undefined)) return labeledToSamples(groups, text, makeId);
  const labels = textLabels(text);
  if (labels.length !== groups.length)
    throw new Error(`Expected ${labels.length} characters but found ${groups.length}.`);
  const seqId = (makeId ? makeId() : 's') + ':' + Date.now();
  const samples = groups.map((g, i) =>
    sentenceSample(makeId, labels[i], { id: seqId, i, w: labels[i].word }, g.strokes),
  );
  const gaps = { letterGaps: [], wordGaps: [] };
  for (let i = 1; i < groups.length; i++)
    recordGap(gaps, groups[i - 1], groups[i], labels[i].word === labels[i - 1].word);
  return { samples, stats: { text, ...gaps, created: Date.now() } };
}

// Letters read by readLine / labelGroups. Only letters that matched well are
// kept. Joins (and so ligatures) are learned only between letters that follow
// each other in the text and were both read cleanly, so a skipped or unclear
// letter can't make two letters look joined that weren't next to each other.
function labeledToSamples(groups, text, makeId) {
  const seqId = (makeId ? makeId() : 's') + ':' + Date.now();
  const read = groups.filter((g) => g.label).sort((a, b) => a.label.i - b.label.i);
  const samples = [];
  const gaps = { letterGaps: [], wordGaps: [] };
  let run = 0;
  let unclear = 0; // run: which unbroken stretch of letters this is
  read.forEach((g, k) => {
    const prev = read[k - 1];
    const L = g.label;
    const follows = prev && prev.sure && g.sure && prev.label.i + 1 === L.i;
    if (!follows || prev.label.word !== L.word) run++;
    if (follows) recordGap(gaps, prev, g, prev.label.word === L.word);
    if (!g.sure) {
      unclear++;
      return;
    }
    samples.push(sentenceSample(makeId, L, { id: seqId, i: L.i, w: L.word + ':' + run }, g.strokes));
  });
  return { samples, unclear, stats: { text, ...gaps, created: Date.now() } };
}
