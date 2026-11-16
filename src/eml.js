/*
 * EML core: parser, compiler and stack machine.
 *
 * Based on: A. Odrzywolek, "All elementary functions from a single operator",
 * arXiv:2603.21852. The operator eml(x, y) = exp(x) - ln(y) together with the
 * constant 1 generates the scientific-calculator repertoire.
 *
 * A "program" is a reverse-polish string over just two symbols:
 *   '1'  push the constant 1
 *   'E'  pop b, pop a, push eml(a, b) = exp(a) - ln(b)
 * Evaluation uses complex numbers (principal branch) with ln 0 = -inf and
 * exp(-inf) = 0, as described in the paper.
 */

export class EmlError extends Error {
  constructor(code, info = {}) {
    super(code);
    this.name = 'EmlError';
    this.code = code;
    this.info = info;
  }
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

const MAX_DIGITS = 12;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.,]/.test(ch)) {
      let j = i;
      let seenSep = false;
      while (j < src.length && /[0-9.,]/.test(src[j])) {
        if (src[j] === '.' || src[j] === ',') {
          if (seenSep) throw new EmlError('bad_number', { pos: j });
          seenSep = true;
        }
        j++;
      }
      const text = src.slice(i, j).replace(',', '.');
      if (text === '.') throw new EmlError('bad_number', { pos: i });
      if (text.replace('.', '').length > MAX_DIGITS) throw new EmlError('number_too_long', { pos: i });
      out.push({ t: 'num', v: text, pos: i });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const run = src.slice(i, j);
      const lower = run.toLowerCase();
      // split the letter run into known words: exp, ln, e, and x (= times)
      let k = 0;
      while (k < lower.length) {
        const w = ['exp', 'ln', 'e', 'x'].find((cand) => lower.startsWith(cand, k));
        if (!w) throw new EmlError('unknown_word', { pos: i, word: run });
        if (w === 'e') out.push({ t: 'e', pos: i + k });
        else if (w === 'x') out.push({ t: 'op', v: '*', pos: i + k });
        else out.push({ t: 'fn', v: w, pos: i + k });
        k += w.length;
      }
      i = j;
      continue;
    }
    if (ch === '+') { out.push({ t: 'op', v: '+', pos: i }); i++; continue; }
    if (ch === '-' || ch === '−' || ch === '–') { out.push({ t: 'op', v: '-', pos: i }); i++; continue; }
    if (ch === '*' || ch === '×' || ch === '·') {
      if (ch === '*' && src[i + 1] === '*') { out.push({ t: 'op', v: '^', pos: i }); i += 2; continue; }
      out.push({ t: 'op', v: '*', pos: i }); i++; continue;
    }
    if (ch === '/' || ch === '÷' || ch === ':') { out.push({ t: 'op', v: '/', pos: i }); i++; continue; }
    if (ch === '^') { out.push({ t: 'op', v: '^', pos: i }); i++; continue; }
    if (ch === '(') { out.push({ t: 'lp', pos: i }); i++; continue; }
    if (ch === ')') { out.push({ t: 'rp', pos: i }); i++; continue; }
    throw new EmlError('unexpected_char', { pos: i, ch });
  }
  return out;
}

/**
 * Parse an expression to an AST.
 * Nodes: {k:'num', v:'3.14'} {k:'e'} {k:'neg', a} {k:'bin', op, a, b} {k:'fn', f, a}
 */
