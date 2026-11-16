import {
  EmlError, EmlMachine, SPAN_TAGS, calculate, cleanResult, compile, formatResult,
} from './eml.js';
import { BLOCKS, LINKS, SEG_FORMULA, STRINGS, detectLang, makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  lcd: $('lcd'), task: $('lcdTask'), meta: $('lcdMeta'), prog: $('lcdProg'), empty: $('lcdEmpty'),
  value: $('lcdValue'), ghost: $('lcdGhost'), sr: $('srResult'),
  keyOne: $('keyOne'), keyEml: $('keyEml'),
  form: $('taskForm'), input: $('taskInput'), error: $('taskError'), live: $('taskLive'), note: $('note'),
  stepBtn: $('stepBtn'), stepper: $('stepper'), stepCounter: $('stepCounter'), stack: $('stackList'),
  stepExplain: $('stepExplain'), stepNextHint: $('stepNextHint'),
  stepStart: $('stepStart'), stepBack: $('stepBack'), stepNext: $('stepNext'), stepPlay: $('stepPlay'), stepEnd: $('stepEnd'),
  stepClose: $('stepClose'),
  legend: $('legend'), segBody: $('segBody'), segChips: $('segChips'), segExplain: $('segExplain'), segToggle: $('segToggle'),
  reset: $('resetBtn'), symbols: $('symbolChips'), examples: $('exampleChips'), blocks: $('blocksBody'),
};

const SYMBOLS = ['(', ')', '+', '−', '×', '÷', '^', 'e', 'ln(', 'exp('];
const EXAMPLES = ['3+4', '12×(5−2)', '2^10', '1/3', 'ln(e^3)', '(−8)^(1/3)'];
const TAIL = 600; // characters shown while a long program is being typed
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lang = 'de';
let t = makeT(lang);
let machine = new EmlMachine();
const step = { active: false, program: '', calc: null, timer: null };

/** What the LCD currently shows, kept so a language switch can re-render it. */
const view = {
  mode: 'idle', // idle | running | done | manual | step
  task: '',
  scale: 1,
  item: null, // top-of-stack value shown
  live: false,
  note: null, // {key, vars, warn}
  error: null, // {code, info}
  spans: null, // colour runs of the program on show (null: none)
  segStats: null,
  segId: 0,
};
const colors = { on: true, hl: null };
let anim = null;

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

function storedLang() {
  try { return localStorage.getItem('eml-lang'); } catch { return null; }
}

/** Language requested in the URL (?lang=de|en), if valid. */
function urlLang() {
  const v = (new URLSearchParams(location.search).get('lang') || '').toLowerCase();
  return STRINGS[v] ? v : null;
}

/** Keep the chosen language in the address bar (other parameters such as ?q= are preserved). */
function syncUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('lang', lang);
    history.replaceState(history.state, '', u);
  } catch { /* e.g. sandboxed or file: contexts */ }
}

function applyLang(next, persist = false) {
  lang = STRINGS[next] ? next : 'en';
  t = makeT(lang);
  document.documentElement.lang = lang;
  document.title = t('doc.title');
  document.querySelector('meta[name="description"]').setAttribute('content', t('doc.description'));
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-html]')) n.innerHTML = t(n.dataset.i18nHtml);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  for (const n of document.querySelectorAll('[data-i18n-placeholder]')) n.setAttribute('placeholder', t(n.dataset.i18nPlaceholder));
  for (const b of document.querySelectorAll('.lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('linkPaper').href = LINKS.paper;
  $('linkVideo').href = LINKS.video;
  $('linkRepo').href = LINKS.repo;
  if (persist) {
    try { localStorage.setItem('eml-lang', lang); } catch { /* storage may be unavailable */ }
  }
  syncUrl();
  renderStatic();
  renderLcd();
  if (step.active) renderStep();
  renderNote();
  renderError();
  updateLive();
}

function renderStatic() {
  el.blocks.replaceChildren();
  for (const [label, formula] of BLOCKS) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = label;
    const b = document.createElement('td');
    const c = document.createElement('code');
    c.textContent = formula;
    b.append(c);
    tr.append(a, b);
    el.blocks.append(tr);
  }
}

