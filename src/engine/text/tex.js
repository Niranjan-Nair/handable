// The TeX subset equations are written in, parsed into atoms (laid out by
// layout/math.js).
// Where an equation (src[a … b)) may go onto a new line: after a relation or an
// operator at the top level (not inside braces, \left … \right or an
// environment, and not a leading sign), and always at \\ or \newline.
// -> [{ a, b, brk }] source ranges; brk: a forced break before this piece.
const BREAK_AFTER = new Set('+-=<>×÷±∓≤≥≠≈→←·∈∉⊂⊃⊆⊇∪∩⇒⇐⇔↔↦≡∼≃≅∝');

export function splitMathSrc(src, a, b) {
  const out = [];
  let start = a;
  let depth = 0;
  let hasAtom = false;
  let brk = false;

  const cut = (at, next, forced) => {
    if (src.slice(start, at).trim()) out.push({ a: start, b: at, brk });
    brk = forced || (brk && !src.slice(start, at).trim());
    start = next;
    hasAtom = false;
  };

  const afterOp = (k) => {
    // an operator with scripts of its own (\to^{*}) or at the very end stays put
    let q = k;
    while (q < b && /\s/.test(src[q])) q++;

    return q < b && src[q] !== '^' && src[q] !== '_';
  };

  for (let k = a; k < b;) {
    const c = src[k];

    if (c === '\\') {
      if (src[k + 1] === '\\' && depth === 0) {
        let next = k + 2;
        const m = /^\s*\[[^\]]*\]/.exec(src.slice(next, b));
        if (m) next += m[0].length;
        cut(k, next, true);
        k = next;
        continue;
      }

      const m = /^\\([a-zA-Z]+)/.exec(src.slice(k, b));

      if (!m) {
        k += 2;
        hasAtom = true;
        continue;
      }

      const name = m[1];
      let e = k + m[0].length;

      if (name === 'newline' && depth === 0) {
        cut(k, e, true);
        k = e;
        continue;
      }

      if (name === 'left' || name === 'begin') depth++;
      else if (name === 'right' || name === 'end') depth = Math.max(0, depth - 1);

      if (name === 'left' || name === 'right') {
        while (e < b && /\s/.test(src[e])) e++;
        e += src[e] === '\\' ? 2 : 1;
      }

      if (name === 'sqrt') {
        let q = e;
        while (q < b && /\s/.test(src[q])) q++;

        if (src[q] === '[') {
          const z = src.indexOf(']', q);
          if (z > 0 && z < b) e = z + 1;
        }
      }

      const sym = MATH_SYMBOLS[name];

      if (depth === 0 && sym && BREAK_AFTER.has(sym) && hasAtom && afterOp(e)) {
        cut(e, e, false);
        k = e;
        continue;
      }

      hasAtom = true;
      k = e;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && BREAK_AFTER.has(c) && hasAtom && afterOp(k + 1)) {
      cut(k + 1, k + 1, false);
      k++;
      continue;
    }

    if (!/\s/.test(c)) hasAtom = true;
    k++;
  }

  cut(b, b, false);

  return out;
}

