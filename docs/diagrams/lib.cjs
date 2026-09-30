'use strict';

// Мини-DSL для архитектурных диаграмм проекта: коробки, «цилиндры» хранилищ,
// пунктирные границы и подписанные ортогональные стрелки. На выходе —
// самодостаточный SVG без скриптов и внешних ресурсов, который build.cjs
// дополнительно растрирует в PNG через Chromium (Playwright).
//
// Координаты задаются руками в единицах viewBox: диаграмма читается как
// чертёж, и явная сетка надёжнее любого автолейаута.

const FONT = "'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif";

const KINDS = {
  media: { fill: '#FFF4E5', stroke: '#D97706' }, // медиа-тракт: кодер, MediaMTX, FFmpeg
  app: { fill: '#EAF2FF', stroke: '#2563EB' }, // приложение: API, Web
  store: { fill: '#F3F4F6', stroke: '#6B7280' }, // хранилища и тома
  edge: { fill: '#ECFDF5', stroke: '#059669' }, // граница сети и клиенты
  ops: { fill: '#F5F3FF', stroke: '#7C3AED' }, // разработка, CI, выкатка
  ext: { fill: '#FFFFFF', stroke: '#9CA3AF', dash: true }, // внешние сервисы
  new: { fill: '#FEF2F2', stroke: '#DC2626' }, // целевая схема: новое
  changed: { fill: '#FEFCE8', stroke: '#CA8A04' }, // целевая схема: меняется
};

const TEXT = '#374151';
const TITLE = '#111827';
const LINE = '#4B5563';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textBlock({ x, y, lines, size = 12.5, weight = 400, fill = TEXT, anchor = 'start', lh, halo = false, italic = false }) {
  const lineHeight = lh || Math.round(size * 1.36);
  const tspans = lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${esc(l === '' ? ' ' : l)}</tspan>`)
    .join('');
  const haloAttrs = halo ? ' paint-order="stroke" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"' : '';
  const style = italic ? ' font-style="italic"' : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${haloAttrs}${style}>${tspans}</text>`;
}

function shapeAttrs(kind) {
  const k = KINDS[kind] || KINDS.store;
  return `fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"${k.dash ? ' stroke-dasharray="7 5"' : ''}`;
}

// Коробка с заголовком, строками и необязательными секциями. У секции можно
// задать абсолютный y разделителя, чтобы выровнять её со стрелками снаружи.
function box({ x, y, w, h, kind = 'app', title, lines = [], sections = [], size = 12.5, titleSize = 14 }) {
  const pad = 12;
  const lh = Math.round(size * 1.36);
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${shapeAttrs(kind)}/>`;
  let cursor = y + 21;
  if (title) {
    out += textBlock({ x: x + pad, y: cursor, lines: [title], size: titleSize, weight: 700, fill: TITLE });
    cursor += 20;
  }
  if (lines.length) {
    out += textBlock({ x: x + pad, y: cursor, lines, size });
    cursor += lines.length * lh;
  }
  const stroke = (KINDS[kind] || KINDS.store).stroke;
  for (const s of sections) {
    const sepY = s.y != null ? s.y : cursor + 8;
    out += `<line x1="${x}" y1="${sepY}" x2="${x + w}" y2="${sepY}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 3"/>`;
    let sy = sepY + 18;
    if (s.title) {
      out += textBlock({ x: x + pad, y: sy, lines: [s.title], size, weight: 700, fill: TITLE });
      sy += lh;
    }
    if (s.lines && s.lines.length) {
      out += textBlock({ x: x + pad, y: sy, lines: s.lines, size });
      sy += s.lines.length * lh;
    }
    cursor = sy;
  }
  return out;
}

// Хранилище: цилиндр с заголовком.
function store({ x, y, w, h, kind = 'store', title, lines = [], size = 12.5 }) {
  const ry = 7;
  const rx = w / 2;
  const k = KINDS[kind] || KINDS.store;
  const body = `M${x},${y + ry} a${rx},${ry} 0 0 1 ${w},0 v${h - 2 * ry} a${rx},${ry} 0 0 1 ${-w},0 z`;
  let out = `<path d="${body}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"/>`;
  out += `<ellipse cx="${x + rx}" cy="${y + ry}" rx="${rx}" ry="${ry}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"/>`;
  let cursor = y + ry + 22;
  if (title) {
    out += textBlock({ x: x + 12, y: cursor, lines: [title], size: 13, weight: 700, fill: TITLE });
    cursor += 18;
  }
  if (lines.length) out += textBlock({ x: x + 12, y: cursor, lines, size });
  return out;
}

// Пунктирная граница (хост, кластер, пул узлов) с подписью в левом верхнем углу.
function group({ x, y, w, h, label, fill = '#FAFAFA', stroke = '#9CA3AF', labelFill = LINE, size = 13 }) {
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="10 6"/>`;
  if (label) out += textBlock({ x: x + 16, y: y + 24, lines: Array.isArray(label) ? label : [label], size, weight: 700, fill: labelFill });
  return out;
}

