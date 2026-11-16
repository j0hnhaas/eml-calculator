import {
  EmlError, EmlMachine, calculate, cleanResult, formatResult,
} from './eml.js';
import { BLOCKS, LINKS, STRINGS, detectLang, makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  lcd: $('lcd'), task: $('lcdTask'), meta: $('lcdMeta'), prog: $('lcdProg'), empty: $('lcdEmpty'),
  value: $('lcdValue'), ghost: $('lcdGhost'), sr: $('srResult'),
  keyOne: $('keyOne'), keyEml: $('keyEml'),
  form: $('taskForm'), input: $('taskInput'), error: $('taskError'), note: $('note'),
  reset: $('resetBtn'), symbols: $('symbolChips'), examples: $('exampleChips'), blocks: $('blocksBody'),
};

const SYMBOLS = ['(', ')', '+', '−', '×', '÷', '^', 'e', 'ln(', 'exp('];
const EXAMPLES = ['3+4', '12×(5−2)', '2^10', '1/3', 'ln(e^3)', '(−8)^(1/3)'];
const TAIL = 600; // characters shown while a long program is being typed
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lang = 'de';
let t = makeT(lang);
const machine = new EmlMachine();

/** What the LCD currently shows, kept so a language switch can re-render it. */
const view = {
  mode: 'idle', // idle | running | done | manual
  task: '',
  scale: 1,
  item: null, // top-of-stack value shown
  live: false,
  note: null, // {key, vars, warn}
  error: null, // {code, info}
};
let anim = null;

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

function storedLang() {
  try { return localStorage.getItem('eml-lang'); } catch { return null; }
}

function applyLang(next) {
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
  try { localStorage.setItem('eml-lang', lang); } catch { /* storage may be unavailable */ }
  renderStatic();
  renderLcd();
  renderNote();
  renderError();
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
  el.task.textContent = manual ? t('lcd.manual') : (view.task ? view.task + ' =' : '');
  const n = machine.count;
  el.meta.textContent = n ? `${n} ${t('lcd.keys')} · ${t('lcd.stack')} ${machine.depth}` : '';
  el.empty.hidden = n > 0 || view.mode === 'running';
  renderValue();
}

function setProgramText(running) {
  const full = machine.program;
  const text = running && full.length > TAIL ? full.slice(-TAIL) : full;
  if (el.prog.textContent !== text) el.prog.textContent = text;
  el.prog.classList.toggle('typing', running);
  if (running || view.mode === 'manual') el.prog.scrollTop = el.prog.scrollHeight;
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
function renderError() {
  const e = view.error;
  if (!e) {
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
    return;
  }
  const info = e.info || {};
  el.error.textContent = t('err.' + e.code, {
    n: info.pos !== undefined ? info.pos + 1 : (info.length ?? ''),
    ch: info.ch ?? '',
    word: info.word ?? '',
  });
  el.input.setAttribute('aria-invalid', 'true');
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
  setProgramText(false);
  el.prog.scrollTop = 0;
  renderLcd();

  const text = valueText(view.item, false);
  announce(`${view.task} = ${text}`);

  const r = calc.result;
  if (r.kind === 'nan') setNote('note.nan');
  else if (r.kind === 'inf') setNote('note.inf');
  else if (calc.ok === false) setNote('note.diff', { v: formatResult(calc.native, decimal()) }, true);
  else if (calc.ok === true) setNote('note.ok', { v: formatResult(calc.native, decimal()) });
  else if (r.kind === 'huge') setNote('note.huge');
  else setNote(null);
  return wasAnim;
}

function runTask(src) {
  cancelAnim();
  setError(null);
  let calc;
  try {
    calc = calculate(src);
  } catch (e) {
    if (e instanceof EmlError) setError({ code: e.code, info: e.info });
    else { console.error(e); setError({ code: 'internal' }); }
    return;
  }

  machine.reset();
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
  setError(null);
  if (view.mode !== 'manual') {
    view.mode = 'manual';
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
  cancelAnim();
  machine.reset();
  view.mode = 'idle';
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

function init() {
  buildChips();

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runTask(el.input.value);
    if (window.matchMedia('(pointer: coarse)').matches) el.input.blur();
    el.lcd.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
  el.input.addEventListener('input', () => { if (view.error) setError(null); });
  el.reset.addEventListener('click', resetAll);
  el.keyOne.addEventListener('click', () => manualPress('1'));
  el.keyEml.addEventListener('click', () => manualPress('E'));
  el.lcd.addEventListener('click', skipAnim);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') skipAnim(); });
  for (const b of document.querySelectorAll('.lang-btn')) {
    b.addEventListener('click', () => applyLang(b.dataset.lang));
  }

  applyLang(storedLang() || detectLang());

  // deep link: ?q=3%2B4
  const q = new URLSearchParams(location.search).get('q');
  if (q) { el.input.value = q; runTask(q); }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
    });
  }
}

init();