/* ------------------------------------------------------------------ */
/* LCD rendering                                                       */
/* ------------------------------------------------------------------ */

const decimal = () => (lang === 'de' ? ',' : '.');

function valueText(item, live) {
  if (!item) return '0';
  const res = cleanResult(item, view.scale);
  if (res.kind === 'nan') return live ? '…' : 'ERR';
  return formatResult(res, decimal());
}

function renderValue() {
  const text = valueText(view.item, view.live);
  el.value.textContent = text;
  el.value.classList.toggle('is-live', view.live);
  el.value.classList.remove('len-m', 'len-l', 'len-xl');
  if (text.length > 22) el.value.classList.add('len-xl');
  else if (text.length > 16) el.value.classList.add('len-l');
  else if (text.length > 10) el.value.classList.add('len-m');
}

function renderLcd() {
  const manual = view.mode === 'manual';
  const stepping = view.mode === 'step';
  el.task.textContent = manual ? t('lcd.manual') : (view.task ? view.task + ' =' : '');
  const n = machine.count;
  if (stepping) el.meta.textContent = `${n}/${step.program.length} · ${t('lcd.stack')} ${machine.depth}`;
  else el.meta.textContent = n ? `${n} ${t('lcd.keys')} · ${t('lcd.stack')} ${machine.depth}` : '';
  el.empty.hidden = n > 0 || view.mode === 'running' || stepping;
  renderValue();
  renderLegend();
}

/** Append the part [from, to) of the colour runs to `parent`. */
function paintRuns(parent, spans, from, to) {
  let off = 0;
  for (const [tag, str] of spans) {
    const a = Math.max(from, off);
    const b = Math.min(to, off + str.length);
    if (a < b) {
      const run = document.createElement('span');
      run.className = 'run t-' + tag;
      run.textContent = str.slice(a - off, b - off);
      parent.append(run);
    }
    off += str.length;
    if (off >= to) break;
  }
}

function setSpans(spans) {
  view.spans = spans;
  view.segStats = null;
  if (spans) {
    const by = {};
    let total = 0;
    for (const [tag, str] of spans) { by[tag] = (by[tag] || 0) + str.length; total += str.length; }
    view.segStats = { by, total };
  }
  view.segId++;
}

const useColors = () => colors.on && !!view.spans && (view.mode === 'done' || view.mode === 'step');