// Ортогональная стрелка по точкам. label — строка или массив строк; labelAt —
// координаты первой базовой линии подписи; подпись получает белую обводку,
// чтобы читаться поверх линий.
function arrow({ points, label, labelAt, anchor = 'middle', dashed = false, both = false, color = LINE, width = 1.6, labelSize = 11 }) {
  const pts = points.map((p) => p.join(',')).join(' ');
  let out = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ''} marker-end="url(#arrowhead)"${both ? ' marker-start="url(#arrowhead)"' : ''}/>`;
  if (label && labelAt) {
    out += textBlock({ x: labelAt[0], y: labelAt[1], lines: Array.isArray(label) ? label : [label], size: labelSize, anchor, halo: true, fill: TEXT, lh: Math.round(labelSize * 1.3) });
  }
  return out;
}


// Горизонтальная «шина» (событий, сети): толстая линия с подписями над ней.
function bus({ x1, x2, y, labels = [], color = LINE }) {
  let out = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  for (const l of labels) {
    out += textBlock({ x: l.x, y: y - 8, lines: [l.text], size: 11, anchor: l.anchor || 'middle', halo: true, fill: TEXT });
  }
  return out;
}

function note({ x, y, lines, size = 11.5, fill = '#6B7280', anchor = 'start', italic = true }) {
  return textBlock({ x, y, lines: Array.isArray(lines) ? lines : [lines], size, fill, anchor, italic });
}

// Легенда: линии (solid/dashed), пунктирная рамка (dashbox) и цветные коробки (kind).
function legend({ x, y, items, size = 11.5 }) {
  let out = '';
  let cx = x;
  for (const it of items) {
    if (it.type === 'solid' || it.type === 'dashed') {
      out += `<polyline points="${cx},${y - 4} ${cx + 34},${y - 4}" fill="none" stroke="${LINE}" stroke-width="1.6"${it.type === 'dashed' ? ' stroke-dasharray="7 5"' : ''} marker-end="url(#arrowhead)"/>`;
      cx += 40;
    } else if (it.type === 'dashbox') {
      out += `<rect x="${cx}" y="${y - 12}" width="30" height="16" rx="4" fill="#FAFAFA" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="5 3"/>`;
      cx += 36;
    } else if (it.type === 'kind') {
      out += `<rect x="${cx}" y="${y - 12}" width="30" height="16" rx="4" ${shapeAttrs(it.kind)}/>`;
      cx += 36;
    }
    out += textBlock({ x: cx, y, lines: [it.label], size, fill: TEXT });
    cx += it.label.length * size * 0.56 + 22;
  }
  return out;
}

function render({ width, height, title, subtitle, footer, body }) {
  const defs = `<defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${LINE}"/>
    </marker>
  </defs>`;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}" role="img" aria-label="${esc(title)}">`;
  out += defs;
  out += `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`;
  out += textBlock({ x: 30, y: 44, lines: [title], size: 24, weight: 700, fill: TITLE });
  if (subtitle) out += textBlock({ x: 30, y: 70, lines: Array.isArray(subtitle) ? subtitle : [subtitle], size: 14, fill: '#6B7280' });
  out += body.join('\n');
  if (footer) out += note({ x: 30, y: height - 14, lines: footer, size: 11 });
  out += '</svg>';
  return out;
}

module.exports = { KINDS, box, store, group, arrow, bus, note, legend, render, textBlock };