const MATH_SYMBOLS = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  varkappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'ϕ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Omicron: 'Ο',
  Pi: 'Π',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',
  varGamma: 'Γ',
  varDelta: 'Δ',
  varTheta: 'Θ',
  varLambda: 'Λ',
  varXi: 'Ξ',
  varPi: 'Π',
  varSigma: 'Σ',
  varUpsilon: 'Υ',
  varPhi: 'Φ',
  varPsi: 'Ψ',
  varOmega: 'Ω',
  infty: '∞',
  pm: '±',
  times: '×',
  div: '÷',
  cdot: '·',
  ast: '*',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  gets: '←',
  partial: '∂',
  circ: '°',
  degree: '°',
  in: '∈',
  prime: '′',
  ldots: '…',
  dots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  hdots: '⋯',
  lt: '<',
  gt: '>',
  mid: '|',
  vert: '|',
  lbrace: '{',
  rbrace: '}',
  backslash: '\\',
  // logic & sets
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  emptyset: '∅',
  varnothing: '∅',
  nabla: '∇',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  notin: '∉',
  ni: '∋',
  owns: '∋',
  neg: '¬',
  lnot: '¬',
  land: '∧',
  wedge: '∧',
  lor: '∨',
  vee: '∨',
  oplus: '⊕',
  otimes: '⊗',
  odot: '⊙',
  implies: '⇒',
  Rightarrow: '⇒',
  impliedby: '⇐',
  Leftarrow: '⇐',
  iff: '⇔',
  Leftrightarrow: '⇔',
  leftrightarrow: '↔',
  mapsto: '↦',
  uparrow: '↑',
  downarrow: '↓',
  therefore: '∴',
  because: '∵',
  // relations
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  propto: '∝',
  perp: '⊥',
  parallel: '∥',
  ll: '≪',
  gg: '≫',
  // letter-like & misc
  hbar: 'ℏ',
  ell: 'ℓ',
  aleph: 'ℵ',
  angle: '∠',
  triangle: '△',
  square: '□',
  Box: '□',
  star: '⋆',
  bullet: '•',
  dagger: '†',
  checkmark: '✓',
  S: '§',
  langle: '⟨',
  rangle: '⟩',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  Vert: '‖',
  '|': '‖',
};

// font styles: \mathbb{R}, \mathcal{L}, \mathfrak{g}, \mathbf{v} … (see styleGlyph)
const FONT_CMDS = {
  mathbb: 'bb',
  Bbb: 'bb',
  mathcal: 'cal',
  mathscr: 'cal',
  mathfrak: 'frak',
  mathbf: 'bf',
  boldsymbol: 'bf',
  bm: 'bf',
  pmb: 'bf',
  mathit: 'it',
  mathrm: 'rm',
  mathsf: 'rm',
  mathtt: 'rm',
  mathnormal: 'rm',
};

const TEXT_FONTS = { textbf: 'bf', textit: 'it', emph: 'it', textrm: 'rm', textsf: 'rm', texttt: 'rm' };

// accents: drawn just above the letter (\hat{x}, \vec{v} …)
const ACCENTS = {
  hat: 'ˆ',
  widehat: 'ˆ',
  check: 'ˇ',
  tilde: '˜',
  widetilde: '˜',
  dot: '˙',
  ddot: '¨',
  acute: '´',
  breve: '˘',
  vec: '⃗',
  overrightarrow: '⃗',
};

// letter-like symbols that are a styled Latin letter (\Re = 𝔑-style R, …)
const STYLED_SYMBOLS = { Re: ['R', 'frak'], Im: ['I', 'frak'], wp: ['p', 'cal'] };

// Unicode mathematical alphanumerics (ℝ, 𝔸, 𝓛, 𝔤, 𝐯 …) -> [letter, font]
const LETTERLIKE = {
  ℂ: 'Cbb',
  ℍ: 'Hbb',
  ℕ: 'Nbb',
  ℙ: 'Pbb',
  ℚ: 'Qbb',
  ℝ: 'Rbb',
  ℤ: 'Zbb',
  ℬ: 'Bcal',
  ℰ: 'Ecal',
  ℱ: 'Fcal',
  ℋ: 'Hcal',
  ℐ: 'Ical',
  ℒ: 'Lcal',
  ℳ: 'Mcal',
  ℛ: 'Rcal',
  ℯ: 'ecal',
  ℊ: 'gcal',
  ℴ: 'ocal',
  ℭ: 'Cfrak',
  ℌ: 'Hfrak',
  ℑ: 'Ifrak',
  ℜ: 'Rfrak',
  ℨ: 'Zfrak',
};

