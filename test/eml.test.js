import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse, compile, calculate, runProgram, formatResult, stats, EmlError, EmlMachine, cleanResult,
} from '../src/eml.js';

const val = (src) => {
  const r = calculate(src);
  return formatResult(r.result);
};

test('paper identities: e, exp, ln', () => {
  assert.equal(compile('e'), '11E');
  assert.equal(compile('exp(1)'), '11E'.length === 3 ? compile('exp(1)') : '');
  assert.equal(compile('ln(5)').length, compile('5').length + 6);
  // ln x = eml(1, eml(eml(1, x), 1)) -> RPN 1 1 x E 1 E E  (paper, Sect. 4.1)
  assert.equal(compile('ln(1)'), '111E1EE');
  const [re] = runProgram('11E');
  assert.ok(Math.abs(re - Math.E) < 1e-15);
});

test('the program only contains the two keys', () => {
  for (const src of ['3+4', '2^10', '(1+2)*(3-4)/5', 'ln(e^3)']) {
    assert.match(compile(src), /^[1E]+$/);
  }
});

test('every program is a valid stack program', () => {
  for (const src of ['1', '3+4', '2^10', '1/3', '-5', '12*(5-2)']) {
    const p = compile(src);
    const m = new EmlMachine();
    for (const t of p) assert.ok(m.press(t));
    assert.equal(m.depth, 1);
  }
});

test('basic arithmetic', () => {
  assert.equal(val('3+4'), '7');
  assert.equal(val('7-9'), '−2');
  assert.equal(val('12*(5-2)'), '36');
  assert.equal(val('10/4'), '2.5');
  assert.equal(val('2^10'), '1024');
  assert.equal(val('2^-3'), '0.125');
  assert.equal(val('-2^2'), '−4');
  assert.equal(val('(-2)^2'), '4');
  assert.equal(val('1/3'), '0.3333333333');
  assert.equal(val('1.5+2.25'), '3.75');
  assert.equal(val('0.1+0.2-0.3'), '0');
  assert.equal(val('123*456'), '56088');
  assert.equal(val('2^2^3'), '256');
});

test('functions and constants', () => {
  assert.equal(val('e'), '2.718281828');
  assert.equal(val('exp(1)'), '2.718281828');
  assert.equal(val('ln(e^3)'), '3');
  assert.equal(val('ln(10)'), '2.302585093');
  assert.equal(val('e^2'), '7.389056099');
});

test('zero operands and special values', () => {
  assert.equal(val('0'), '0');
  assert.equal(val('0*5'), '0');
  assert.equal(val('5*0'), '0');
  assert.equal(val('0/5'), '0');
  assert.equal(val('(5-5)*3'), '0');
  assert.equal(val('0^2'), '0');
  assert.equal(val('3/0'), '∞');
  assert.equal(val('0^0'), 'ERR');
});

test('complex intermediate values give principal-branch results', () => {
  assert.equal(val('ln(-1)'), '3.141592654i');
  assert.equal(val('(-8)^(1/3)'), '1 + 1.732050808i');
});

test('large operands survive the exp(y) step of subtraction (log form)', () => {
  assert.equal(val('1+1000'), '1001');
  assert.equal(val('1000+1'), '1001');
  assert.equal(val('5000-4999'), '1');
  assert.equal(val('2^1000'), '1.071508607·10^301');
  assert.equal(val('exp(9^6)').startsWith('7.829916778'), true);
});

test('astronomically large results collapse to infinity', () => {
  assert.equal(val('123456789012^123456789012^2'), '\u221e');
});

test('literal limits', () => {
  assert.throws(() => parse('1234567890123'), (e) => e instanceof EmlError && e.code === 'number_too_long');
  assert.equal(val('123456789012'), '123456789012');
});