function setProgramText(running) {
  const full = machine.program;
  el.prog.classList.toggle('typing', running);
  if (!running && view.mode === 'done' && useColors()) {
    const frag = document.createDocumentFragment();
    paintRuns(frag, view.spans, 0, full.length);
    el.prog.replaceChildren(frag);
    el.prog.dataset.rich = '1';
  } else {
    const text = running && full.length > TAIL ? full.slice(-TAIL) : full;
    if (el.prog.dataset.rich || el.prog.textContent !== text) el.prog.textContent = text;
    delete el.prog.dataset.rich;
  }
  if (running || view.mode === 'manual') el.prog.scrollTop = el.prog.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Colour legend                                                       */
/* ------------------------------------------------------------------ */

let legendKey = '';

function renderLegend() {
  const show = !!view.spans && (view.mode === 'done' || view.mode === 'step');
  if (el.legend.hidden === show) el.legend.hidden = !show;
  if (!show) { legendKey = ''; delete el.prog.dataset.hl; return; }
  const key = `${lang}|${colors.on}|${view.segId}`;
  if (key === legendKey) return;
  legendKey = key;
  el.segToggle.setAttribute('aria-pressed', String(colors.on));
  el.segBody.hidden = !colors.on;
  if (!colors.on) { delete el.prog.dataset.hl; return; }
  el.segChips.replaceChildren();
  for (const tag of SPAN_TAGS) {
    if (!view.segStats.by[tag]) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-chip';
    b.dataset.tag = tag;
    const dot = document.createElement('span');
    dot.className = 'seg-dot t-' + tag;
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = t('seg.name.' + tag);
    b.append(dot, name);
    b.addEventListener('click', () => { colors.hl = colors.hl === tag ? null : tag; applyHighlight(); });
    el.segChips.append(b);
  }
  applyHighlight();
}

function applyHighlight() {
  const st = view.segStats;
  if (colors.hl && !(st && st.by[colors.hl])) colors.hl = null;
  if (colors.hl) el.prog.dataset.hl = colors.hl; else delete el.prog.dataset.hl;
  for (const b of el.segChips.children) b.setAttribute('aria-pressed', String(b.dataset.tag === colors.hl));
  el.segExplain.replaceChildren();
  if (!colors.hl || !st) { el.segExplain.textContent = t('seg.hint'); return; }
  const n = st.by[colors.hl];
  const head = document.createElement('strong');
  head.textContent = t('seg.name.' + colors.hl);
  const f = document.createElement('code');
  f.textContent = colors.hl === 'num' ? t('seg.f.num') : SEG_FORMULA[colors.hl];
  const c = document.createElement('span');
  c.className = 'seg-count';
  c.textContent = t('seg.count', { n, k: st.total, p: Math.round((100 * n) / st.total) });
  el.segExplain.append(head, ' ', f, ' ', c);
}

function toggleColors() {
  colors.on = !colors.on;
  if (view.mode === 'done') setProgramText(false);
  else if (step.active) renderStepProgram();
  renderLegend();
}

function flashKey(token) {
  el.keyOne.classList.toggle('pressed', token === '1');
  el.keyEml.classList.toggle('pressed', token === 'E');
}
function releaseKeys() {
  el.keyOne.classList.remove('pressed');
  el.keyEml.classList.remove('pressed');
}

/* ------------------------------------------------------------------ */
/* Notes and errors                                                    */
/* ------------------------------------------------------------------ */

function setNote(key, vars, warn = false) {
  view.note = key ? { key, vars, warn } : null;
  renderNote();
}
function renderNote() {
  const n = view.note;
  el.note.textContent = n ? t(n.key, n.vars) : '';
  el.note.classList.toggle('warn', !!(n && n.warn));
}

function setError(err) {
  view.error = err;
  renderError();
}
function errorText(e) {
  const info = e.info || {};
  return t('err.' + e.code, {
    n: info.pos !== undefined ? info.pos + 1 : (info.length ?? ''),
    ch: info.ch ?? '',
    word: info.word ?? '',
  });
}
function renderError() {
  const e = view.error;
  if (!e) {
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
    return;
  }
  el.error.textContent = errorText(e);
  el.input.setAttribute('aria-invalid', 'true');
}

/** Quiet check while typing: how long would the program be, or what is still missing. */
function updateLive() {
  const src = el.input.value;
  if (!src.trim()) {
    el.live.textContent = '';
    el.live.className = 'task-live';
    return;
  }
  try {
    el.live.textContent = t('form.live.ok', { n: compile(src).length });
    el.live.className = 'task-live ok';
  } catch (e) {
    el.live.textContent = e instanceof EmlError ? errorText(e) : '';
    el.live.className = 'task-live';
  }
}
let liveTimer = null;
function scheduleLive() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(updateLive, 120);
}

/* ------------------------------------------------------------------ */
/* Running a task: the two keys "type" the compiled program            */
/* ------------------------------------------------------------------ */

function cancelAnim() {
  if (anim) {
    cancelAnimationFrame(anim.raf);
    anim = null;
  }
  el.prog.classList.remove('typing');
  releaseKeys();
}

function announce(text) { el.sr.textContent = text; }

function finishTask(calc) {
  const wasAnim = anim;
  cancelAnim();
  // complete the program if the animation was skipped
  const program = calc.program;
  for (let i = machine.count; i < program.length; i++) machine.press(program[i]);
  view.mode = 'done';
  view.live = false;
  view.item = machine.top();
  setSpans(calc.spans);
  setProgramText(false);
  el.prog.scrollTop = 0;
  renderLcd();

  const text = valueText(view.item, false);
  announce(`${view.task} = ${text}`);

  setResultNote(calc);
  return wasAnim;
}

