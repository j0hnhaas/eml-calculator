/* Seven-segment digits drawn as inline SVG (no font needed).
 * A host element gets two stacked layers: the unlit "8" ghosts and the lit digits on top. */

const SVG = 'http://www.w3.org/2000/svg';
const W = 23.5; // width of one cell in viewBox units
const H = 34;

const LIT = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', E: 'adefg', r: 'eg',
};

function poly(cx, cy, len, thick, horizontal) {
  const a = len / 2;
  const t = thick / 2;
  const pts = horizontal
    ? [[cx - a, cy], [cx - a + t, cy - t], [cx + a - t, cy - t], [cx + a, cy], [cx + a - t, cy + t], [cx - a + t, cy + t]]
    : [[cx, cy - a], [cx + t, cy - a + t], [cx + t, cy + a - t], [cx, cy + a], [cx - t, cy + a - t], [cx - t, cy - a + t]];
  return pts.map((p) => p.join(',')).join(' ');
}

const SEGMENTS = {
  a: poly(10, 2, 13, 3.6, true),
  g: poly(10, 17, 13, 3.6, true),
  d: poly(10, 32, 13, 3.6, true),
  f: poly(2.6, 9.5, 13, 3.6, false),
  b: poly(17.4, 9.5, 13, 3.6, false),
  e: poly(2.6, 24.5, 13, 3.6, false),
  c: poly(17.4, 24.5, 13, 3.6, false),
};

function cell(parent, x, lit, point) {
  const g = document.createElementNS(SVG, 'g');
  g.setAttribute('transform', `translate(${x},0)`);
  for (const k of lit) {
    const p = document.createElementNS(SVG, 'polygon');
    p.setAttribute('points', SEGMENTS[k]);
    g.append(p);
  }
  if (point !== null) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', '21.2');
    c.setAttribute('cy', '32.2');
    c.setAttribute('r', '1.9');
    if (point === false) c.setAttribute('opacity', '0');
    g.append(c);
  }
  parent.append(g);
}

function layer(cells, className, build) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cells * W + 3} ${H}`);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'currentColor');
  const slant = document.createElementNS(SVG, 'g');
  slant.setAttribute('transform', 'skewX(-6) translate(4,0)');
  build(slant);
  svg.append(slant);
  return svg;
}

/** Split a display string into cells: one per digit, minus or letter; a decimal mark joins the cell before it. */
export function toCells(text) {
  const out = [];
  for (const ch of text.replace('−', '-')) {
    if (ch === '.' || ch === ',') { if (out.length) out[out.length - 1].point = true; } else out.push({ ch, point: false });
  }
  return out;
}

/** Can the text be shown in `cells` seven-segment cells? Returns the cell list or null. */
export function fitSegments(text, cells) {
  if (text === 'ERR') return toCells('Err');
  if (!/^[−-]?\d+([.,]\d+)?$/.test(text)) return null;
  let s = text;
  let list = toCells(s);
  if (list.length > cells) {
    // too many digits: round the fraction so that it fits
    const m = /^([−-]?)(\d+)([.,])(\d+)$/.exec(s);
    if (!m) return null;
    const room = cells - m[1].length - m[2].length;
    if (room < 1) return null;
    const rounded = Number(`${m[2]}.${m[4]}`).toFixed(room);
    if (rounded.replace('.', '').length + m[1].length > cells) return null;
    s = m[1] + rounded.replace('.', m[3]);
    list = toCells(s);
  }
  return list.length <= cells ? list : null;
}

/** Draw `list` right-aligned into `host` with `cells` positions; unlit segments stay as faint ghosts. */
export function drawSegments(host, list, cells) {
  const pad = cells - list.length;
  const ghost = layer(cells, 'seg-ghost', (g) => {
    for (let k = 0; k < cells; k++) cell(g, k * W + 2, 'abcdefg', true);
  });
  const lit = layer(cells, 'seg-lit', (g) => {
    list.forEach((d, i) => cell(g, (pad + i) * W + 2, LIT[d.ch] || '', d.point ? true : null));
  });
  host.replaceChildren(ghost, lit);
}

/** Convenience for the counters: a whole number in a fixed number of cells (capped, never wider). */
export function drawCount(host, n, cells) {
  const max = 10 ** cells - 1;
  drawSegments(host, toCells(String(Math.min(Math.max(0, Math.floor(n)), max))), cells);
}
