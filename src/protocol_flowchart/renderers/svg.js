import { findNode } from '../core/graph.js';

const COIL_R     = 16;   // Coil arrow arc radius
const ANNOT_DIST = 40;   // px from edge to annotation box center

// ── Public entry point ────────────────────────────────────────────────────────

export function renderSVG(graph, opts = {}) {
  const width  = opts.width  ?? 1200;
  const height = opts.height ?? 600;
  const pad    = graph.meta?.nodePadding ?? 8;

  const fontFamily = graph.meta?.fontFamily ?? 'sans-serif';

  const vx = opts.viewBoxX ?? 0;
  const vy = opts.viewBoxY ?? 0;

  const parts = [];
  parts.push(svgOpen(width, height, vx, vy));
  parts.push('<defs>');
  // Per-edge main arrow markers
  for (const edge of graph.edges) {
    const color = edge.arrowStyle.color ?? (edge.arrowStyle.type === 'dashed' ? '#666' : '#333');
    parts.push(arrowMarkerDef(`arrow-${edge.id}`, color, edge.arrowStyle.headSize, edge.arrowStyle.thickness));
    // Per-annotation arrow markers (color/size customisable)
    for (const item of (edge.annotations?.items ?? [])) {
      if (!(item.showArrow ?? true)) continue;
      parts.push(arrowMarkerDef(
        `annot-arrow-${item.id}`,
        item.arrowColor ?? '#555555',
        item.arrowHeadSize ?? 6,
        item.arrowThickness ?? 1,
      ));
    }
  }
  parts.push('</defs>');

  for (const edge of graph.edges) {
    const from = findNode(graph, edge.fromId);
    const to   = findNode(graph, edge.toId);
    if (!from || !to) continue;
    parts.push(renderEdge(edge, from, to, `arrow-${edge.id}`, fontFamily, pad));
  }

  for (const node of graph.nodes) {
    parts.push(renderNode(node, {}, fontFamily, pad));
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ── Node rendering ────────────────────────────────────────────────────────────

function renderNode(node, overrideStyle = {}, fontFamily = 'sans-serif', pad = 8) {
  const style    = { ...node.style, ...overrideStyle };
  const labelStr = String(node.label || '');
  const { x, y, shape } = node;
  const stroke   = style.borderColor ?? '#333333';

  // Empty label → invisible junction; render a tiny dot as visual cue
  if (!labelStr.trim()) {
    return `<circle cx="${x}" cy="${y}" r="2" fill="${stroke}"/>`;
  }

  const lines  = labelStr.split('\n');
  const fs     = style.fontSize ?? 14;
  const lineH  = fs * 1.4;
  const textW  = Math.max(...lines.map(l => l.length)) * fs * 0.6;
  const textH  = lines.length * lineH;
  const w      = textW + pad * 2;
  const h      = textH + pad * 2;
  const fill   = style.fillColor ?? '#ffffff';

  const fw = style.fontWeight ?? 'normal';
  const fi = style.fontStyle  ?? 'normal';
  const textEl = lines.map((l, i) =>
    `<tspan x="${x}" dy="${i === 0 ? -(lines.length - 1) * lineH / 2 + fs * 0.35 : lineH}">${spanify(l, fs)}</tspan>`
  ).join('');
  const label = `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fs}" font-weight="${fw}" font-style="${fi}" fill="${stroke}" font-family="${fontFamily}">${textEl}</text>`;

  if (shape === 'none') return label;

  let shapeEl = '';
  if (shape === 'box') {
    shapeEl = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  } else if (shape === 'circle') {
    const r = Math.max(w, h) / 2;
    shapeEl = `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  } else if (shape === 'diamond') {
    const hw = w / 2, hh = h / 2;
    shapeEl = `<polygon points="${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  return shapeEl + '\n' + label;
}

// ── Edge rendering ────────────────────────────────────────────────────────────

function renderEdge(edge, from, to, markerId, fontFamily = 'sans-serif', pad = 8) {
  const parts = [];
  const { thickness, headSize, type } = edge.arrowStyle;
  const dashed = type === 'dashed' ? `stroke-dasharray="${headSize * 1.5} ${headSize}"` : '';
  const color  = edge.arrowStyle.color ?? (type === 'dashed' ? '#666' : '#333');

  const path = edge.routing === 'orthogonal'
    ? orthogonalPath(from, to, pad)
    : diagonalPath(from, to, pad);

  parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="${thickness}" ${dashed} marker-end="url(#${markerId})"/>`);

  // Coil arrow
  if (edge.annotations.coil) {
    const t         = edge.annotations.coilT    ?? 0.5;
    const side      = edge.annotations.coilSide ?? 'above';
    const cs        = edge.annotations.coilStyle ?? {};
    const r         = cs.radius    ?? COIL_R;
    const thickness = cs.thickness ?? 1.5;
    const headSize  = cs.headSize  ?? 5;
    const gap       = cs.gap       ?? 12;
    const pt = pointOnPath(edge, from, to, t, pad);
    const pd = perpDir(pt.tx, pt.ty, side);
    parts.push(coilArrow(pt.x + pd.x * (r + gap), pt.y + pd.y * (r + gap), r, thickness, headSize));
  }

  // Perpendicular annotation items
  for (const item of (edge.annotations.items ?? [])) {
    parts.push(renderAnnotationItem(item, edge, from, to, fontFamily, pad));
  }

  return parts.join('\n');
}

// ── Annotation item rendering ─────────────────────────────────────────────────

function renderAnnotationItem(item, edge, from, to, fontFamily = 'sans-serif', pad = 8) {
  const edgePt = pointOnPath(edge, from, to, item.t ?? 0.5, pad);
  const pd     = perpDir(edgePt.tx, edgePt.ty, item.side ?? 'above');
  const dist = item.dist ?? ANNOT_DIST;
  const cx   = edgePt.x + pd.x * dist;
  const cy   = edgePt.y + pd.y * dist;

  const proxy = {
    label: item.label || ' ',
    shape: item.shape ?? 'none',
    style: { borderColor: '#444', fillColor: '#f8f8f8', fontSize: item.fontSize ?? 12, fontWeight: item.fontWeight ?? 'normal', fontStyle: item.fontStyle ?? 'normal' },
    x: cx, y: cy,
  };

  const showArrow      = item.showArrow      ?? true;
  const arrowGap       = item.arrowGap       ?? 2;
  const arrowColor     = item.arrowColor     ?? '#555555';
  const arrowThickness = item.arrowThickness ?? 1.5;
  const arrowLine = showArrow
    ? (() => {
      const bp  = borderPoint(proxy, edgePt.x, edgePt.y, pad);
      const len = Math.hypot(edgePt.x - bp.x, edgePt.y - bp.y);
      const nx  = len > 0 ? (edgePt.x - bp.x) / len : 0;
      const ny  = len > 0 ? (edgePt.y - bp.y) / len : 0;
      const x1  = bp.x + arrowGap * nx;
      const y1  = bp.y + arrowGap * ny;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${edgePt.x.toFixed(1)}" y2="${edgePt.y.toFixed(1)}" stroke="${arrowColor}" stroke-width="${arrowThickness}" marker-end="url(#annot-arrow-${item.id})"/>`;
    })()
    : '';

  const content = renderNode(proxy, {}, fontFamily, pad) + (arrowLine ? '\n' + arrowLine : '');
  // pointer-events="all" overrides the parent <g pointer-events="none"> so annotations are clickable
  return `<g data-id="${item.id}" data-type="annot" data-edge-id="${edge.id}" style="cursor:pointer" pointer-events="all">\n${content}\n</g>`;
}

// ── Path position & geometry ──────────────────────────────────────────────────

// Returns { x, y, tx, ty } — position and unnormalized tangent at t ∈ [0,1].
function pointOnPath(edge, from, to, t, pad = 8) {
  if (edge.routing === 'diagonal') {
    const s  = borderPoint(from, to.x, to.y, pad);
    const e  = borderPoint(to, from.x, from.y, pad);
    const tx = e.x - s.x, ty = e.y - s.y;
    return { x: s.x + t * tx, y: s.y + t * ty, tx, ty };
  }

  // orthogonal: 3 segments M sx sy H midX V ey H ex
  const s    = borderPoint(from, to.x, from.y, pad);
  const e    = borderPoint(to, s.x, to.y, pad);
  const midX = (s.x + e.x) / 2;
  const segs = [
    { x0: s.x,  y0: s.y,  x1: midX, y1: s.y,  tx: midX - s.x, ty: 0 },
    { x0: midX, y0: s.y,  x1: midX, y1: e.y,  tx: 0, ty: e.y - s.y },
    { x0: midX, y0: e.y,  x1: e.x,  y1: e.y,  tx: e.x - midX, ty: 0 },
  ];
  const lens  = segs.map(seg => Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0));
  const total = lens.reduce((a, b) => a + b, 0);
  if (total === 0) return { x: s.x, y: s.y, tx: 1, ty: 0 };

  let dist = t * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= lens[i] + 1e-9 || i === segs.length - 1) {
      const frac = lens[i] === 0 ? 0 : Math.min(dist / lens[i], 1);
      const seg  = segs[i];
      return {
        x: seg.x0 + frac * (seg.x1 - seg.x0),
        y: seg.y0 + frac * (seg.y1 - seg.y0),
        tx: seg.tx, ty: seg.ty,
      };
    }
    dist -= lens[i];
  }
}