function setResultNote(calc) {
  const r = calc.result;
  if (r.kind === 'nan') setNote('note.nan');
  else if (r.kind === 'inf') setNote('note.inf');
  else if (calc.ok === false) setNote('note.diff', { v: formatResult(calc.native, decimal()) }, true);
  else if (calc.ok === true) setNote('note.ok', { v: formatResult(calc.native, decimal()) });
  else if (r.kind === 'huge') setNote('note.huge');
  else setNote(null);
}

/** Parse, compile and run; shows the error (and returns null) if the sum is not valid. */
function prepare(src) {
  try {
    return calculate(src);
  } catch (e) {
    if (e instanceof EmlError) setError({ code: e.code, info: e.info });
    else { console.error(e); setError({ code: 'internal' }); }
    return null;
  }
}

function runTask(src) {
  closeStepper();
  cancelAnim();
  setError(null);
  const calc = prepare(src);
  if (!calc) return;

  machine = new EmlMachine();
  colors.hl = null;
  setSpans(null);
  view.mode = 'running';
  view.task = src.trim();
  view.scale = calc.scale;
  view.item = null;
  view.live = true;
  setNote(null);
  renderLcd();
  setProgramText(false);

  const program = calc.program;
  const total = program.length;
  const duration = reduceMotion() ? 0 : Math.min(3600, Math.max(900, total * 45));
  if (duration === 0) { finishTask(calc); return; }

  setNote('lcd.skipHint');
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const target = Math.min(total, Math.floor(p * total));
    let last = null;
    while (machine.count < target) {
      last = program[machine.count];
      machine.press(last);
    }
    if (last) flashKey(last);
    view.item = machine.top();
    setProgramText(true);
    renderLcd();
    if (p >= 1) { setNote(null); finishTask(calc); return; }
    anim.raf = requestAnimationFrame(tick);
  };
  anim = { raf: requestAnimationFrame(tick), calc };
  anim.finish = () => { setNote(null); finishTask(calc); };
}

function skipAnim() {
  if (anim) anim.finish();
}

/* ------------------------------------------------------------------ */
/* Manual operation of the two keys                                    */
/* ------------------------------------------------------------------ */

function manualPress(token) {
  if (anim) { skipAnim(); return; }
  if (step.active) { stepPress(token); return; }
  setError(null);
  if (view.mode !== 'manual') {
    view.mode = 'manual';
    setSpans(null);
    view.scale = 1;
    setNote('note.manual');
  }
  view.live = false;
  const ok = machine.press(token);
  if (!ok) {
    setNote('note.errKey', null, true);
    el.lcd.classList.remove('is-error');
    void el.lcd.offsetWidth; // restart the animation
    el.lcd.classList.add('is-error');
    return;
  }
  view.item = machine.top();
  setProgramText(false);
  el.prog.scrollTop = el.prog.scrollHeight;
  renderLcd();
  announce(valueText(view.item, false));
}

function resetAll() {
  closeStepper();
  cancelAnim();
  machine = new EmlMachine();
  view.mode = 'idle';
  setSpans(null);
  view.task = '';
  view.item = null;
  view.live = false;
  setError(null);
  setNote(null);
  setProgramText(false);
  announce('');
  renderLcd();
}

/* ------------------------------------------------------------------ */
/* Single-step mode: watch the stack, or press the glowing keys        */
/* ------------------------------------------------------------------ */

function enterStep(src) {
  cancelAnim();
  stopAuto();
  setError(null);
  if (!src.trim()) { setError({ code: 'empty' }); return; }
  const calc = prepare(src);
  if (!calc) return;
  machine = new EmlMachine({ history: true });
  step.active = true;
  step.calc = calc;
  step.program = calc.program;
  view.mode = 'step';
  colors.hl = null;
  setSpans(calc.spans);
  view.task = src.trim();
  view.scale = calc.scale;
  view.live = false;
  view.item = null;
  setNote(null);
  el.stepper.hidden = false;
  renderLcd();
  renderStep();
  el.lcd.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
}