const ALPHA_BLOCKS = [
  [0x1d400, 'bf'],
  [0x1d434, 'it'],
  [0x1d468, 'bf'],
  [0x1d49c, 'cal'],
  [0x1d4d0, 'cal'],
  [0x1d504, 'frak'],
  [0x1d538, 'bb'],
  [0x1d56c, 'frak'],
  [0x1d5a0, 'rm'],
  [0x1d5d4, 'bf'],
  [0x1d608, 'it'],
  [0x1d63c, 'bf'],
  [0x1d670, 'rm'],
];

export function styledLetter(c) {
  const l = LETTERLIKE[c];
  if (l) return [l[0], l.slice(1)];

  const cp = c.codePointAt(0);
  if (cp >= 0x1d7d8 && cp <= 0x1d7e1) return [String(cp - 0x1d7d8), 'bb']; // 𝟘 … 𝟡
  if (cp >= 0x1d7ce && cp <= 0x1d7d7) return [String(cp - 0x1d7ce), 'bf'];

  for (const [start, font] of ALPHA_BLOCKS)
    if (cp >= start && cp < start + 52) {
      const k = cp - start;

      return [String.fromCharCode(k < 26 ? 65 + k : 97 + k - 26), font];
    }

  return null;
}

// set a font on every character / text atom of a parsed tree (inner styles win)
function withFont(atom, font) {
  if (!atom || typeof atom !== 'object') return atom;
  if ((atom.t === 'ch' || atom.t === 'text') && atom.font == null && !atom.big && !atom.fn) atom.font = font;
  for (const k of ['list', 'base', 'sup', 'sub', 'num', 'den', 'body', 'index'])
    if (atom[k]) Array.isArray(atom[k]) ? atom[k].forEach((x) => withFont(x, font)) : withFont(atom[k], font);

  return atom;
}

const MATH_SPACES = { ',': 0.15, ':': 0.2, ';': 0.26, ' ': 0.3, '>': 0.2, quad: 0.75, qquad: 1.5, '!': -0.06 };
const MATH_FUNCS =
  'sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp lim max min det gcd mod sup inf limsup liminf argmax argmin Pr'.split(
    ' ',
  );
// functions whose sub/superscripts go underneath/on top in display math (like \lim_{x\to0})
const LIMIT_FUNCS = ['lim', 'max', 'min', 'det', 'gcd', 'sup', 'inf', 'limsup', 'liminf', 'argmax', 'argmin', 'Pr'];

const BIG_OPS = {
  sum: 'Σ',
  prod: 'Π',
  coprod: '∐',
  bigcup: '∪',
  bigcap: '∩',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  oiint: '∯',
  oiiint: '∰',
};

export const INTEGRALS = ['∫', '∬', '∭', '∮', '∯', '∰']; // keep their limits at the side unless \limits is used

const TEXT_CMDS = ['text', 'textrm', 'textit', 'textbf', 'textsf', 'texttt', 'emph', 'mbox', 'operatorname'];
const STYLE_CMDS = ['displaystyle', 'textstyle', 'scriptstyle'];
const IGNORE_CMDS = ['left', 'right', 'big', 'Big', 'bigg', 'Bigg', '\\'];

// amsmath matrix environments and their delimiters (plus cases)
export const MATRIX_ENVS = {
  matrix: [null, null],
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  smallmatrix: [null, null],
  cases: ['{', null],
};

// Split an environment body into rows (\\) and cells (&), ignoring separators
// inside braces or nested environments.
function splitCells(body) {
  const rows = [[]];
  let cell = '';
  let depth = 0;

  for (let k = 0; k < body.length; k++) {
    const c = body[k];

    if (c === '\\') {
      if (body[k + 1] === '\\' && depth === 0) {
        rows[rows.length - 1].push(cell);
        cell = '';
        rows.push([]);
        k++;
        // \\[4pt]: extra row space we don't need
        const m = /^\s*\[[^\]]*\]/.exec(body.slice(k + 1));
        if (m) k += m[0].length;
        continue;
      }

      const env = /^\\(begin|end)\{[a-zA-Z*]+\}/.exec(body.slice(k));

      if (env) {
        depth += env[1] === 'begin' ? 1 : -1;
        cell += env[0];
        k += env[0].length - 1;
        continue;
      }

      cell += c + (body[k + 1] || '');
      k++; // \& and other escapes stay as they are
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') depth--;

    if (c === '&' && depth === 0) {
      rows[rows.length - 1].push(cell);
      cell = '';
      continue;
    }

    cell += c;
  }

  rows[rows.length - 1].push(cell);
  // a trailing \\ leaves an empty last row
  while (rows.length > 1 && rows[rows.length - 1].every((x) => !x.trim())) rows.pop();

  return rows;
}