// Normalized perpendicular to tangent (tx,ty).
// 'above' = left of travel direction; 'below' = right.
function perpDir(tx, ty, side) {
  const raw = side === 'above' ? { x: -ty, y: tx } : { x: ty, y: -tx };
  const len = Math.hypot(raw.x, raw.y);
  if (len === 0) return { x: 0, y: side === 'above' ? -1 : 1 };
  return { x: raw.x / len, y: raw.y / len };
}

// ── Node geometry helpers ─────────────────────────────────────────────────────

function nodeDims(node, pad = 8) {
  const labelStr = String(node.label || '');
  if (!labelStr.trim()) return { w: 0, h: 0 };
  const lines = labelStr.split('\n');
  const fs    = node.style?.fontSize ?? 14;
  const w     = Math.max(...lines.map(l => l.length)) * fs * 0.6 + pad * 2;
  const h     = lines.length * fs * 1.4 + pad * 2;
  return { w, h };
}

export function borderPoint(node, tx, ty, pad = 8) {
  const { x, y, shape } = node;
  const { w, h } = nodeDims(node, pad);
  const dx = tx - x, dy = ty - y;
  if (dx === 0 && dy === 0) return { x, y };
  if (w === 0 && h === 0) return { x, y };

  if (shape === 'circle') {
    const r = Math.max(w, h) / 2, len = Math.hypot(dx, dy);
    return { x: x + r * dx / len, y: y + r * dy / len };
  }
  if (shape === 'diamond') {
    const hw = w / 2, hh = h / 2;
    const t  = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: x + t * dx, y: y + t * dy };
  }
  // box or none
  const hw = w / 2, hh = h / 2;
  if (Math.abs(dy) * hw < Math.abs(dx) * hh) {
    const t = (dx > 0 ? hw : -hw) / dx;
    return { x: x + t * dx, y: y + t * dy };
  }
  const t = (dy > 0 ? hh : -hh) / dy;
  return { x: x + t * dx, y: y + t * dy };
}