export function parse(src) {
  const toks = tokenize(src);
  if (toks.length === 0) throw new EmlError('empty');
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function expr() {
    let left = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const right = term();
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }
  function term() {
    let left = unary();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = next().v;
      const right = unary();
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }
  function unary() {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      next();
      const a = unary();
      return t.v === '-' ? { k: 'neg', a } : a;
    }
    return power();
  }
  function power() {
    const base = atom();
    const t = peek();
    if (t && t.t === 'op' && t.v === '^') {
      next();
      const exp = unary(); // right associative, allows 2^-3
      return { k: 'bin', op: '^', a: base, b: exp };
    }
    return base;
  }
  function atom() {
    const t = next();
    if (!t) throw new EmlError('unexpected_end');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'e') return { k: 'e' };
    if (t.t === 'fn') {
      const lp = next();
      if (!lp || lp.t !== 'lp') throw new EmlError('expected_paren', { pos: lp ? lp.pos : t.pos, word: t.v });
      const a = expr();
      const rp = next();
      if (!rp || rp.t !== 'rp') throw new EmlError('missing_rparen', { pos: rp ? rp.pos : lp.pos });
      return { k: 'fn', f: t.v, a };
    }
    if (t.t === 'lp') {
      const a = expr();
      const rp = next();
      if (!rp || rp.t !== 'rp') throw new EmlError('missing_rparen', { pos: rp ? rp.pos : t.pos });
      return a;
    }
    throw new EmlError('unexpected_token', { pos: t.pos });
  }

  const ast = expr();
  if (p < toks.length) throw new EmlError('unexpected_token', { pos: toks[p].pos });
  return ast;
}

/* ------------------------------------------------------------------ */
/* Compiler: AST -> pure 1/E program                                   */
/* ------------------------------------------------------------------ */

// Building blocks as RPN strings. Verified against the paper / numerically:
//   e      = eml(1,1)
//   exp x  = eml(x,1)
//   ln x   = eml(1, eml(eml(1,x), 1))
//   0      = ln 1
//   -inf   = ln 0                      (extended reals)
//   x - y  = eml(ln x, exp y)
//   -y     = eml(ln 0, exp y)          (= 0 - y)
//   x + y  = x - (-y)
//   1/y    = eml(eml(ln 0, y), 1)      (= exp(-ln y))
//   x / y  = eml(eml(ln ln x, y), 1)   (= exp(ln x - ln y))
//   x * y  = x / (1/y)
//   x ^ y  = exp(y * ln x)
const ONE = '1';
const EXP = (a) => a + '1E';
const LN = (a) => '11' + a + 'E1EE';
const EULER = '11E';
const ZERO = LN(ONE);
const MINF = LN(ZERO);
const SUB = (a, b) => LN(a) + EXP(b) + 'E';
const NEG = (b) => MINF + EXP(b) + 'E';
const INV = (b) => MINF + b + 'E1E';

/**
 * Short variants of + and x, found by exhaustive search over EML trees; they have the lengths
 * of the direct-search results in the paper (x+y: 19 keys, x*y: 17; the long forms need 27 and 33).
 * x and y mark where the operand programs go. (x-y and x/y are already as short: 11 and 17 keys.)
 *   x + y = eml(1, exp(eml(ln(eml(1, exp x)), exp y)))
 *   x * y = exp(eml(1, exp(eml(ln(eml(1, x)), y))))
 */
export const SHORT_TPL = {
  add: '1111x1EEE1EEy1EE1EE',
  mul: '1111xEE1EEyE1EE1E',
};
let SHORT = false; // set by withMode() while compiling
const tpl = (t, a, b) => t.replace(/[xy]/g, (c) => (c === 'x' ? a : b));
const ADD = (a, b) => (SHORT ? tpl(SHORT_TPL.add, a, b) : SUB(a, NEG(b)));
const DIV = (a, b) => LN(LN(a)) + b + 'E1E';
const MUL = (a, b) => (SHORT ? tpl(SHORT_TPL.mul, a, b) : DIV(a, INV(b)));
const POW = (a, b) => EXP(MUL(b, LN(a)));

/** Token-length model of the operations above (for choosing short integer encodings). */
let C_MUL = 31;
let C_ADD = 25;
const C_SUB = 9;

export const MAX_PROGRAM_LENGTH = 300000;