// Small TeX subset -> atom list. Atoms: ch, group, scripts, frac, sqrt, rule, sp, text.
export function parseMath(src) {
  let i = 0;

  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };

  function readToken() {
    skipWs();
    if (i >= src.length) return null;

    const c = src[i];

    if (c === '\\') {
      i++;

      if (/[a-zA-Z]/.test(src[i] || '')) {
        let n = '';
        while (i < src.length && /[a-zA-Z]/.test(src[i])) n += src[i++];

        return { k: 'cmd', name: n };
      }

      return { k: 'cmd', name: src[i++] || '' };
    }

    i++;
    if (c === '{') return { k: 'open' };
    if (c === '}') return { k: 'close' };
    if (c === '^') return { k: 'sup' };
    if (c === '_') return { k: 'sub' };

    i--;
    const cp = String.fromCodePoint(src.codePointAt(i));
    i += cp.length;

    return { k: 'ch', ch: cp };
  }

  function parseList(untilClose) {
    const list = [];

    for (;;) {
      const tok = readToken();
      if (!tok) break;

      if (tok.k === 'close') {
        if (untilClose) break;

        continue;
      }

      if (tok.k === 'sup' || tok.k === 'sub') {
        let base = list.pop() || { t: 'group', list: [] };
        if (base.t !== 'scripts') base = { t: 'scripts', base, sup: null, sub: null };
        base[tok.k] = parseArg();
        list.push(base);
        continue;
      }

      if (tok.k === 'cmd' && (tok.name === 'limits' || tok.name === 'nolimits')) {
        // \sum\limits_{..}: force limits underneath/on top (or, with \nolimits, at the side)
        const last = list[list.length - 1];
        if (last) (last.t === 'scripts' ? last.base || last : last).limits = tok.name === 'limits';
        continue;
      }

      const atom = atomFrom(tok);
      if (atom) list.push(atom);
    }

    return list;
  }

  function parseArg() {
    const tok = readToken();
    if (!tok) return { t: 'group', list: [] };
    if (tok.k === 'open') return { t: 'group', list: parseList(true) };

    return atomFrom(tok) || { t: 'group', list: [] };
  }

  function optArg() {
    skipWs();
    if (src[i] !== '[') return null;

    const j = src.indexOf(']', i);
    if (j < 0) return null;

    const inner = src.slice(i + 1, j);
    i = j + 1;

    return { t: 'group', list: parseMath(inner) };
  }

  function rawArg() {
    skipWs();

    if (src[i] !== '{') {
      const t = readToken();

      return t && t.k === 'ch' ? t.ch : '';
    }

    let depth = 0;
    let out = '';

    for (i++; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        if (!depth) {
          i++;
          break;
        }

        depth--;
      }

      out += src[i];
    }

    return out;
  }

  function atomFrom(tok) {
    if (tok.k === 'open') return { t: 'group', list: parseList(true) };

    if (tok.k === 'ch') {
      const sl = styledLetter(tok.ch);
      if (sl) return { t: 'ch', ch: sl[0], font: sl[1] };

      return { t: 'ch', ch: tok.ch === '-' ? '−' : tok.ch === "'" ? '′' : tok.ch };
    }

    return tok.k === 'cmd' ? commandAtom(tok.name) : null;
  }

  // \name -> its atom (null for commands that only change how things are set)
  function commandAtom(n) {
    if (n === 'frac' || n === 'dfrac' || n === 'tfrac') return { t: 'frac', num: parseArg(), den: parseArg() };

    if (n === 'sqrt') {
      const index = optArg();

      return { t: 'sqrt', index, body: parseArg() };
    }

    if (n === 'underline' || n === 'overline' || n === 'bar')
      return { t: 'rule', over: n !== 'underline', body: parseArg() };
    // boxes: \boxed{x = 4} (math inside), \fbox{text} / \framebox{text} (text inside)
    if (n === 'boxed') return { t: 'boxed', body: parseArg() };

    if (n === 'fbox' || n === 'framebox') {
      optArg();

      return { t: 'boxed', body: { t: 'text', str: rawArg() } };
    }

    if (n === 'sout' || n === 'st') return { t: 'struck', body: parseArg() };
    if (TEXT_CMDS.includes(n)) return { t: 'text', str: rawArg(), font: TEXT_FONTS[n] };
    if (STYLE_CMDS.includes(n)) return null;
    if (FONT_CMDS[n]) return withFont(parseArg(), FONT_CMDS[n]);
    if (ACCENTS[n])
      return { t: 'scripts', base: parseArg(), sup: { t: 'ch', ch: ACCENTS[n] }, sub: null, stack: true, accent: true };
    if (STYLED_SYMBOLS[n]) return { t: 'ch', ch: STYLED_SYMBOLS[n][0], font: STYLED_SYMBOLS[n][1] };

    if (n === 'not') {
      // \not= , \not\in …: the crossed-out relation
      const nx = parseArg();
      const crossed = { '=': '≠', '∈': '∉', '∃': '∄' };

      return nx && nx.t === 'ch' && crossed[nx.ch] ? { t: 'ch', ch: crossed[nx.ch] } : nx;
    }

    if (IGNORE_CMDS.includes(n)) return null;
    if (n === 'begin') return environment(rawArg().trim());

    if (n === 'end') {
      rawArg();

      return null;
    }

    if (n === 'underset') {
      const below = parseArg();

      return { t: 'scripts', base: parseArg(), sub: below, sup: null, stack: true };
    }

    if (n === 'overset' || n === 'stackrel') {
      const above = parseArg();

      return { t: 'scripts', base: parseArg(), sup: above, sub: null, stack: true };
    }

    if (MATH_FUNCS.includes(n)) return { t: 'text', str: n, fn: true, limOp: LIMIT_FUNCS.includes(n) };
    if (BIG_OPS[n]) return { t: 'ch', ch: BIG_OPS[n], big: true };
    if (n in MATH_SPACES) return { t: 'sp', w: MATH_SPACES[n] };
    if (MATH_SYMBOLS[n]) return { t: 'ch', ch: MATH_SYMBOLS[n] };
    if (n.length === 1) return { t: 'ch', ch: n }; // \{ \} \% \$ \# \& \_

    return { t: 'text', str: '\\' + n }; // unknown command: write it out literally
  }

  // \begin{pmatrix} a & b \\ c & d \end{pmatrix}: up to the matching \end
  function environment(env) {
    const open = '\\begin{' + env + '}';
    const close = '\\end{' + env + '}';
    let depth = 1;
    let k = i;
    let end = -1;

    while (k < src.length) {
      if (src.startsWith(open, k)) {
        depth++;
        k += open.length;
      } else if (src.startsWith(close, k)) {
        if (--depth === 0) {
          end = k;
          break;
        }

        k += close.length;
      } else k++;
    }

    const body = src.slice(i, end < 0 ? src.length : end);
    i = end < 0 ? src.length : end + close.length;
    if (MATRIX_ENVS[env]) return { t: 'matrix', env, rows: splitCells(body).map((r) => r.map((c) => parseMath(c))) };

    return { t: 'group', list: parseMath(body) }; // other environments: just the content
  }

  return parseList(false);
}
