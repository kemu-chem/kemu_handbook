import {
  createGraph, addNode, addEdge, removeNode, removeEdge,
  updateNode, updateEdge, findNode, findEdge,
  edgesTo, edgesFrom,
  toJSON, fromJSON, getComponent, uid,
} from '../core/graph.js';
import { applyLayout } from '../core/layout.js';
import { renderSVG, downloadSVG, borderPoint } from '../renderers/svg.js';
import { exportPPTX } from '../renderers/pptx.js';
import { renderPanel } from './panels.js';

// ── State ─────────────────────────────────────────────────────────────────────

let graph             = createGraph();
let selection         = null;         // { type: 'node'|'edge'|'annot', id, edgeId? }
let multiSelection    = new Set();    // nodeIds
let edgeMultiSel      = new Set();    // edgeIds
let hoveredNodeId     = null;
let zoom              = 1.0;
let dragState         = null;         // { startX, startY, dragIds, origPositions }
let panState          = null;
let viewOffset        = { x: 0, y: 0 };
let clickBlocked      = false;
let lastDragMoved     = false;
let snapMode          = true;
let snapStep          = 0.1;
let gridSnap          = true;
let gridSize          = 10;
let nodeDefaults      = { shape: 'none', style: { borderColor: '#333333', fillColor: '#ffffff', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal' } };

// ── DOM ───────────────────────────────────────────────────────────────────────

const svg          = document.getElementById('editor-svg');
const statusbar    = document.getElementById('statusbar');
const titleInput   = document.getElementById('title-input');
const jsonFileInput= document.getElementById('json-file-input');
const snapStepInput= document.getElementById('snap-step');
const gridSizeInput= document.getElementById('grid-size');
const padInput     = document.getElementById('pad-input');
const fontSelect    = document.getElementById('font-select');
const tbTextColor   = document.getElementById('tb-text-color');
const tbFillColor   = document.getElementById('tb-fill-color');
const tbArrowColor  = document.getElementById('tb-arrow-color');
const inlineEdit    = document.getElementById('inline-edit');
const inlineToolbar = document.getElementById('inline-toolbar');

snapStepInput.value = snapStep;
gridSizeInput.value = gridSize;

let inlineEditNodeId = null;
let inlineEditAnnot  = null;  // { id, edgeId } while editing an annotation inline

// ── Undo / Redo ───────────────────────────────────────────────────────────────

const HISTORY_MAX = 30;
const history = [];
const future  = [];

function pushHistory() {
  const snap = toJSON(graph);
  if (history.length > 0 && history[history.length - 1] === snap) return;
  history.push(snap);
  if (history.length > HISTORY_MAX) history.shift();
  future.length = 0;
}

function syncMetaUI() {
  titleInput.value = graph.meta.title || '';
  fontSelect.value = graph.meta.fontFamily ?? 'sans-serif';
  if (padInput) padInput.value = graph.meta.nodePadding ?? 8;
}

function undo() {
  if (history.length === 0) return;
  future.push(toJSON(graph));
  graph = fromJSON(history.pop());
  clearAllSelections();
  syncMetaUI();
  redraw();
}

function redo() {
  if (future.length === 0) return;
  history.push(toJSON(graph));
  graph = fromJSON(future.pop());
  clearAllSelections();
  syncMetaUI();
  redraw();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

document.getElementById('btn-add-node').addEventListener('click', () => {
  pushHistory();
  const focused = selectedNode();
  const edge    = selectedEdge();

  if (edge) {
    const from  = findNode(graph, edge.fromId);
    const to    = findNode(graph, edge.toId);
    const node  = makeNode({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    const saved = { annotations: { ...edge.annotations }, routing: edge.routing, arrowStyle: { ...edge.arrowStyle } };
    removeEdge(graph, edge.id);
    tryAddEdge(edge.fromId, node.id, saved);
    tryAddEdge(node.id, edge.toId);
    clearAllSelections();
    setSelection({ type: 'node', id: node.id });
  } else if (focused) {
    const node = makeNode({ x: focused.x + graph.meta.cellW, y: focused.y });
    tryAddEdge(focused.id, node.id);
    clearAllSelections();
    setSelection({ type: 'node', id: node.id });
  } else {
    const node = makeNode({
      x: svgWidth()  / (2 * zoom) - viewOffset.x,
      y: svgHeight() / (2 * zoom) - viewOffset.y,
    });
    clearAllSelections();
    setSelection({ type: 'node', id: node.id });
  }
  redraw();
});

document.getElementById('btn-branch-up').addEventListener('click', () => {
  const focused = selectedNode();
  if (!focused) return;
  pushHistory();
  const node = makeNode({ x: focused.x + graph.meta.cellW, y: focused.y - graph.meta.cellH });
  tryAddEdge(focused.id, node.id);
  clearAllSelections();
  setSelection({ type: 'node', id: node.id });
  redraw();
});

document.getElementById('btn-branch-down').addEventListener('click', () => {
  const focused = selectedNode();
  if (!focused) return;
  pushHistory();
  const node = makeNode({ x: focused.x + graph.meta.cellW, y: focused.y + graph.meta.cellH });
  tryAddEdge(focused.id, node.id);
  clearAllSelections();
  setSelection({ type: 'node', id: node.id });
  redraw();
});

document.getElementById('btn-connect-mode').addEventListener('click', () => {
  const ids = [...multiSelection];
  if (ids.length < 2) {
    statusbar.textContent = 'Select at least 2 nodes to connect';
    return;
  }
  pushHistory();
  const [sourceId, ...targetIds] = ids;
  for (const targetId of targetIds) tryAddEdge(sourceId, targetId);
  redraw();
});

document.getElementById('btn-select-all-nodes').addEventListener('click', () => {
  edgeMultiSel.clear();
  multiSelection.clear();
  graph.nodes.forEach(n => multiSelection.add(n.id));
  setSelection(null);
  redraw();
});

document.getElementById('btn-select-all-edges').addEventListener('click', () => {
  multiSelection.clear();
  edgeMultiSel.clear();
  graph.edges.forEach(e => edgeMultiSel.add(e.id));
  setSelection(null);
  redraw();
});

document.getElementById('btn-select-component').addEventListener('click', () => {
  const node = selectedNode();
  if (!node) { statusbar.textContent = 'Select a node first'; return; }
  selectComponent(node.id);
});

document.getElementById('btn-merge').addEventListener('click', mergeSelection);
document.getElementById('btn-delete').addEventListener('click', doDelete);

document.getElementById('btn-snap').addEventListener('click', (e) => {
  snapMode = !snapMode;
  e.currentTarget.classList.toggle('active', snapMode);
  redraw();
});

document.getElementById('btn-grid-snap').addEventListener('click', (e) => {
  gridSnap = !gridSnap;
  e.currentTarget.classList.toggle('active', gridSnap);
});

snapStepInput.addEventListener('input', () => {
  const v = Number(snapStepInput.value);
  if (v > 0) { snapStep = v; if (snapMode) redraw(); }
});

gridSizeInput.addEventListener('input', () => {
  const v = Number(gridSizeInput.value);
  if (v > 0) gridSize = v;
});

if (padInput) padInput.addEventListener('input', () => {
  const v = Number(padInput.value);
  if (v >= 0) { graph.meta.nodePadding = v; redraw(); }
});

document.getElementById('btn-relayout').addEventListener('click', () => {
  pushHistory();
  applyLayout(graph, { forceAll: true });
  redraw();
});

document.getElementById('btn-export-svg').addEventListener('click', () => {
  downloadSVG(graph);
});

document.getElementById('btn-export-pptx').addEventListener('click', async () => {
  const svgStr = renderSVG(graph, { width: 1200, height: 600 });
  await exportPPTX(svgStr, graph.meta.title || 'protocol_flowchart');
});

document.getElementById('btn-save-json').addEventListener('click', () => {
  graph.meta.title = titleInput.value;
  const blob = new Blob([toJSON(graph)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (graph.meta.title || 'protocol_flowchart') + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-save-selection-json').addEventListener('click', () => {
  const ids = new Set(
    multiSelection.size >= 1 ? [...multiSelection]
    : selection?.type === 'node' ? [selection.id]
    : []
  );
  if (ids.size === 0) { statusbar.textContent = 'No nodes selected'; return; }

  const nodes = [...ids].map(id => findNode(graph, id)).filter(Boolean);
  const edges = graph.edges.filter(e => ids.has(e.fromId) && ids.has(e.toId));
  const subgraph = { ...graph, nodes, edges };
  const blob = new Blob([JSON.stringify(subgraph, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (graph.meta.title || 'protocol_flowchart') + '_selection.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-save-selection-svg').addEventListener('click', () => {
  const ids = new Set(
    multiSelection.size >= 1 ? [...multiSelection]
    : selection?.type === 'node' ? [selection.id]
    : []
  );
  if (ids.size === 0) { statusbar.textContent = 'No nodes selected'; return; }

  const nodes = [...ids].map(id => findNode(graph, id)).filter(Boolean);
  const edges = graph.edges.filter(e => ids.has(e.fromId) && ids.has(e.toId));
  downloadSVG({ ...graph, nodes, edges });
});

document.getElementById('btn-load-json').addEventListener('click', () => jsonFileInput.click());

jsonFileInput.addEventListener('change', () => {
  const file = jsonFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      graph = fromJSON(e.target.result);
      titleInput.value = graph.meta.title || '';
      fontSelect.value = graph.meta.fontFamily ?? 'sans-serif';
      if (padInput) padInput.value = graph.meta.nodePadding ?? 8;
      viewOffset = { x: 0, y: 0 };
      history.length = 0;
      future.length  = 0;
      clearAllSelections();
      redraw();
    } catch (err) {
      alert('Failed to load JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  jsonFileInput.value = '';
});

titleInput.addEventListener('input', () => { graph.meta.title = titleInput.value; });

fontSelect.addEventListener('change', () => {
  graph.meta.fontFamily = fontSelect.value;
  redrawQuiet();
});;

document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA') return;
  if (e.key === 'Delete' || e.key === 'Backspace') doDelete();
  if (e.key === 'Escape') { clearAllSelections(); redraw(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleFontProp('fontWeight', 'bold', 'normal'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleFontProp('fontStyle', 'italic', 'normal'); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); edgeMultiSel.clear(); multiSelection.clear(); graph.nodes.forEach(n => multiSelection.add(n.id)); setSelection(null); redraw(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteFromClipboard(); }

  const arrowMap = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrowMap[e.key]) {
    const targetIds = multiSelection.size >= 2
      ? [...multiSelection]
      : (selection?.type === 'node' ? [selection.id] : null);
    if (targetIds) {
      e.preventDefault();
      const step = gridSnap ? gridSize : 1;
      const [dx, dy] = arrowMap[e.key].map(v => v * step);
      if (!e.repeat) pushHistory();
      for (const id of targetIds) {
        const n = findNode(graph, id);
        if (!n) continue;
        updateNode(graph, id, { x: n.x + dx, y: n.y + dy });
      }
      redrawQuiet();
    }
  }
});

// ── SVG interaction ───────────────────────────────────────────────────────────

svg.addEventListener('click', (e) => {
  if (clickBlocked) return;

  // Hover-action triangle click
  const actionEl = e.target.closest('.hover-action');
  if (actionEl) {
    const { action, nodeId } = actionEl.dataset;
    const node = findNode(graph, nodeId);
    if (!node) return;
    pushHistory();
    let created;
    if (action === 'extend') {
      created = makeNode({ x: node.x + graph.meta.cellW, y: node.y });
    } else if (action === 'branch-up') {
      created = makeNode({ x: node.x + graph.meta.cellW, y: node.y - graph.meta.cellH });
    } else if (action === 'branch-down') {
      created = makeNode({ x: node.x + graph.meta.cellW, y: node.y + graph.meta.cellH });
    }
    if (created) { tryAddEdge(node.id, created.id); clearAllSelections(); setSelection({ type: 'node', id: created.id }); }
    redraw();
    return;
  }

  const target = e.target.closest('[data-id]');

  if (!target) {
    clearAllSelections();
    redraw();
    return;
  }

  const { id, type } = target.dataset;

  // Annotation click
  if (type === 'annot') {
    const edgeId = target.dataset.edgeId;
    const wasDragged = lastDragMoved;
    lastDragMoved = false;
    if (!wasDragged && selection?.type === 'annot' && selection.id === id) {
      const edge = findEdge(graph, edgeId);
      const item = edge?.annotations?.items?.find(it => it.id === id);
      if (item) { showInlineEditAnnot(item, edgeId, e); return; }
    }
    clearAllSelections();
    setSelection({ type: 'annot', id, edgeId });
    redraw();
    return;
  }

  // Alt+click on node → select its weakly connected component
  // Shift+Alt+click → add component to existing multiSelection
  if (type === 'node' && e.altKey) {
    if (e.shiftKey) {
      const { nodeIds } = getComponent(graph, id);
      edgeMultiSel.clear();
      if (selection?.type === 'node') multiSelection.add(selection.id);
      nodeIds.forEach(nid => multiSelection.add(nid));
      setSelection(null);
      redraw();
    } else {
      selectComponent(id);
    }
    return;
  }

  // Node shift-click (multi-select nodes)
  if (type === 'node' && e.shiftKey) {
    edgeMultiSel.clear();
    if (multiSelection.has(id)) {
      multiSelection.delete(id);
    } else {
      if (selection?.type === 'node') multiSelection.add(selection.id);
      multiSelection.add(id);
    }
    if (multiSelection.size <= 1) {
      setSelection(multiSelection.size === 1 ? { type: 'node', id: [...multiSelection][0] } : null);
      multiSelection.clear();
    }
    redraw();
    return;
  }

  // Edge shift-click (multi-select edges)
  if (type === 'edge' && e.shiftKey) {
    multiSelection.clear();
    if (edgeMultiSel.has(id)) {
      edgeMultiSel.delete(id);
    } else {
      if (selection?.type === 'edge') edgeMultiSel.add(selection.id);
      edgeMultiSel.add(id);
    }
    if (edgeMultiSel.size <= 1) {
      setSelection(edgeMultiSel.size === 1 ? { type: 'edge', id: [...edgeMultiSel][0] } : null);
      edgeMultiSel.clear();
    }
    redraw();
    return;
  }

  // Click on already-selected node (without drag) → open inline editor
  if (type === 'node' && !lastDragMoved && selection?.type === 'node' && selection.id === id) {
    lastDragMoved = false;
    const node = findNode(graph, id);
    if (node) { showInlineEdit(node); return; }
  }
  lastDragMoved = false;

  // Regular click
  clearAllSelections();
  setSelection({ type, id });
  redraw();
});

svg.addEventListener('mousedown', (e) => {
  const nodeTarget = e.target.closest('[data-type="node"]');

  if (nodeTarget) {
    const nodeId = nodeTarget.dataset.id;
    const node   = findNode(graph, nodeId);
    if (!node) return;
    pushHistory();
    const pt = svgPoint(e);

    const dragIds = multiSelection.size >= 2 && multiSelection.has(nodeId)
      ? [...multiSelection]
      : [nodeId];
    const origPositions = new Map(
      dragIds.map(id => { const n = findNode(graph, id); return n ? [id, { x: n.x, y: n.y }] : null; })
             .filter(Boolean)
    );
    dragState = { startX: pt.x, startY: pt.y, dragIds, origPositions };
    hoveredNodeId = null;
    // Do NOT call e.preventDefault() here — it suppresses dblclick in some browsers.
    // Text selection is already prevented by `user-select: none` on the SVG element.
  } else if (!e.target.closest('[data-id]')) {
    panState = { startX: e.clientX, startY: e.clientY, origX: viewOffset.x, origY: viewOffset.y, moved: false };
    svg.classList.add('panning');
    e.preventDefault();
  }
});

svg.addEventListener('mousemove', (e) => {
  if (dragState) {
    const pt = svgPoint(e);
    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.moved = true;
    for (const id of dragState.dragIds) {
      const orig = dragState.origPositions.get(id);
      if (!orig) continue;
      let nx = orig.x + dx;
      let ny = orig.y + dy;
      if (gridSnap) { nx = snapGrid(nx); ny = snapGrid(ny); }
      updateNode(graph, id, { x: nx, y: ny });
    }
    redrawQuiet();
  } else if (panState) {
    viewOffset.x = panState.origX + (e.clientX - panState.startX) / zoom;
    viewOffset.y = panState.origY + (e.clientY - panState.startY) / zoom;
    panState.moved = true;
    redrawQuiet();
  }
});

svg.addEventListener('mouseup', () => {
  lastDragMoved = dragState?.moved ?? false;
  if (panState?.moved) {
    clickBlocked = true;
    setTimeout(() => { clickBlocked = false; }, 0);
  }
  dragState = null;
  panState  = null;
  svg.classList.remove('panning');
});


inlineEdit.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hideInlineEdit(true); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    applyInlineFontProp('fontWeight', 'bold', 'normal');
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
    e.preventDefault();
    applyInlineFontProp('fontStyle', 'italic', 'normal');
  }
});

inlineEdit.addEventListener('input', () => {
  inlineEdit.style.height = 'auto';
  inlineEdit.style.height = `${inlineEdit.scrollHeight}px`;
});

inlineEdit.addEventListener('blur', () => hideInlineEdit(true));

// ── Inline script buttons ─────────────────────────────────────────────────────

const _SUB_CPS = [0x2080,0x2081,0x2082,0x2083,0x2084,0x2085,0x2086,0x2087,0x2088,0x2089,0x208A,0x208B];
const _SUP_CPS = [0x2070,0x00B9,0x00B2,0x00B3,0x2074,0x2075,0x2076,0x2077,0x2078,0x2079,0x207A,0x207B];
const _KEYS    = '0123456789+-'.split('');
const _chr     = cp => String.fromCodePoint(cp);
const SCRIPT_SUB = Object.fromEntries([
  ..._KEYS.map((k, i) => [k,           _chr(_SUB_CPS[i])]),
  ..._SUP_CPS.map((cp, i) => [_chr(cp), _chr(_SUB_CPS[i])]),
]);
const SCRIPT_SUP = Object.fromEntries([
  ..._KEYS.map((k, i) => [k,           _chr(_SUP_CPS[i])]),
  ..._SUB_CPS.map((cp, i) => [_chr(cp), _chr(_SUP_CPS[i])]),
]);

function applyScriptInline(map) {
  const s = inlineEdit.selectionStart, e = inlineEdit.selectionEnd;
  if (s === e) return;
  const val  = inlineEdit.value;
  const conv = [...val.slice(s, e)].map(c => map[c] ?? c).join('');
  inlineEdit.value = val.slice(0, s) + conv + val.slice(e);
  inlineEdit.setSelectionRange(s, s + conv.length);
  inlineEdit.focus();
}

document.getElementById('itb-sub')?.addEventListener('mousedown', e => { e.preventDefault(); applyScriptInline(SCRIPT_SUB); });
document.getElementById('itb-sup')?.addEventListener('mousedown', e => { e.preventDefault(); applyScriptInline(SCRIPT_SUP); });

svg.addEventListener('mouseover', (e) => {
  if (dragState || panState) return;
  if (e.target.closest('#hover-actions')) return;
  const nodeEl = e.target.closest('[data-type="node"]');
  const newId  = nodeEl?.dataset.id ?? null;
  if (newId !== hoveredNodeId) {
    hoveredNodeId = newId;
    updateHoverActions();
  }
});

svg.addEventListener('mouseleave', () => {
  dragState = null;
  panState  = null;
  svg.classList.remove('panning');
  if (hoveredNodeId) { hoveredNodeId = null; updateHoverActions(); }
});

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Pinch gesture (trackpad) or Ctrl+wheel (mouse) → zoom toward cursor
    // Clamp delta so mouse wheel (deltaY≈100) doesn't jump; trackpad pinch (deltaY≈3) is more responsive
    const clampedDelta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 25);
    const factor  = Math.pow(0.99, clampedDelta);
    const newZoom = Math.min(8, Math.max(0.1, zoom * factor));
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    viewOffset.x += px * (1 / newZoom - 1 / zoom);
    viewOffset.y += py * (1 / newZoom - 1 / zoom);
    zoom = newZoom;
  } else {
    // Two-finger scroll (trackpad) or plain wheel (mouse) → pan
    viewOffset.x -= e.deltaX / zoom;
    viewOffset.y -= e.deltaY / zoom;
  }
  redrawQuiet();
}, { passive: false });

// ── Toolbar color pickers ─────────────────────────────────────────────────────

function updateToolbarColors() {
  if (multiSelection.size >= 2) {
    const n = graph.nodes.find(n => multiSelection.has(n.id));
    if (n) { tbTextColor.value = n.style.borderColor ?? '#333333'; tbFillColor.value = n.style.fillColor ?? '#ffffff'; }
    tbArrowColor.value = '#333333';
  } else if (edgeMultiSel.size >= 2) {
    const e = graph.edges.find(e => edgeMultiSel.has(e.id));
    if (e) tbArrowColor.value = e.arrowStyle.color ?? '#333333';
  } else if (selection?.type === 'node') {
    const n = findNode(graph, selection.id);
    if (n) { tbTextColor.value = n.style.borderColor ?? '#333333'; tbFillColor.value = n.style.fillColor ?? '#ffffff'; }
  } else if (selection?.type === 'edge') {
    const e = findEdge(graph, selection.id);
    if (e) tbArrowColor.value = e.arrowStyle.color ?? '#333333';
  }
}

function makeColorApplier(applyFn) {
  let pushed = false;
  return {
    onInput(e) {
      if (!pushed) { pushHistory(); pushed = true; }
      applyFn(e.target.value);
      redrawQuiet();
    },
    onChange() { pushed = false; redraw(); },
  };
}

const _textColorH  = makeColorApplier(color => {
  const ids = multiSelection.size >= 2 ? [...multiSelection] : (selection?.type === 'node' ? [selection.id] : []);
  for (const id of ids) updateNode(graph, id, { style: { borderColor: color } });
});
const _fillColorH  = makeColorApplier(color => {
  const ids = multiSelection.size >= 2 ? [...multiSelection] : (selection?.type === 'node' ? [selection.id] : []);
  for (const id of ids) updateNode(graph, id, { style: { fillColor: color } });
});
const _arrowColorH = makeColorApplier(color => {
  const ids = edgeMultiSel.size >= 2 ? [...edgeMultiSel] : (selection?.type === 'edge' ? [selection.id] : []);
  for (const id of ids) updateEdge(graph, id, { arrowStyle: { color } });
});

tbTextColor.addEventListener('input',  e => _textColorH.onInput(e));
tbTextColor.addEventListener('change', ()  => _textColorH.onChange());
tbFillColor.addEventListener('input',  e => _fillColorH.onInput(e));
tbFillColor.addEventListener('change', ()  => _fillColorH.onChange());
tbArrowColor.addEventListener('input',  e => _arrowColorH.onInput(e));
tbArrowColor.addEventListener('change', ()  => _arrowColorH.onChange());

// ── Rendering ─────────────────────────────────────────────────────────────────

function redraw() {
  redrawQuiet();
  const sel   = getSelectionData();
  const tStep = snapMode ? snapStep : 0.01;
  let panelHistoryPushed = false;  // push history once per panel-session

  renderPanel(sel, (id, props) => {
    if (sel.type === 'defaults') {
      if (props.shape !== undefined) nodeDefaults.shape = props.shape;
      if (props.style) Object.assign(nodeDefaults.style, props.style);
      saveNodeDefaults();
      const needsRedraw = props.style?.fontWeight !== undefined || props.style?.fontStyle !== undefined;
      needsRedraw ? redraw() : redrawQuiet();
      return;
    }
    if (!panelHistoryPushed) { pushHistory(); panelHistoryPushed = true; }

    // fontWeight/fontStyle changes need full redraw so panel B/I buttons update visually
    const hasFontStyleChange = (p) =>
      p?.style?.fontWeight !== undefined || p?.style?.fontStyle !== undefined ||
      p?.fontWeight !== undefined || p?.fontStyle !== undefined ||
      p?._annotStyle?.fontWeight !== undefined || p?._annotStyle?.fontStyle !== undefined;

    // Multi-node or multi-edge batch update
    if (Array.isArray(id)) {
      if (sel.type === 'multi') {
        const { _scalePositions, ...nodeProps } = props;
        const fsOld = _scalePositions ? avgFontSize() : 0;
        for (const nid of id) updateNode(graph, nid, nodeProps);
        if (_scalePositions) scaleNodePositions(avgFontSize() / fsOld);
      } else if (props._annotNormalize) {
        const { edgeGap } = props._annotNormalize;
        const pad = graph.meta?.nodePadding ?? 8;
        for (const eid of id) {
          const edge = findEdge(graph, eid);
          if (!edge) continue;
          const items = edge.annotations.items.map(it => ({ ...it, dist: computeAnnotDist(it, edgeGap, pad) }));
          updateEdge(graph, eid, { annotations: { items } });
        }
      } else if (props._annotStyle) {
        // Bulk-update all annotation items in selected edges
        const { _annotStyle } = props;
        const autoScale = document.querySelector('#panel-container input[name="annot-auto-scale"]')?.checked;
        let positionFactor = 1;
        if (autoScale && _annotStyle.fontSize !== undefined) {
          const allItems = id.flatMap(eid => findEdge(graph, eid)?.annotations?.items ?? []);
          const avgOldFs = allItems.length > 0
            ? allItems.reduce((s, it) => s + (it.fontSize ?? 12), 0) / allItems.length : 12;
          positionFactor = avgOldFs > 0 ? _annotStyle.fontSize / avgOldFs : 1;
        }
        for (const eid of id) {
          const edge = findEdge(graph, eid);
          if (!edge) continue;
          const items = edge.annotations.items.map(it => ({ ...it, ..._annotStyle }));
          updateEdge(graph, eid, { annotations: { items } });
        }
        if (isFinite(positionFactor) && Math.abs(positionFactor - 1) > 0.001) scaleNodePositions(positionFactor);
      } else {
        for (const eid of id) updateEdge(graph, eid, props);
      }
      (hasFontStyleChange(props) || props._scalePositions) ? redraw() : redrawQuiet();
      return;
    }

    if (selection?.type === 'node') {
      updateNode(graph, id, props);
      hasFontStyleChange(props) ? redraw() : redrawQuiet();
    } else if (selection?.type === 'annot') {
      // id = itemId, props = item patch
      const edge = findEdge(graph, selection.edgeId);
      if (!edge) return;
      const autoScale = document.querySelector('#panel-container input[name="annot-auto-scale"]')?.checked;
      let positionFactor = 1;
      if (autoScale && props.fontSize !== undefined) {
        const currentItem = edge.annotations.items.find(it => it.id === id);
        const oldFs = currentItem?.fontSize ?? 12;
        positionFactor = oldFs > 0 ? props.fontSize / oldFs : 1;
      }
      const items = edge.annotations.items.map(it => it.id === id ? { ...it, ...props } : it);
      updateEdge(graph, edge.id, { annotations: { items } });
      if (isFinite(positionFactor) && Math.abs(positionFactor - 1) > 0.001) scaleNodePositions(positionFactor);
      // Re-render panel when snap or font style changes to update controls visually
      if (props.snap !== undefined || hasFontStyleChange(props)) redraw();
      else redrawQuiet();
    } else {
      if (props._annotNormalize) {
        const { edgeGap } = props._annotNormalize;
        const pad = graph.meta?.nodePadding ?? 8;
        const edge = findEdge(graph, id);
        if (edge) {
          const items = edge.annotations.items.map(it => ({ ...it, dist: computeAnnotDist(it, edgeGap, pad) }));
          updateEdge(graph, edge.id, { annotations: { items } });
        }
        redrawQuiet();
        return;
      }
      if (props._annotStyle) {
        const edge = findEdge(graph, id);
        if (edge) {
          const items = edge.annotations.items.map(it => ({ ...it, ...props._annotStyle }));
          updateEdge(graph, edge.id, { annotations: { items } });
        }
        hasFontStyleChange(props) ? redraw() : redrawQuiet();
        return;
      }
      const edge      = findEdge(graph, id);
      const prevLen   = edge?.annotations?.items?.length ?? 0;
      const prevCoil  = edge?.annotations?.coil;
      const prevSnaps = edge?.annotations?.items?.map(it => it.snap ?? true).join(',') ?? '';
      updateEdge(graph, id, props);
      const structural = (edge?.annotations?.items?.length ?? 0) !== prevLen ||
                         edge?.annotations?.coil !== prevCoil ||
                         (edge?.annotations?.items?.map(it => it.snap ?? true).join(',') ?? '') !== prevSnaps;
      if (structural) redraw();
      else redrawQuiet();
    }
  }, tStep, nodeDefaults);

  statusbar.textContent = `Nodes: ${graph.nodes.length} / Edges: ${graph.edges.length} | Zoom: ${Math.round(zoom * 100)}%`;
  updateToolbarColors();
  scheduleSave();
}

function redrawQuiet() {
  const w = svgWidth(), h = svgHeight();
  svg.setAttribute('viewBox', `${-viewOffset.x} ${-viewOffset.y} ${w / zoom} ${h / zoom}`);
  svg.innerHTML = buildSVG(w, h);
  updateHoverActions();
}

function buildSVG(w, h) {
  const svgStr = renderSVG(graph, { width: w, height: h });
  const inner  = svgStr.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const overlays = [];

  const nodePad = graph.meta.nodePadding ?? 8;
  for (const node of graph.nodes) {
    const isSelected = (selection?.type === 'node' && selection.id === node.id) ||
                       multiSelection.has(node.id);
    const selAttr = isSelected
      ? 'stroke="var(--primary,#2563eb)" stroke-width="2" stroke-dasharray="4 2"'
      : '';
    const labelStr = String(node.label || '');
    const isEmpty  = !labelStr.trim();
    const lines = isEmpty ? [] : labelStr.split('\n');
    const fs    = node.style?.fontSize ?? 14;
    const hw    = isEmpty ? 12 : Math.max(...lines.map(l => l.length)) * fs * 0.3 + nodePad;
    const hh    = isEmpty ? 12 : lines.length * fs * 0.7 + nodePad;
    overlays.push(
      `<rect data-id="${node.id}" data-type="node"
         x="${node.x - hw}" y="${node.y - hh}" width="${hw * 2}" height="${hh * 2}"
         fill="rgba(0,0,0,0)" pointer-events="all" ${selAttr} style="cursor:move"/>`
    );
  }

  for (const edge of graph.edges) {
    const from = findNode(graph, edge.fromId);
    const to   = findNode(graph, edge.toId);
    if (!from || !to) continue;
    const isSelected = (selection?.type === 'edge' && selection.id === edge.id) ||
                       edgeMultiSel.has(edge.id);
    const edgeStroke = isSelected ? 'var(--primary,#2563eb)' : 'transparent';
    const edgeOpacity = isSelected ? '0.45' : '1';
    let path;
    if (edge.routing === 'orthogonal') {
      const s = borderPoint(from, to.x, from.y, nodePad);
      const e = borderPoint(to, s.x, to.y, nodePad);
      const m = (s.x + e.x) / 2;
      path = `M ${s.x} ${s.y} H ${m} V ${e.y} H ${e.x}`;
    } else {
      const s = borderPoint(from, to.x, to.y, nodePad);
      const e = borderPoint(to, from.x, from.y, nodePad);
      path = `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
    }
    overlays.push(
      `<path data-id="${edge.id}" data-type="edge"
         d="${path}" fill="none" stroke="${edgeStroke}" stroke-opacity="${edgeOpacity}" stroke-width="14" pointer-events="stroke"
         style="cursor:pointer"/>`
    );
  }

  // Wrap inner content so it doesn't intercept pointer events
  return `<g pointer-events="none">${inner}</g>` + overlays.join('\n') +
         '\n<g id="hover-actions" pointer-events="all"></g>';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearAllSelections() {
  multiSelection.clear();
  edgeMultiSel.clear();
  setSelection(null);
}

function selectComponent(nodeId) {
  const { nodeIds } = getComponent(graph, nodeId);
  clearAllSelections();
  if (nodeIds.size >= 2) {
    nodeIds.forEach(id => multiSelection.add(id));
  } else {
    setSelection({ type: 'node', id: nodeId });
  }
  redraw();
}

function setSelection(sel) { selection = sel; }

function selectedNode() {
  if (multiSelection.size === 1) return findNode(graph, [...multiSelection][0]);
  return selection?.type === 'node' ? findNode(graph, selection.id) : null;
}
function selectedEdge() {
  return selection?.type === 'edge' ? findEdge(graph, selection.id) : null;
}
function getSelectionData() {
  if (multiSelection.size >= 2) {
    const nodes = [...multiSelection].map(id => findNode(graph, id)).filter(Boolean);
    return { type: 'multi', data: nodes };
  }
  if (edgeMultiSel.size >= 2) {
    const edges = [...edgeMultiSel].map(id => findEdge(graph, id)).filter(Boolean);
    return { type: 'multi-edge', data: edges };
  }
  if (!selection) return { type: 'defaults', data: nodeDefaults };
  if (selection.type === 'annot') {
    const edge = findEdge(graph, selection.edgeId);
    const item = edge?.annotations?.items?.find(it => it.id === selection.id);
    return item ? { type: 'annot', data: item, edgeId: selection.edgeId } : null;
  }
  if (selection.type === 'node') return { type: 'node', data: findNode(graph, selection.id) };
  return { type: 'edge', data: findEdge(graph, selection.id) };
}

// Converts a desired border-to-edge gap into a center-to-edge dist for an annotation item.
// Assumes the arrow approaches from the perpendicular (short) axis — valid for above/below on horizontal edges.
function computeAnnotDist(item, edgeGap, pad) {
  const lines = String(item.label || ' ').split('\n');
  const fs = item.fontSize ?? 12;
  const h  = lines.length * fs * 1.4 + pad * 2;
  return edgeGap + h / 2;
}

function avgFontSize() {
  if (graph.nodes.length === 0) return 14;
  return graph.nodes.reduce((s, n) => s + (n.style?.fontSize ?? 14), 0) / graph.nodes.length;
}

function scaleNodePositions(factor) {
  if (!isFinite(factor) || Math.abs(factor - 1) < 0.001) return;
  const cx = graph.nodes.reduce((s, n) => s + n.x, 0) / graph.nodes.length;
  const cy = graph.nodes.reduce((s, n) => s + n.y, 0) / graph.nodes.length;
  for (const node of graph.nodes) {
    node.x = cx + (node.x - cx) * factor;
    node.y = cy + (node.y - cy) * factor;
  }
  graph.meta.cellW = Math.round(graph.meta.cellW * factor);
  graph.meta.cellH = Math.round(graph.meta.cellH * factor);
}

function makeNode(props) {
  return addNode(graph, { shape: nodeDefaults.shape, style: { ...nodeDefaults.style }, ...props });
}

function tryAddEdge(fromId, toId, props) {
  try { addEdge(graph, fromId, toId, props); }
  catch (err) { alert(err.message); }
}

const CLIP_TYPE    = 'pf-subgraph';
const PASTE_OFFSET = 20;

function copySelection() {
  const ids = new Set(
    multiSelection.size >= 1 ? [...multiSelection]
    : selection?.type === 'node' ? [selection.id]
    : []
  );
  if (ids.size === 0) return;

  const nodes = [...ids].map(id => findNode(graph, id)).filter(Boolean);
  const edges = graph.edges.filter(e => ids.has(e.fromId) && ids.has(e.toId));

  const payload = JSON.stringify({ _clipType: CLIP_TYPE, nodes, edges });
  navigator.clipboard.writeText(payload).catch(() => {});
  statusbar.textContent = `Copied ${nodes.length} node(s), ${edges.length} edge(s)`;
}

async function pasteFromClipboard() {
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch { statusbar.textContent = 'Clipboard read failed (permission denied?)'; return; }

  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (payload?._clipType !== CLIP_TYPE || !Array.isArray(payload.nodes)) return;

  pushHistory();

  const idMap = new Map(payload.nodes.map(n => [n.id, uid()]));

  const newIds = [];
  for (const n of payload.nodes) {
    const newId = idMap.get(n.id);
    addNode(graph, { ...n, id: newId, x: n.x + PASTE_OFFSET, y: n.y + PASTE_OFFSET });
    newIds.push(newId);
  }
  for (const e of payload.edges) {
    const from = idMap.get(e.fromId), to = idMap.get(e.toId);
    if (!from || !to) continue;
    try { addEdge(graph, from, to, { ...e, id: uid() }); } catch { /* cycle guard */ }
  }

  clearAllSelections();
  newIds.forEach(id => multiSelection.add(id));
  if (newIds.length === 1) { setSelection({ type: 'node', id: newIds[0] }); multiSelection.clear(); }
  redraw();
  statusbar.textContent = `Pasted ${newIds.length} node(s)`;
}

function doDelete() {
  if (!selection && multiSelection.size < 2 && edgeMultiSel.size < 2) return;
  pushHistory();
  if (multiSelection.size >= 2) {
    for (const id of [...multiSelection]) removeNode(graph, id);
    clearAllSelections();
    redraw();
    return;
  }
  if (edgeMultiSel.size >= 2) {
    for (const id of [...edgeMultiSel]) removeEdge(graph, id);
    clearAllSelections();
    redraw();
    return;
  }
  if (!selection) return;
  if (selection.type === 'node') {
    removeNode(graph, selection.id);
  } else if (selection.type === 'edge') {
    removeEdge(graph, selection.id);
  } else if (selection.type === 'annot') {
    const edge = findEdge(graph, selection.edgeId);
    if (edge) {
      const items = edge.annotations.items.filter(it => it.id !== selection.id);
      updateEdge(graph, edge.id, { annotations: { items } });
    }
  }
  clearAllSelections();
  redraw();
}

function mergeSelection() {
  if (multiSelection.size < 2) return;
  pushHistory();

  const keeper = graph.nodes.find(n => multiSelection.has(n.id));
  const others = new Set([...multiSelection].filter(id => id !== keeper.id));

  for (const otherId of others) {
    const incoming = edgesTo(graph, otherId).filter(e => !others.has(e.fromId) && e.fromId !== keeper.id);
    const outgoing = edgesFrom(graph, otherId).filter(e => !others.has(e.toId) && e.toId !== keeper.id);

    for (const edge of incoming) {
      const dup = graph.edges.some(e => e.fromId === edge.fromId && e.toId === keeper.id);
      if (!dup) {
        try { addEdge(graph, edge.fromId, keeper.id, { routing: edge.routing, arrowStyle: { ...edge.arrowStyle }, annotations: edge.annotations }); }
        catch (_) {}
      }
    }
    for (const edge of outgoing) {
      const dup = graph.edges.some(e => e.fromId === keeper.id && e.toId === edge.toId);
      if (!dup) {
        try { addEdge(graph, keeper.id, edge.toId, { routing: edge.routing, arrowStyle: { ...edge.arrowStyle }, annotations: edge.annotations }); }
        catch (_) {}
      }
    }
  }

  for (const otherId of others) removeNode(graph, otherId);
  clearAllSelections();
  setSelection({ type: 'node', id: keeper.id });
  redraw();
}

function svgWidth()  { return svg.clientWidth  || 1200; }
function svgHeight() { return svg.clientHeight || 600; }

function snapGrid(v) { return Math.round(v / gridSize) * gridSize; }

// ── Font style helpers ────────────────────────────────────────────────────────

function toggleFontProp(prop, activeVal, inactiveVal) {
  pushHistory();
  if (selection?.type === 'node') {
    const node = findNode(graph, selection.id);
    if (!node) return;
    updateNode(graph, selection.id, { style: { [prop]: node.style[prop] === activeVal ? inactiveVal : activeVal } });
    redraw();
  } else if (multiSelection.size >= 2) {
    for (const id of multiSelection) {
      const n = findNode(graph, id);
      if (n) updateNode(graph, id, { style: { [prop]: n.style[prop] === activeVal ? inactiveVal : activeVal } });
    }
    redraw();
  } else if (selection?.type === 'annot') {
    const edge = findEdge(graph, selection.edgeId);
    if (!edge) return;
    const items = edge.annotations.items.map(it =>
      it.id === selection.id ? { ...it, [prop]: it[prop] === activeVal ? inactiveVal : activeVal } : it
    );
    updateEdge(graph, edge.id, { annotations: { items } });
    redraw();
  }
}

function applyInlineFontProp(prop, activeVal, inactiveVal) {
  pushHistory();
  if (inlineEditNodeId) {
    const node = findNode(graph, inlineEditNodeId);
    if (!node) return;
    const next = node.style[prop] === activeVal ? inactiveVal : activeVal;
    updateNode(graph, inlineEditNodeId, { style: { [prop]: next } });
    inlineEdit.style[prop] = next;
    redrawQuiet();
  } else if (inlineEditAnnot) {
    const edge = findEdge(graph, inlineEditAnnot.edgeId);
    if (!edge) return;
    const cur   = edge.annotations.items.find(it => it.id === inlineEditAnnot.id)?.[prop] ?? inactiveVal;
    const next  = cur === activeVal ? inactiveVal : activeVal;
    const items = edge.annotations.items.map(it =>
      it.id === inlineEditAnnot.id ? { ...it, [prop]: next } : it
    );
    updateEdge(graph, edge.id, { annotations: { items } });
    inlineEdit.style[prop] = next;
    redrawQuiet();
  }
}

function showInlineEdit(node) {
  inlineEditNodeId = node.id;
  const rect = svg.getBoundingClientRect();
  const sx   = rect.left + (node.x + viewOffset.x) * zoom;
  const sy   = rect.top  + (node.y + viewOffset.y) * zoom;
  const { hw, hh } = nodeHW(node);
  const fs   = node.style?.fontSize ?? 14;

  inlineEdit.value             = node.label;
  inlineEdit.style.fontWeight  = node.style?.fontWeight ?? 'normal';
  inlineEdit.style.fontStyle   = node.style?.fontStyle  ?? 'normal';
  inlineEdit.style.left        = `${sx - Math.max(hw, 40) * zoom}px`;
  inlineEdit.style.top         = `${sy - Math.max(hh, 15) * zoom}px`;
  inlineEdit.style.width       = `${Math.max(hw * 2, 80) * zoom}px`;
  inlineEdit.style.minHeight   = `${Math.max(hh * 2, 30) * zoom}px`;
  inlineEdit.style.height      = 'auto';
  inlineEdit.style.fontSize    = `${fs * zoom}px`;
  inlineEdit.style.fontFamily  = graph.meta.fontFamily ?? 'sans-serif';
  inlineEdit.style.display     = 'block';
  inlineEdit.style.height      = `${inlineEdit.scrollHeight}px`;
  inlineToolbar.style.left    = inlineEdit.style.left;
  inlineToolbar.style.top     = `${parseFloat(inlineEdit.style.top) - 36}px`;
  inlineToolbar.style.display = 'flex';
  inlineEdit.focus();
  inlineEdit.select();
}

function showInlineEditAnnot(item, edgeId, e) {
  inlineEditAnnot = { id: item.id, edgeId };
  const label = String(item.label || '');
  const lines = label.trim() ? label.split('\n') : [''];
  const fs  = item.fontSize ?? 12;
  const pad = graph.meta.nodePadding ?? 8;
  const hw  = Math.max(Math.max(...lines.map(l => l.length)) * fs * 0.3 + pad, 40);
  const hh  = Math.max(lines.length * fs * 0.7 + pad, 15);

  inlineEdit.value            = item.label;
  inlineEdit.style.fontWeight = item.fontWeight ?? 'normal';
  inlineEdit.style.fontStyle  = item.fontStyle  ?? 'normal';
  inlineEdit.style.left       = `${e.clientX - hw * zoom}px`;
  inlineEdit.style.top        = `${e.clientY - hh * zoom}px`;
  inlineEdit.style.width      = `${hw * 2 * zoom}px`;
  inlineEdit.style.minHeight  = `${hh * 2 * zoom}px`;
  inlineEdit.style.height     = 'auto';
  inlineEdit.style.fontSize   = `${fs * zoom}px`;
  inlineEdit.style.fontFamily = graph.meta.fontFamily ?? 'sans-serif';
  inlineEdit.style.display    = 'block';
  inlineEdit.style.height     = `${inlineEdit.scrollHeight}px`;
  inlineToolbar.style.left    = inlineEdit.style.left;
  inlineToolbar.style.top     = `${e.clientY - hh * zoom - 36}px`;
  inlineToolbar.style.display = 'flex';
  inlineEdit.focus();
  inlineEdit.select();
}

function hideInlineEdit(apply) {
  if (!inlineEditNodeId && !inlineEditAnnot) return;
  if (apply) {
    pushHistory();
    if (inlineEditNodeId) {
      updateNode(graph, inlineEditNodeId, { label: inlineEdit.value });
    } else if (inlineEditAnnot) {
      const edge = findEdge(graph, inlineEditAnnot.edgeId);
      if (edge) {
        const items = edge.annotations.items.map(it =>
          it.id === inlineEditAnnot.id ? { ...it, label: inlineEdit.value } : it
        );
        updateEdge(graph, edge.id, { annotations: { items } });
      }
    }
    redraw();
  }
  inlineEdit.style.display    = 'none';
  inlineToolbar.style.display = 'none';
  inlineEditNodeId = null;
  inlineEditAnnot  = null;
}

function nodeHW(node) {
  const label = String(node.label || '');
  if (!label.trim()) return { hw: 12, hh: 12 };
  const lines = label.split('\n');
  const fs  = node.style?.fontSize ?? 14;
  const pad = graph.meta.nodePadding ?? 8;
  return {
    hw: Math.max(...lines.map(l => l.length)) * fs * 0.3 + pad,
    hh: lines.length * fs * 0.7 + pad,
  };
}

function updateHoverActions() {
  const g = document.getElementById('hover-actions');
  if (!g) return;
  if (!hoveredNodeId) { g.innerHTML = ''; return; }
  const node = findNode(graph, hoveredNodeId);
  if (!node) { g.innerHTML = ''; return; }
  const { hw } = nodeHW(node);
  const cx = node.x + hw + 14;
  const s = 8, sp = 22;
  const tri = (action, pts) =>
    `<polygon class="hover-action" data-action="${action}" data-node-id="${hoveredNodeId}" points="${pts}"/>`;
  // Transparent bridge rect: fills the gap between node overlay edge and triangles
  const bridgeX = node.x + hw;
  const bridgeY = node.y - sp - s;
  const bridge  = `<rect x="${bridgeX}" y="${bridgeY}" width="${cx + s - bridgeX + 4}" height="${(sp + s) * 2}" fill="rgba(0,0,0,0)" pointer-events="all"/>`;
  g.innerHTML = [
    bridge,
    tri('branch-up',   `${cx},${node.y - sp - s} ${cx - s},${node.y - sp + s} ${cx + s},${node.y - sp + s}`),
    tri('extend',      `${cx - s},${node.y - s} ${cx - s},${node.y + s} ${cx + s},${node.y}`),
    tri('branch-down', `${cx},${node.y + sp + s} ${cx - s},${node.y + sp - s} ${cx + s},${node.y + sp - s}`),
  ].join('\n');
}

function svgPoint(e) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoom - viewOffset.x,
    y: (e.clientY - rect.top)  / zoom - viewOffset.y,
  };
}

// ── localStorage auto-save ───────────────────────────────────────────────────

const STORAGE_KEY          = 'pfc_autosave';
const STORAGE_KEY_DEFAULTS = 'pfc_node_defaults';
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      graph.meta.title = titleInput.value;
      localStorage.setItem(STORAGE_KEY, toJSON(graph));
    } catch (e) { /* quota exceeded */ }
  }, 800);
}

function saveNodeDefaults() {
  try { localStorage.setItem(STORAGE_KEY_DEFAULTS, JSON.stringify(nodeDefaults)); } catch (e) {}
}

// ── Init ──────────────────────────────────────────────────────────────────────

const cachedDefaults = localStorage.getItem(STORAGE_KEY_DEFAULTS);
if (cachedDefaults) {
  try {
    const d = JSON.parse(cachedDefaults);
    if (d.shape  !== undefined) nodeDefaults.shape = d.shape;
    if (d.style)  Object.assign(nodeDefaults.style, d.style);
  } catch (e) {}
}

const cached = localStorage.getItem(STORAGE_KEY);
if (cached) {
  try {
    graph = fromJSON(cached);
    titleInput.value = graph.meta.title || '';
    fontSelect.value = graph.meta.fontFamily ?? 'sans-serif';
    if (padInput) padInput.value = graph.meta.nodePadding ?? 8;
  } catch (e) {
    addNode(graph, { label: 'Start', x: 100, y: 200 });
  }
} else {
  addNode(graph, { label: 'Start', x: 100, y: 200 });
}
redraw();