/* Integer encodings: pick the cheapest of factor / (n-1)+1 / (n+1)-1.
 * Add/sub adjustments are limited to a few consecutive steps to bound the recursion. */
let costMemo = new Map();
let planMemo = new Map();
const ADJUST = 3;

function factorPairs(n) {
  const pairs = [];
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) pairs.push([d, n / d]);
  }
  return pairs;
}

function bestFactor(n) {
  let best = Infinity;
  let plan = null;
  for (const [d, q] of factorPairs(n)) {
    const c = intCost(d, ADJUST) + intCost(q, ADJUST) + C_MUL;
    if (c < best) { best = c; plan = { op: 'mul', a: d, b: q }; }
  }
  return { cost: best, plan };
}

const EXHAUSTIVE_LIMIT = 2000000;

/** Large numbers: split into high and low decimal halves, n = hi * 10^k + lo. */
function splitPlan(n) {
  const k = Math.floor(String(n).length / 2);
  const base = Math.pow(10, k);
  const hi = Math.floor(n / base);
  const lo = n - hi * base;
  const cost = intCost(hi) + intCost(base) + C_MUL + (lo ? intCost(lo) + C_ADD : 0);
  return { cost, plan: { op: 'split', hi, lo, base } };
}

function intCost(n, k = ADJUST) {
  if (n === 1) return 1;
  const key = n * 4 + k;
  if (costMemo.has(key)) return costMemo.get(key);
  if (n > EXHAUSTIVE_LIMIT) {
    const sp = splitPlan(n);
    costMemo.set(key, sp.cost);
    planMemo.set(key, sp.plan);
    return sp.cost;
  }
  let { cost: best, plan } = bestFactor(n);
  if (k > 0) {
    const cAdd = intCost(n - 1, k - 1) + 1 + C_ADD;
    if (cAdd < best) { best = cAdd; plan = { op: 'add', a: n - 1, k: k - 1 }; }
    const f = bestFactor(n + 1); // (n+1) - 1, only if n+1 is composite
    if (f.plan) {
      const cSub = f.cost + 1 + C_SUB;
      if (cSub < best) { best = cSub; plan = { op: 'sub', inner: f.plan }; }
    }
  }
  costMemo.set(key, best);
  planMemo.set(key, plan);
  return best;
}

let strMemo = new Map();
function planToString(plan) {
  if (plan.op === 'mul') return MUL(intStr(plan.a), intStr(plan.b));
  if (plan.op === 'add') return ADD(intStr(plan.a, plan.k), ONE);
  if (plan.op === 'split') {
    const prod = MUL(intStr(plan.hi), intStr(plan.base));
    return plan.lo ? ADD(prod, intStr(plan.lo)) : prod;
  }
  return SUB(planToString(plan.inner), ONE); // sub
}
function intStr(n, k = ADJUST) {
  if (n === 1) return ONE;
  const key = n * 4 + k;
  if (strMemo.has(key)) return strMemo.get(key);
  intCost(n, k);
  const s = planToString(planMemo.get(key));
  if (strMemo.size > 5000) strMemo.clear();
  strMemo.set(key, s);
  return s;
}

function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

/** Decimal literal -> reduced fraction [p, q] of integers. */
function toFraction(text) {
  const [ip, fp = ''] = text.split('.');
  let q = 1;
  for (let i = 0; i < fp.length; i++) q *= 10;
  let p = Number((ip || '0') + fp);
  const g = gcd(p, q) || 1;
  return [p / g, q / g];
}

const MEMOS = { long: [costMemo, planMemo, strMemo], short: [new Map(), new Map(), new Map()] };

/** Run fn with the long (default, easy to follow) or the short formulas. */
function withMode(short, fn) {
  const before = SHORT;
  SHORT = !!short;
  [C_MUL, C_ADD] = SHORT ? [15, 17] : [31, 25];
  [costMemo, planMemo, strMemo] = MEMOS[SHORT ? 'short' : 'long'];
  try { return fn(); } finally {
    SHORT = before;
    [C_MUL, C_ADD] = SHORT ? [15, 17] : [31, 25];
    [costMemo, planMemo, strMemo] = MEMOS[SHORT ? 'short' : 'long'];
  }
}

