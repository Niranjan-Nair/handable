#!/usr/bin/env node
// Generate handwriting SVG from exported training data.
//
//   node cli.js --data handwriting-data.json "Hello there" > hello.svg
//   echo "Some text" | node cli.js --data handwriting-data.json --out out.svg --seed 7 --paper lined
import fs from 'node:fs';
import * as HW from './src/engine/index.js';

// options that take a number, options that take true / false, and option names
// that differ from the engine's
const NUMERIC = new Set([
  'smoothness',
  'penConsistency',
  'formality',
  'sizeConsistency',
  'randomness',
  'size',
  'maxWidth',
  'margin',
  'lineHeight',
  'penWidth',
  'slant',
  'letterSpacing',
  'wordSpacing',
  'variantThreshold',
]);
const BOOL = new Set(['infer', 'ligatures', 'scan', 'doubleSided']);
const ALIASES = {
  width: 'maxWidth',
  color: 'color',
  'line-height': 'lineHeight',
  'pen-width': 'penWidth',
  'letter-spacing': 'letterSpacing',
  'word-spacing': 'wordSpacing',
  threshold: 'variantThreshold',
  'size-consistency': 'sizeConsistency',
  'pen-consistency': 'penConsistency',
  'page-size': 'pageSize',
  'double-sided': 'doubleSided',
};

function usage() {
  console.error(`usage: node cli.js --data <data.json> [options] [text]
  text comes from the argument, --file <path>, or stdin
  --out <file.svg>       write to file instead of stdout
  --seed <s>             same seed + same text = same output
  --randomness <0..2>    default 1
  --size <px>            px per line height (default 48)
  --width <px>           wrap width (default 800)
  --line-height <units>  default 1.9
  --pen ink|pencil|uniform  --paper none|plain|lined   --color <css color>
  --page-size letter|a4  page size for plain / lined paper (pages are stacked in the SVG;
                         PDF export is in the app)
  --pen-width <units>    --slant <deg>  --letter-spacing <x>  --word-spacing <x>
  --threshold <0.05..0.35>  variant clustering sensitivity
  --size-consistency <0..1> how strongly to even out sample sizes (default 0.8)
  --smoothness <0..1>    smooth out trackpad / mouse wobble (default 0.25)
  --pen-consistency <0..1> 0 = uneven pen & ink, 1 = very even (default 0.6)
  --formality <0..1>     fewer ligatures, clearest letter forms, tidier (default 0)
  --infer true|false     build untrained characters from your other letters (default true)
  --ligatures true|false use the ligatures you actually wrote joined (default true)
  --scan true|false      plain / lined paper looks like a scanned sheet (default true)
  --double-sided true|false  lined paper: even pages are the backs of sheets, margin on the right (default false)`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opts = {};
let dataPath;
let outPath;
let filePath;
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) {
    rest.push(a);
    continue;
  }
  const key = a.slice(2);
  const val = args[++i];
  if (val === undefined) usage();
  if (key === 'data') dataPath = val;
  else if (key === 'out') outPath = val;
  else if (key === 'file') filePath = val;
  else {
    const k = ALIASES[key] || key;
    if (!(k in HW.DEFAULTS)) {
      console.error(`unknown option --${key}`);
      usage();
    }
    opts[k] = NUMERIC.has(k) ? Number(val) : BOOL.has(k) ? !/^(false|0|no|off)$/i.test(val) : val;
  }
}
if (!dataPath) usage();

let text = rest.join(' ');
if (filePath) text = fs.readFileSync(filePath, 'utf8');
else if (!text && !process.stdin.isTTY) text = fs.readFileSync(0, 'utf8');
text = text.replace(/\s+$/, '');
if (!text) usage();

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const model = HW.buildModel(data, { variantThreshold: opts.variantThreshold, sizeConsistency: opts.sizeConsistency });
const res = HW.generate(model, text, opts);
if (res.ligatures.length) console.error(`ligatures: ${res.ligatures.join(' ')}`);
if (res.inferred.length) console.error(`inferred (not trained): ${res.inferred.join(' ')}`);
if (res.missing.length) console.error(`warning: cannot write: ${res.missing.join(' ')}`);
if (outPath) {
  fs.writeFileSync(outPath, res.svg);
  console.error(`wrote ${outPath} (${res.width}×${res.height}, ${res.lines} line${res.lines > 1 ? 's' : ''})`);
} else process.stdout.write(res.svg + '\n');