function closeStepper() {
  if (!step.active) return;
  stopAuto();
  step.active = false;
  el.stepper.hidden = true;
  el.keyOne.classList.remove('next');
  el.keyEml.classList.remove('next');
  // keep what the LCD shows: a finished program stays a result, a partial one can be continued by hand
  const complete = machine.count === step.program.length;
  view.mode = complete ? 'done' : 'manual';
  if (!complete) { view.scale = 1; setSpans(null); }
  view.item = machine.top();
  setProgramText(false);
  el.prog.scrollTop = complete ? 0 : el.prog.scrollHeight;
  renderLcd();
}

function renderStepProgram() {
  const full = step.program;
  const pos = machine.count;
  const windowed = full.length > 6000;
  const from = windowed ? Math.max(0, pos - 1200) : 0;
  const to = windowed ? Math.min(full.length, pos + 1200) : full.length;
  const colored = useColors();
  const done = document.createElement('span');
  done.className = 'prog-done';
  if (from > 0) done.append('…');
  const cursor = document.createElement('span');
  cursor.className = 'prog-cursor';
  const next = document.createElement('span');
  next.className = 'prog-next';
  const todo = document.createElement('span');
  todo.className = 'prog-todo';
  if (colored) {
    paintRuns(done, view.spans, from, pos);
    if (pos < full.length) paintRuns(next, view.spans, pos, pos + 1);
    paintRuns(todo, view.spans, pos + 1, to);
  } else {
    done.append(full.slice(from, pos));
    next.textContent = pos < full.length ? full[pos] : '';
    todo.append(full.slice(pos + 1, to));
  }
  if (to < full.length) todo.append('…');
  el.prog.classList.remove('typing');
  el.prog.replaceChildren(done, cursor, next, todo);
  el.prog.dataset.rich = '1';
  el.prog.scrollTop = Math.max(0, cursor.offsetTop - el.prog.clientHeight / 2);
}

function renderStack() {
  el.stack.replaceChildren();
  const st = machine.stack;
  if (!st.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('step.stackEmpty');
    el.stack.append(li);
    return;
  }
  for (let i = st.length - 1; i >= 0; i--) {
    const li = document.createElement('li');
    const v = document.createElement('span');
    v.textContent = valueText(st[i], false);
    li.append(v);
    if (i === st.length - 1) {
      li.classList.add('is-top');
      if (machine.last) li.classList.add('is-new');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('step.top');
      li.append(tag);
    }
    el.stack.append(li);
  }
}

function renderStep() {
  const total = step.program.length;
  const pos = machine.count;
  view.item = machine.top();
  view.live = false;
  renderLcd();
  renderStepProgram();
  renderStack();

  el.stepCounter.textContent = t('step.counter', { n: pos, k: total });
  const last = machine.last;
  let text;
  if (pos === 0) text = t('step.start');
  else if (pos === total) text = t('step.end', { v: valueText(view.item, false) });
  else if (last && last.t === '1') text = t('step.did1');
  else if (last) text = t('step.didE', { a: valueText(last.a, false), b: valueText(last.b, false), r: valueText(last.r, false) });
  el.stepExplain.textContent = text;

  const nextTok = pos < total ? step.program[pos] : null;
  el.stepNextHint.textContent = nextTok ? t('step.next', { key: nextTok === '1' ? '1' : 'EML' }) : '';
  el.keyOne.classList.toggle('next', nextTok === '1');
  el.keyEml.classList.toggle('next', nextTok === 'E');

  el.stepStart.disabled = el.stepBack.disabled = pos === 0;
  el.stepNext.disabled = el.stepEnd.disabled = pos === total;
  el.stepPlay.textContent = t(step.timer ? 'step.btn.pause' : 'step.btn.play');
  el.stepPlay.disabled = pos === total && !step.timer;

  if (pos === total) setResultNote(step.calc);
}

function stepForward() {
  if (machine.count >= step.program.length) { stopAuto(); return false; }
  setNote(null);
  machine.press(step.program[machine.count]);
  if (machine.count >= step.program.length) stopAuto();
  renderStep();
  return true;
}
function stepBackward() {
  if (!machine.undo()) return false;
  setNote(null);
  renderStep();
  return true;
}
function stepJump(toEnd) {
  stopAuto();
  setNote(null);
  if (toEnd) while (machine.count < step.program.length) machine.press(step.program[machine.count]);
  else while (machine.undo());
  renderStep();
}