const isPlainReal = (v) => Number.isFinite(v[0]) && Math.abs(v[0]) < 1e150 && Math.abs(v[1]) <= 1e-12 * Math.max(1, Math.abs(v[0]));

/**
 * The short formulas were found for positive real operands, and their intermediate steps
 * leave tiny imaginary noise that would flip the branch of ln wherever a value is negative
 * or complex. So they are used only if every value in the whole calculation is a finite,
 * non-negative real number; otherwise the longer, branch-safe formulas are used throughout.
 */
export function canUseShort(input) {
  const ast = typeof input === 'string' ? parse(input) : input;
  const ok = (n) => {
    if (n.k === 'bin') { if (!ok(n.a) || !ok(n.b)) return false; }
    else if (n.k === 'neg' || n.k === 'fn') { if (!ok(n.a)) return false; }
    const v = evalNative(n);
    return isPlainReal(v) && v[0] >= 0 && (n.k !== 'bin' || n.op !== '^' || evalNative(n.a)[0] > 0);
  };
  return ok(ast);
}

function checkLen(s) {
  if (s.length > MAX_PROGRAM_LENGTH) throw new EmlError('too_long', { length: s.length });
  return s;
}

function compileNode(n) {
  switch (n.k) {
    case 'num': {
      const [p, q] = toFraction(n.v);
      if (p === 0) return ZERO;
      // estimate before building to avoid giant strings
      if (intCost(p) > MAX_PROGRAM_LENGTH || intCost(q) > MAX_PROGRAM_LENGTH) {
        throw new EmlError('too_long', { length: Math.max(intCost(p), intCost(q)) });
      }
      if (q === 1) return intStr(p);
      if (p === 1) return INV(intStr(q));
      return DIV(intStr(p), intStr(q));
    }
    case 'e': return EULER;
    case 'neg': return checkLen(NEG(compileNode(n.a)));
    case 'fn': {
      const a = compileNode(n.a);
      return checkLen(n.f === 'ln' ? LN(a) : EXP(a));
    }
    case 'bin': {
      if (n.op === '^' && n.a.k === 'e') return checkLen(EXP(compileNode(n.b)));
      const a = compileNode(n.a);
      const b = compileNode(n.b);
      switch (n.op) {
        case '+': return checkLen(ADD(a, b));
        case '-': return checkLen(SUB(a, b));
        case '*': return checkLen(MUL(a, b));
        case '/': return checkLen(DIV(a, b));
        case '^': return checkLen(POW(a, b));
      }
    }
  }
  throw new EmlError('internal');
}

/** Compile an AST (or source string) to a pure 1/E program. */
export function compile(input, { short = false } = {}) {
  const ast = typeof input === 'string' ? parse(input) : input;
  return withMode(short && canUseShort(ast), () => compileNode(ast));
}

/* ------------------------------------------------------------------ */
/* Tagged compilation: the same program, split into runs by operation  */
/* ------------------------------------------------------------------ */

/** Programs up to this length also get their colour runs (see compileSpans). */
export const SPAN_LIMIT = 20000;

/** Tags of the runs: the operation a piece of the program belongs to. */
export const SPAN_TAGS = ['num', 'add', 'sub', 'mul', 'div', 'pow', 'exp', 'ln'];