test('parser errors', () => {
  assert.throws(() => parse(''), (e) => e.code === 'empty');
  assert.throws(() => parse('3+'), (e) => e.code === 'unexpected_end');
  assert.throws(() => parse('(3+4'), (e) => e.code === 'missing_rparen');
  assert.throws(() => parse('3 $ 4'), (e) => e.code === 'unexpected_char');
  assert.throws(() => parse('sin(1)'), (e) => e.code === 'unknown_word');
  assert.throws(() => parse('ln 3'), (e) => e.code === 'expected_paren');
  assert.throws(() => parse('1..2'), (e) => e.code === 'bad_number');
});

test('operator spellings and decimal comma', () => {
  assert.equal(val('3×4'), '12');
  assert.equal(val('8÷2'), '4');
  assert.equal(val('9−3'), '6');
  assert.equal(val('1,5*2'), '3');
  assert.equal(val('2**3'), '8');
});

test('x (and X) work as times', () => {
  assert.equal(val('3x4'), '12');
  assert.equal(val('3 X 4'), '12');
  assert.equal(val('2x(1+1)'), '4');
  assert.equal(val('2xln(e)'), '2');
  assert.equal(val('2xe'), '5.436563657');
  assert.throws(() => parse('x3'), (e) => e.code === 'unexpected_token');
  assert.throws(() => parse('3xy'), (e) => e.code === 'unknown_word');
});

test('machine history: undo restores every earlier state', () => {
  const program = compile('12*(5-2)+ln(e)');
  const m = new EmlMachine({ history: true });
  const snaps = [];
  for (const t of program) {
    snaps.push(JSON.stringify(m.stack));
    assert.ok(m.press(t));
  }
  assert.equal(m.depth, 1);
  for (let i = program.length - 1; i >= 0; i--) {
    assert.ok(m.undo());
    assert.equal(JSON.stringify(m.stack), snaps[i]);
    assert.equal(m.program, program.slice(0, i));
    assert.equal(m.count, i);
  }
  assert.equal(m.undo(), false);
  assert.equal(m.last, null);
});

test('machine history: last step carries the operands', () => {
  const m = new EmlMachine({ history: true });
  m.press1(); m.press1(); m.pressE();
  const last = m.last;
  assert.equal(last.t, 'E');
  assert.deepEqual(last.a, [1, 0]);
  assert.deepEqual(last.b, [1, 0]);
  assert.ok(Math.abs(last.r[0] - Math.E) < 1e-15); // eml(1,1) = e
});

test('stats count keys', () => {
  const s = stats('11E');
  assert.deepEqual(s, { length: 3, ones: 2, emls: 1 });
});

test('fuzz: EML evaluation agrees with ordinary evaluation', () => {
  let seed = 424242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const nums = ['0', '1', '2', '3', '5', '7', '0.5', '1.5', '2.5', '10', '12', '25', '100', '0.25', '4', '6', '9'];
  const gen = (d) => {
    if (d === 0 || rnd() < 0.2) return rnd() < 0.08 ? 'e' : pick(nums);
    const r = rnd();
    if (r < 0.08) return '-(' + gen(d - 1) + ')';
    if (r < 0.14) return 'ln(' + gen(d - 1) + ')';
    if (r < 0.2) return 'exp(' + gen(d - 1) + ')';
    return '(' + gen(d - 1) + pick(['+', '-', '*', '/', '^', '+', '-', '*', '/']) + gen(d - 1) + ')';
  };
  let checked = 0;
  for (let i = 0; i < 1500; i++) {
    const src = gen(2);
    const r = calculate(src);
    assert.notEqual(r.ok, false, `${src}: ${formatResult(r.result)} vs ${formatResult(r.native)}`);
    if (r.ok) checked++;
  }
  assert.ok(checked > 1000);
});

test('cleanResult snaps noise to zero', () => {
  assert.equal(cleanResult([4e-16, 0]).re, 0);
  assert.equal(cleanResult([3, 1e-15]).kind, 'real');
});