// ── Path generators ───────────────────────────────────────────────────────────

function orthogonalPath(from, to, pad = 8) {
  const s = borderPoint(from, to.x, from.y, pad);
  const e = borderPoint(to, s.x, to.y, pad);
  const m = (s.x + e.x) / 2;
  return `M ${s.x} ${s.y} H ${m} V ${e.y} H ${e.x}`;
}

function diagonalPath(from, to, pad = 8) {
  const s = borderPoint(from, to.x, to.y, pad);
  const e = borderPoint(to, from.x, from.y, pad);
  return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
}

// ── Coil arrow ────────────────────────────────────────────────────────────────

function coilArrow(cx, cy, r, thickness, headSize) {
  const startAngle = -80  * Math.PI / 180;
  const endAngle   = -100 * Math.PI / 180;
  const sx = cx + r * Math.cos(startAngle), sy = cy + r * Math.sin(startAngle);
  const ex = cx + r * Math.cos(endAngle),   ey = cy + r * Math.sin(endAngle);
  const ta = endAngle + Math.PI / 2;
  const ax1 = ex + headSize * Math.cos(ta - 0.5), ay1 = ey + headSize * Math.sin(ta - 0.5);
  const ax2 = ex + headSize * Math.cos(ta + 0.5), ay2 = ey + headSize * Math.sin(ta + 0.5);
  return [
    `<path d="M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke="#333" stroke-width="${thickness}"/>`,
    `<polygon points="${ex.toFixed(2)},${ey.toFixed(2)} ${ax1.toFixed(2)},${ay1.toFixed(2)} ${ax2.toFixed(2)},${ay2.toFixed(2)}" fill="#333"/>`,
  ].join('\n');
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function arrowMarkerDef(id, color, size, thickness = 1) {
  const s = size / thickness;
  return `<marker id="${id}" markerWidth="${s}" markerHeight="${s}" refX="${s}" refY="${s / 2}" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, ${s} ${s / 2}, 0 ${s}" fill="${color}"/></marker>`;
}

function svgOpen(w, h, vx = 0, vy = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vx} ${vy} ${w} ${h}">`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _SUB_FROM = {'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','₊':'+','₋':'-'};
const _SUP_FROM = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-'};

function spanify(text, fs) {
  text = String(text).replaceAll('℃', '°C'); // ℃ → °C
  const segments = [];
  let cur = { type: 'normal', chars: [] };
  for (const ch of text) {
    const type = _SUB_FROM[ch] ? 'sub' : _SUP_FROM[ch] ? 'sup' : 'normal';
    if (type !== cur.type) { if (cur.chars.length) segments.push(cur); cur = { type, chars: [] }; }
    cur.chars.push(ch);
  }
  if (cur.chars.length) segments.push(cur);
  return segments.map(seg => {
    if (seg.type === 'normal') return esc(seg.chars.join(''));
    const ascii = seg.chars.map(c => seg.type === 'sub' ? _SUB_FROM[c] : _SUP_FROM[c]).join('');
    return `<tspan baseline-shift="${seg.type === 'sub' ? 'sub' : 'super'}" font-size="${(0.7 * fs).toFixed(1)}">${esc(ascii)}</tspan>`;
  }).join('');
}

// ── Bounding box ──────────────────────────────────────────────────────────────

function computeBoundingBox(graph, margin = 24) {
  const pad = graph.meta?.nodePadding ?? 8;

  if (graph.nodes.length === 0) return { x: 0, y: 0, w: 800, h: 400 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (cx, cy, hw, hh) => {
    minX = Math.min(minX, cx - hw);
    minY = Math.min(minY, cy - hh);
    maxX = Math.max(maxX, cx + hw);
    maxY = Math.max(maxY, cy + hh);
  };

  for (const node of graph.nodes) {
    const { w, h } = nodeDims(node, pad);
    expand(node.x, node.y, Math.max(w, 24) / 2, Math.max(h, 24) / 2);
  }

  for (const edge of graph.edges) {
    const from = findNode(graph, edge.fromId);
    const to   = findNode(graph, edge.toId);
    if (!from || !to) continue;
    for (const item of (edge.annotations.items ?? [])) {
      if (!item.label?.trim()) continue;
      const pt  = pointOnPath(edge, from, to, item.t ?? 0.5, pad);
      const pd  = perpDir(pt.tx, pt.ty, item.side ?? 'above');
      const cx  = pt.x + pd.x * (item.dist ?? ANNOT_DIST);
      const cy  = pt.y + pd.y * (item.dist ?? ANNOT_DIST);
      const { w, h } = nodeDims(
        { label: item.label, shape: item.shape ?? 'none', style: { fontSize: item.fontSize ?? 12 } }, pad
      );
      expand(cx, cy, Math.max(w, 10) / 2, Math.max(h, 10) / 2);
    }
  }

  return {
    x: minX - margin,
    y: minY - margin,
    w: Math.ceil(maxX - minX + margin * 2),
    h: Math.ceil(maxY - minY + margin * 2),
  };
}

// ── SVG download ──────────────────────────────────────────────────────────────

export function downloadSVG(graph) {
  const bb   = computeBoundingBox(graph);
  const svg  = renderSVG(graph, { width: bb.w, height: bb.h, viewBoxX: bb.x, viewBoxY: bb.y });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (graph.meta.title || 'protocol_flowchart') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}