const T = (tag, str) => [[tag, str]];
const cat = (...parts) => parts.flat();
const sEXP = (a, g) => cat(a, T(g, '1E'));
const sLN = (a, g) => cat(T(g, '11'), a, T(g, 'E1EE'));
const sSUB = (a, b, g) => cat(sLN(a, g), sEXP(b, g), T(g, 'E'));
const sNEG = (b, g) => cat(T(g, MINF), sEXP(b, g), T(g, 'E'));
const sTpl = (t, a, b, g) => cat(...t.split(/([xy])/).map((piece) => {
  if (piece === 'x') return a;
  if (piece === 'y') return b;
  return piece ? T(g, piece) : [];
}));
const sADD = (a, b, g) => (SHORT ? sTpl(SHORT_TPL.add, a, b, g) : sSUB(a, sNEG(b, g), g));
const sINV = (b, g) => cat(T(g, MINF), b, T(g, 'E1E'));
const sDIV = (a, b, g) => cat(sLN(sLN(a, g), g), b, T(g, 'E1E'));
const sMUL = (a, b, g) => (SHORT ? sTpl(SHORT_TPL.mul, a, b, g) : sDIV(a, sINV(b, g), g));

function spanNode(n) {
  switch (n.k) {
    case 'num': {
      const [p, q] = toFraction(n.v);
      if (p === 0) return T('num', ZERO);
      if (q === 1) return T('num', intStr(p));
      if (p === 1) return T('num', INV(intStr(q)));
      return T('num', DIV(intStr(p), intStr(q)));
    }
    case 'e': return T('num', EULER);
    case 'neg': return sNEG(spanNode(n.a), 'sub');
    case 'fn': return n.f === 'ln' ? sLN(spanNode(n.a), 'ln') : sEXP(spanNode(n.a), 'exp');
    case 'bin': {
      if (n.op === '^' && n.a.k === 'e') return sEXP(spanNode(n.b), 'exp');
      const a = spanNode(n.a);
      const b = spanNode(n.b);
      switch (n.op) {
        case '+': return sADD(a, b, 'add');
        case '-': return sSUB(a, b, 'sub');
        case '*': return sMUL(a, b, 'mul');
        case '/': return sDIV(a, b, 'div');
        case '^': return sEXP(sMUL(b, sLN(a, 'pow'), 'pow'), 'pow');
      }
    }
  }
  throw new EmlError('internal');
}

/**
 * The program of compile(), as runs [tag, text]: which operation each piece belongs to.
 * An operation owns the keys it adds around its operands; the operands keep their own tag.
 * Joining all texts gives exactly compile(input). Only meant for programs up to SPAN_LIMIT.
 */