function startAuto() {
  if (step.timer) return;
  if (machine.count >= step.program.length) return;
  step.timer = setInterval(stepForward, 320);
  renderStep();
}
function stopAuto() {
  if (!step.timer) return;
  clearInterval(step.timer);
  step.timer = null;
  if (step.active) renderStep();
}

/** In single-step mode the real keys work too: pressing the glowing key moves on. */
function stepPress(token) {
  const pos = machine.count;
  if (pos >= step.program.length) return;
  stopAuto();
  const next = step.program[pos];
  if (token === next) { stepForward(); return; }
  setNote('step.wrong', { key: next === '1' ? '1' : 'EML' }, true);
  el.lcd.classList.remove('is-error');
  void el.lcd.offsetWidth;
  el.lcd.classList.add('is-error');
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function buildChips() {
  for (const s of SYMBOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s;
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus (and keyboard) in the input
    b.addEventListener('click', () => {
      const i = el.input;
      const a = i.selectionStart ?? i.value.length;
      const z = i.selectionEnd ?? a;
      i.setRangeText(s, a, z, 'end');
      i.focus();
      setError(null);
    });
    el.symbols.append(b);
  }
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = ex;
    b.addEventListener('click', () => {
      el.input.value = ex;
      runTask(ex);
      el.lcd.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    });
    el.examples.append(b);
  }
}

function tapKey(button) {
  button.classList.add('pressed');
  setTimeout(() => button.classList.remove('pressed'), 130);
}

/** Physical keyboard: 1 and E press the two keys, arrows step through a program. */
function onKeydown(e) {
  if (e.key === 'Escape') { skipAnim(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tg = e.target;
  const typing = tg instanceof HTMLElement && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
  if (typing) return;
  if (e.key === '1') { tapKey(el.keyOne); manualPress('1'); }
  else if (e.key === 'e' || e.key === 'E') { tapKey(el.keyEml); manualPress('E'); }
  else if (step.active && e.key === 'ArrowRight') { e.preventDefault(); stopAuto(); stepForward(); }
  else if (step.active && e.key === 'ArrowLeft') { e.preventDefault(); stopAuto(); stepBackward(); }
}

function init() {
  buildChips();

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runTask(el.input.value);
    if (window.matchMedia('(pointer: coarse)').matches) el.input.blur();
    el.lcd.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
  el.input.addEventListener('input', () => {
    if (view.error) setError(null);
    scheduleLive();
  });
  el.reset.addEventListener('click', resetAll);
  el.segToggle.addEventListener('click', toggleColors);
  el.stepBtn.addEventListener('click', () => enterStep(el.input.value.trim() || view.task));
  el.stepClose.addEventListener('click', closeStepper);
  el.stepStart.addEventListener('click', () => stepJump(false));
  el.stepBack.addEventListener('click', () => { stopAuto(); stepBackward(); });
  el.stepNext.addEventListener('click', () => { stopAuto(); stepForward(); });
  el.stepEnd.addEventListener('click', () => stepJump(true));
  el.stepPlay.addEventListener('click', () => (step.timer ? stopAuto() : startAuto()));
  el.keyOne.addEventListener('click', () => manualPress('1'));
  el.keyEml.addEventListener('click', () => manualPress('E'));
  el.lcd.addEventListener('click', skipAnim);
  document.addEventListener('keydown', onKeydown);
  for (const b of document.querySelectorAll('.lang-btn')) {
    b.addEventListener('click', () => applyLang(b.dataset.lang, true));
  }

  // priority: URL (shared link) > saved choice > browser language
  applyLang(urlLang() || storedLang() || detectLang());

  // deep link: ?q=3%2B4
  const q = new URLSearchParams(location.search).get('q');
  if (q) { el.input.value = q; updateLive(); runTask(q); }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
    });
  }
}

init();