export function compileSpans(input, { short = false } = {}) {
  const ast = typeof input === 'string' ? parse(input) : input;
  const out = [];
  for (const [tag, str] of withMode(short && canUseShort(ast), () => spanNode(ast))) {
    const last = out[out.length - 1];
    if (last && last[0] === tag) last[1] += str;
    else out.push([tag, str]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Complex arithmetic and stack machine                                */
/* ------------------------------------------------------------------ */

const TINY = 1e-12;
const LOGFORM_LIMIT = 700;

/*
 * Values are complex numbers [re, im]. Values whose magnitude would over- or underflow a double
 * (|exp(w)| > e^700 or < e^-700) are kept in log form [w.re, w.im, true], meaning exp(w).
 * This is needed because x - y = eml(ln x, exp y) forms exp(y) before taking ln of it again.
 */
const isLog = (v) => v.length > 2;
const wrapPhase = (t) => Math.atan2(Math.sin(t), Math.cos(t));

export function cexp(re, im) {
  if (Number.isNaN(re) || Number.isNaN(im)) return [NaN, NaN];
  // exp(-inf + i*t) = 0 with signed zeros, which keeps the phase for a later ln (as in IEEE754)
  if (re === -Infinity) return [0 * Math.cos(im), 0 * Math.sin(im)];
  if (re === Infinity) {
    // direction of an infinite value: sign of cos/sin, ignoring rounding noise at multiples of pi/2
    const c = Math.cos(im);
    const s = Math.sin(im);
    return [Math.abs(c) < TINY ? 0 : (c > 0 ? Infinity : -Infinity),
            Math.abs(s) < TINY ? 0 : (s > 0 ? Infinity : -Infinity)];
  }
  if (re > LOGFORM_LIMIT || re < -LOGFORM_LIMIT) return [re, im, true];
  const r = Math.exp(re);
  if (im === 0) return [r, 0];
  return [r * Math.cos(im), r * Math.sin(im)];
}

export function cln(re, im) {
  if (Number.isNaN(re) || Number.isNaN(im)) return [NaN, NaN];
  const m = Math.hypot(re, im); // ln 0 = -inf; the signed zeros decide the phase
  return [Math.log(m), Math.atan2(im, re)];
}

function expOf(a) {
  if (!isLog(a)) return cexp(a[0], a[1]);
  // a = exp(w) is astronomically large or tiny
  if (a[0] > 0) {
    const c = Math.cos(a[1]);
    return c > TINY ? [Infinity, 0] : (c < -TINY ? [0, 0] : [NaN, NaN]);
  }
  return [1, 0];
}

function lnOf(b) {
  if (!isLog(b)) return cln(b[0], b[1]);
  return [b[0], wrapPhase(b[1])];
}

/** eml(a, b) = exp(a) - ln(b) for complex a, b (arrays [re, im] or log form [re, im, true]). */
export function eml(a, b) {
  const x = expOf(a);
  const y = lnOf(b);
  if (isLog(x)) {
    if (y[0] === 0 && y[1] === 0) return x;
    if (y[0] === -Infinity) return [Infinity, 0];
    if (y[0] === Infinity) return [-Infinity, 0];
    return x[0] > 0 ? x : [-y[0], -y[1]];
  }
  return [x[0] - y[0], x[1] - y[1]];
}

/** A stack machine with exactly two instructions: press1() and pressE(). */
export class EmlMachine {
  /** @param {{history?: boolean}} [options] history: remember every step so it can be undone and explained */
  constructor(options = {}) {
    this.keepHistory = !!options.history;
    this.reset();
  }
  reset() {
    this.stack = [];
    this.program = '';
    this.count = 0;
    this.history = this.keepHistory ? [] : null;
  }
  /** The most recent step {t:'1'} or {t:'E', a, b, r}, or null (needs history). */
  get last() {
    const h = this.history;
    return h && h.length ? h[h.length - 1] : null;
  }
  /** Take back the last key press (needs history). Returns false if there is nothing to undo. */
  undo() {
    const h = this.history;
    if (!h || !h.length) return false;
    const e = h.pop();
    this.stack.pop();
    if (e.t === 'E') this.stack.push(e.a, e.b);
    this.program = this.program.slice(0, -1);
    this.count--;
    return true;
  }
  get depth() { return this.stack.length; }
  /** Current top-of-stack value or null. */
  top() {
    const n = this.stack.length;
    return n ? this.stack[n - 1] : null;
  }
  press1() {
    this.stack.push([1, 0]);
    if (this.history) this.history.push({ t: '1' });
    this.program += '1';
    this.count++;
    return true;
  }
  /** Returns false (and does nothing) if fewer than two values are on the stack. */
  pressE() {
    const st = this.stack;
    if (st.length < 2) return false;
    const b = st.pop();
    const a = st.pop();
    const r = eml(a, b);
    st.push(r);
    if (this.history) this.history.push({ t: 'E', a, b, r });
    this.program += 'E';
    this.count++;
    return true;
  }
  press(token) { return token === '1' ? this.press1() : this.pressE(); }
}

/** Run a whole program; returns the value or null if it does not leave exactly one value. */
export function runProgram(program) {
  const m = new EmlMachine();
  for (let i = 0; i < program.length; i++) {
    if (!m.press(program[i])) return null;
  }
  return m.depth === 1 ? m.top() : null;
}

/** Program statistics. */
export function stats(program) {
  let ones = 0;
  for (let i = 0; i < program.length; i++) if (program[i] === '1') ones++;
  return { length: program.length, ones, emls: program.length - ones };
}

/* ------------------------------------------------------------------ */
/* Reference evaluation (for the cross-check) and formatting           */
/* ------------------------------------------------------------------ */

function plainExp(re, im) {
  const r = Math.exp(re);
  return im === 0 ? [r, 0] : [r * Math.cos(im), r * Math.sin(im)];
}
function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
function cdiv(a, b) {
  if (b[0] === 0 && b[1] === 0) return (a[0] === 0 && a[1] === 0) ? [NaN, NaN] : [Infinity, 0];
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

/** Evaluate an AST directly with ordinary complex floating point (principal branch). */
export function evalNative(n) {
  switch (n.k) {
    case 'num': return [Number(n.v), 0];
    case 'e': return [Math.E, 0];
    case 'neg': { const a = evalNative(n.a); return [-a[0], a[1] === 0 ? 0 : -a[1]]; }
    case 'fn': {
      const a = evalNative(n.a);
      return n.f === 'exp' ? plainExp(a[0], a[1]) : cln(a[0], a[1]);
    }
    case 'bin': {
      const a = evalNative(n.a), b = evalNative(n.b);
      switch (n.op) {
        case '+': return [a[0] + b[0], a[1] + b[1]];
        case '-': return [a[0] - b[0], a[1] - b[1]];
        case '*': return cmul(a, b);
        case '/': return cdiv(a, b);
        case '^': {
          if (a[1] === 0 && b[1] === 0 && (a[0] > 0 || (a[0] < 0 && Number.isInteger(b[0])))) return [Math.pow(a[0], b[0]), 0];
          if (a[0] === 0 && a[1] === 0) return b[0] > 0 ? [0, 0] : (b[0] === 0 ? [NaN, NaN] : [Infinity, 0]);
          const l = cln(a[0], a[1]);
          const w = cmul(b, l);
          return plainExp(w[0], w[1]);
        }
      }
    }
  }
  return [NaN, NaN];
}

/** Largest absolute literal in the expression (used as scale for snapping rounding noise to 0). */
export function literalScale(n) {
  switch (n.k) {
    case 'num': return Math.abs(Number(n.v));
    case 'e': return Math.E;
    case 'neg': case 'fn': return literalScale(n.a);
    case 'bin': return Math.max(literalScale(n.a), literalScale(n.b));
  }
  return 1;
}

/**
 * Clean a raw machine value: drop negligible imaginary part and rounding noise around 0.
 * kind: 'real' | 'complex' | 'huge' (outside double range, real only) | 'inf' | 'nan'
 */
export function cleanResult(c, scale = 1) {
  if (!c) return { re: NaN, im: NaN, kind: 'nan' };
  if (isLog(c)) {
    const phase = wrapPhase(c[1]);
    const tol = Math.max(1e-6, 1e-14 * Math.abs(c[0])); // phase error grows with |w|
    if (Math.abs(phase) < tol) return { w: c[0], neg: false, kind: 'huge' };
    if (Math.PI - Math.abs(phase) < tol) return { w: c[0], neg: true, kind: 'huge' };
    return { re: NaN, im: NaN, kind: 'nan' };
  }
  let [re, im] = c;
  if (Number.isNaN(re) || Number.isNaN(im)) return { re, im, kind: 'nan' };
  if (!Number.isFinite(re) || !Number.isFinite(im)) return { re, im, kind: 'inf' };
  const s = Math.max(1, scale, Math.abs(re), Math.abs(im));
  const eps = 1e-11 * Math.max(1, scale);
  if (Math.abs(im) <= 1e-9 * s) im = 0;
  if (Math.abs(re) <= eps) re = 0;
  if (Math.abs(im) <= eps) im = 0;
  return { re, im, kind: im === 0 ? 'real' : 'complex' };
}

function fmtMantissaExp(m, e, decimal, digits = 10) {
  let ms = m.toPrecision(digits);
  if (Number(ms) >= 10) { ms = (Number(ms) / 10).toPrecision(digits); e += 1; }
  ms = String(Number(ms));
  if (decimal === ',') ms = ms.replace('.', ',');
  return ms + '·10^' + String(e).replace('-', '−');
}

function fmtReal(x, decimal) {
  if (x === 0) return '0';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  const a = Math.abs(x);
  let s;
  // integers up to 12 digits are shown in full
  if (a >= 1e10 && a < 1e12 && Math.abs(x - Math.round(x)) <= 1e-12 * a) {
    s = String(Math.round(x)).replace('-', '\u2212');
    return s;
  }
  if (a >= 1e10 || a < 1e-6) {
    const e = Math.floor(Math.log10(a));
    s = fmtMantissaExp(a / Math.pow(10, e), e, decimal);
    return (x < 0 ? '−' : '') + s;
  }
  s = String(Number(x.toPrecision(10))).replace('-', '−');
  return decimal === ',' ? s.replace('.', ',') : s;
}

/** Format a cleaned result. */
export function formatResult(res, decimal = '.') {
  if (res.kind === 'nan') return 'ERR';
  if (res.kind === 'inf') return res.re > 0 || (res.re === 0 && res.im > 0) ? '∞' : '−∞';
  if (res.kind === 'huge') {
    const l10 = res.w / Math.LN10;
    // an exponent beyond ~10^12 is beyond any meaningful digits
    if (Math.abs(l10) > 1e12) return l10 > 0 ? (res.neg ? '\u2212\u221e' : '\u221e') : '0';
    const e = Math.floor(l10);
    return (res.neg ? '−' : '') + fmtMantissaExp(Math.pow(10, l10 - e), e, decimal);
  }
  if (res.kind === 'real') return fmtReal(res.re, decimal);
  const re = fmtReal(res.re, decimal);
  const imAbs = fmtReal(Math.abs(res.im), decimal);
  const sign = res.im < 0 ? ' − ' : ' + ';
  const imStr = imAbs === '1' ? 'i' : imAbs + 'i';
  return res.re === 0 ? (res.im < 0 ? '−' : '') + imStr : re + sign + imStr;
}

/** Relative deviation between two finite complex numbers. */
export function deviation(a, b) {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  return d / Math.max(1, Math.hypot(b[0], b[1]));
}

/**
 * Compare the EML result with a conventional evaluation.
 * Returns true (agree), false (disagree) or null (not comparable, e.g. infinities or outside double range).
 */
export function crossCheck(result, native) {
  if (native.kind === 'real' || native.kind === 'complex') {
    if (result.kind === 'real' || result.kind === 'complex') {
      return deviation([result.re, result.im], [native.re, native.im]) < 1e-6;
    }
    if (result.kind === 'huge') {
      if (native.re === 0) return null; // native evaluation underflowed
      const lr = Math.abs(native.re) > 0 ? Math.log(Math.abs(native.re)) : -Infinity;
      return Number.isFinite(lr) && Math.abs(lr - result.w) < 1e-6 * Math.max(1, Math.abs(lr)) && (native.re < 0) === result.neg;
    }
    return false;
  }
  return null;
}

/**
 * One-stop helper: parse, compile, run and cross-check.
 * Throws EmlError on parse/size problems.
 */
export function calculate(src, { short = false } = {}) {
  const ast = parse(src);
  const shortUsed = short && canUseShort(ast);
  const program = compile(ast, { short: shortUsed });
  const spans = program.length <= SPAN_LIMIT ? compileSpans(ast, { short: shortUsed }) : null;
  const raw = runProgram(program);
  const scale = literalScale(ast);
  const result = cleanResult(raw, scale);
  const native = cleanResult(evalNative(ast), scale);
  return { ast, program, spans, shortUsed, raw, result, native, ok: crossCheck(result, native), stats: stats(program), scale };
}
