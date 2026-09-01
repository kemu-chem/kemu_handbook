import { uid } from '../core/graph.js';

const panelEl = document.getElementById('panel-container');

const _SUB_CPS = [0x2080, 0x2081, 0x2082, 0x2083, 0x2084, 0x2085, 0x2086, 0x2087, 0x2088, 0x2089, 0x208A, 0x208B];
const _SUP_CPS = [0x2070, 0x00B9, 0x00B2, 0x00B3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079, 0x207A, 0x207B];
const _KEYS = '0123456789+-'.split('');
const _chr = cp => String.fromCodePoint(cp);
// Each map converts: plain digits/signs → target, AND opposite-script chars → target
const SCRIPT_SUB = Object.fromEntries([
  ..._KEYS.map((k, i) => [k, _chr(_SUB_CPS[i])]),  // digit/sign → subscript
  ..._SUP_CPS.map((cp, i) => [_chr(cp), _chr(_SUB_CPS[i])]),  // superscript → subscript
]);
const SCRIPT_SUP = Object.fromEntries([
  ..._KEYS.map((k, i) => [k, _chr(_SUP_CPS[i])]),  // digit/sign → superscript
  ..._SUB_CPS.map((cp, i) => [_chr(cp), _chr(_SUP_CPS[i])]),  // subscript → superscript
]);

// tStep: actual slider step value computed in editor (snapMode ? snapStep : 0.01)
export function renderPanel(selection, updateFn, tStep = 0.25, defaults = null) {
  if (!selection?.data) {
    panelEl.innerHTML = '<p class="panel-empty">Please select a node or edge</p>';
    return;
  }
  if (selection.type === 'defaults') renderDefaultPanel(selection.data, updateFn);
  else if (selection.type === 'node') renderNodePanel(selection.data, updateFn);
  else if (selection.type === 'multi') renderMultiPanel(selection.data, updateFn);
  else if (selection.type === 'multi-edge') renderMultiEdgePanel(selection.data, updateFn);
  else if (selection.type === 'annot') renderAnnotPanel(selection.data, updateFn, tStep);
  else renderEdgePanel(selection.data, updateFn, tStep, defaults);
}

// ── Node panel ────────────────────────────────────────────────────────────────

function renderNodePanel(node, updateFn) {
  panelEl.innerHTML = `
    <h3 style="${H3}">Node Properties</h3>
    ${field('Label', textarea('label', node.label) + scriptBtns())}
    ${field('Shape', selectEl('shape', node.shape, [['none', 'None'], ['box', 'Box'], ['circle', 'Circle'], ['diamond', 'Diamond']]))}
    ${field('Border Color', colorEl('borderColor', node.style.borderColor))}
    ${field('Fill Color', colorEl('fillColor', node.style.fillColor))}
    ${field('Font Size', numberEl('fontSize', node.style.fontSize, 8, 36))}
    ${field('Style', boldItalicBtns(node.style.fontWeight, node.style.fontStyle))}
  `;
  const labelTA = panelEl.querySelector('textarea[name="label"]');
  labelTA?.addEventListener('input', () => updateFn(node.id, { label: labelTA.value }));
  wireScriptBtns(labelTA, v => updateFn(node.id, { label: v }));
  bind('select[name="shape"]', 'change', v => updateFn(node.id, { shape: v }));
  bind('input[name="borderColor"]', 'input', v => updateFn(node.id, { style: { borderColor: v } }));
  bind('input[name="fillColor"]', 'input', v => updateFn(node.id, { style: { fillColor: v } }));
  bind('input[name="fontSize"]', 'input', v => updateFn(node.id, { style: { fontSize: Number(v) } }));
  panelEl.querySelector('[name="btn-bold"]')?.addEventListener('click', () =>
    updateFn(node.id, { style: { fontWeight: node.style.fontWeight === 'bold' ? 'normal' : 'bold' } })
  );
  panelEl.querySelector('[name="btn-italic"]')?.addEventListener('click', () =>
    updateFn(node.id, { style: { fontStyle: node.style.fontStyle === 'italic' ? 'normal' : 'italic' } })
  );
}

// ── Default node style panel ──────────────────────────────────────────────────

function renderDefaultPanel(defaults, updateFn) {
  panelEl.innerHTML = `
    <h3 style="${H3}">Default Node Style</h3>
    <p style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Applied to newly created nodes.</p>
    ${field('Shape', selectEl('shape', defaults.shape, [['none', 'None'], ['box', 'Box'], ['circle', 'Circle'], ['diamond', 'Diamond']]))}
    ${field('Border Color', colorEl('borderColor', defaults.style.borderColor))}
    ${field('Fill Color',   colorEl('fillColor',   defaults.style.fillColor))}
    ${field('Font Size',    numberEl('fontSize',   defaults.style.fontSize, 8, 36))}
    ${field('Style', boldItalicBtns(defaults.style.fontWeight, defaults.style.fontStyle))}
  `;
  bind('select[name="shape"]',      'change', v => updateFn('defaults', { shape: v }));
  bind('input[name="borderColor"]', 'input',  v => updateFn('defaults', { style: { borderColor: v } }));
  bind('input[name="fillColor"]',   'input',  v => updateFn('defaults', { style: { fillColor: v } }));
  bind('input[name="fontSize"]',    'input',  v => updateFn('defaults', { style: { fontSize: Number(v) } }));
  panelEl.querySelector('[name="btn-bold"]')?.addEventListener('click', () =>
    updateFn('defaults', { style: { fontWeight: defaults.style.fontWeight === 'bold' ? 'normal' : 'bold' } })
  );
  panelEl.querySelector('[name="btn-italic"]')?.addEventListener('click', () =>
    updateFn('defaults', { style: { fontStyle: defaults.style.fontStyle === 'italic' ? 'normal' : 'italic' } })
  );
}

// ── Multi-node panel ──────────────────────────────────────────────────────────

function renderMultiPanel(nodes, updateFn) {
  const ids = nodes.map(n => n.id);
  const allBold = nodes.length > 0 && nodes.every(n => n.style?.fontWeight === 'bold');
  const allItal = nodes.length > 0 && nodes.every(n => n.style?.fontStyle === 'italic');
  panelEl.innerHTML = `
    <h3 style="${H3}">${nodes.length} Nodes Selected</h3>
    ${field('Shape', selectEl('shape', '', [['', '(No change)'], ['none', 'None'], ['box', 'Box'], ['circle', 'Circle'], ['diamond', 'Diamond']]))}
    ${field('Border Color', colorEl('borderColor', '#333333'))}
    ${field('Fill Color', colorEl('fillColor', '#ffffff'))}
    ${field('Font Size', `
      <div style="display:flex;gap:6px;align-items:center;">
        ${numberEl('fontSize', '', 8, 36)}
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;white-space:nowrap;cursor:pointer;">
          <input type="checkbox" name="auto-scale-pos" style="cursor:pointer;"> Auto-adjust
        </label>
      </div>`)}
    ${field('Style', boldItalicBtns(allBold ? 'bold' : 'normal', allItal ? 'italic' : 'normal'))}
  `;
  bind('select[name="shape"]', 'change', v => { if (v) updateFn(ids, { shape: v }); });
  bind('input[name="borderColor"]', 'input', v => updateFn(ids, { style: { borderColor: v } }));
  bind('input[name="fillColor"]', 'input', v => updateFn(ids, { style: { fillColor: v } }));
  bind('input[name="fontSize"]', 'input', v => {
    if (!v) return;
    const autoScale = panelEl.querySelector('input[name="auto-scale-pos"]')?.checked ?? false;
    updateFn(ids, { style: { fontSize: Number(v) }, _scalePositions: autoScale });
  });
  panelEl.querySelector('[name="btn-bold"]')?.addEventListener('click', () =>
    updateFn(ids, { style: { fontWeight: allBold ? 'normal' : 'bold' } })
  );
  panelEl.querySelector('[name="btn-italic"]')?.addEventListener('click', () =>
    updateFn(ids, { style: { fontStyle: allItal ? 'normal' : 'italic' } })
  );
}

// ── Multi-edge panel ─────────────────────────────────────────────────────────

function renderMultiEdgePanel(edges, updateFn) {
  const ids = edges.map(e => e.id);
  const annotItems = edges.flatMap(e => e.annotations?.items ?? []);
  const allBold = annotItems.length > 0 && annotItems.every(it => it.fontWeight === 'bold');
  const allItal = annotItems.length > 0 && annotItems.every(it => it.fontStyle === 'italic');
  const allHaveCoil = edges.length > 0 && edges.every(e => e.annotations?.coil);
  const SEP = `<div style="margin:10px 0 6px;border-top:1px solid #e2e8f0;padding-top:10px;">
    <span style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;">`;
  panelEl.innerHTML = `
    <h3 style="${H3}">${edges.length} Edges Selected</h3>
    ${field('Routing', radioGroup('routing', '', [['orthogonal', 'Orthogonal'], ['diagonal', 'Diagonal']]))}
    ${field('Line Type', radioGroup('lineType', '', [['normal', 'Solid'], ['dashed', 'Dashed']]))}
    ${field('Thickness', numberEl('thickness', '', 1, 6))}
    ${field('Head Size', numberEl('headSize', '', 4, 20))}
    ${SEP}Coil Arrow</span></div>
    ${field('Enable', checkboxEl('multi-coil', allHaveCoil))}
    ${field('Side', radioGroup('multi-coilSide', '', [['above', 'Above (Left)'], ['below', 'Below (Right)']]))}
    ${field('Thickness', numberEl('multi-coilThickness', '', 0.5, 6, 0.5))}
    ${field('Head Size', numberEl('multi-coilHeadSize', '', 2, 20))}
    ${field('Diameter', numberEl('multi-coilRadius', '', 5, 40))}
    ${field('Gap', numberEl('multi-coilGap', '', 0, 60))}
    ${annotItems.length > 0 ? `
      <div style="margin:10px 0 6px;border-top:1px solid #e2e8f0;padding-top:10px;">
        <span style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;">Annotation Style</span>
      </div>
      ${field('Font Size', `
        <div style="display:flex;gap:6px;align-items:center;">
          ${numberEl('annot-fontSize', '', 8, 36)}
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;white-space:nowrap;cursor:pointer;">
            <input type="checkbox" name="annot-auto-scale" style="cursor:pointer;"> Auto-adjust
          </label>
        </div>`)}
      ${field('Style', boldItalicBtns(allBold ? 'bold' : 'normal', allItal ? 'italic' : 'normal'))}
      ${field('Show Arrow', selectEl('annot-showArrow', '', [['', '(No change)'], ['true', 'Show'], ['false', 'Hide']]))}
      ${field('Arrow Color', colorEl('annot-arrowColor', '#555555'))}
      ${field('Arrow Thickness', numberEl('annot-arrowThickness', '', 0.5, 6, 0.5))}
      ${field('Arrow Head', numberEl('annot-arrowHeadSize', '', 2, 20))}
      ${field('Arrow Gap', numberEl('annot-arrowGap', '', 0, 40))}
      ${field('Edge Gap',  numberEl('annot-edgeGap',  '', 2, 120))}
    ` : ''}
  `;
  bindRadio('routing', v => updateFn(ids, { routing: v }));
  bindRadio('lineType', v => updateFn(ids, { arrowStyle: { type: v } }));
  bind('input[name="thickness"]', 'input', v => { if (v) updateFn(ids, { arrowStyle: { thickness: Number(v) } }); });
  bind('input[name="headSize"]', 'input', v => { if (v) updateFn(ids, { arrowStyle: { headSize: Number(v) } }); });
  bind('input[name="multi-coil"]', 'change', v => updateFn(ids, { annotations: { coil: v === 'true' } }), true);
  bindRadio('multi-coilSide', v => updateFn(ids, { annotations: { coilSide: v } }));
  bind('input[name="multi-coilThickness"]', 'input', v => { if (v) updateFn(ids, { annotations: { coilStyle: { thickness: Number(v) } } }); });
  bind('input[name="multi-coilHeadSize"]', 'input', v => { if (v) updateFn(ids, { annotations: { coilStyle: { headSize: Number(v) } } }); });
  bind('input[name="multi-coilRadius"]', 'input', v => { if (v) updateFn(ids, { annotations: { coilStyle: { radius: Number(v) } } }); });
  bind('input[name="multi-coilGap"]', 'input', v => { if (v) updateFn(ids, { annotations: { coilStyle: { gap: Number(v) } } }); });
  if (annotItems.length > 0) {
    bind('input[name="annot-fontSize"]', 'input', v => { if (v) updateFn(ids, { _annotStyle: { fontSize: Number(v) } }); });
    panelEl.querySelector('[name="btn-bold"]')?.addEventListener('click', () =>
      updateFn(ids, { _annotStyle: { fontWeight: allBold ? 'normal' : 'bold' } })
    );
    panelEl.querySelector('[name="btn-italic"]')?.addEventListener('click', () =>
      updateFn(ids, { _annotStyle: { fontStyle: allItal ? 'normal' : 'italic' } })
    );
    bind('select[name="annot-showArrow"]',      'change', v => { if (v !== '') updateFn(ids, { _annotStyle: { showArrow: v === 'true' } }); });
    bind('input[name="annot-arrowColor"]',      'input',  v => updateFn(ids, { _annotStyle: { arrowColor: v } }));
    bind('input[name="annot-arrowThickness"]',  'input',  v => { if (v) updateFn(ids, { _annotStyle: { arrowThickness: Number(v) } }); });
    bind('input[name="annot-arrowHeadSize"]',   'input',  v => { if (v) updateFn(ids, { _annotStyle: { arrowHeadSize: Number(v) } }); });
    bind('input[name="annot-arrowGap"]',        'input',  v => { if (v !== '') updateFn(ids, { _annotStyle: { arrowGap: Number(v) } }); });
    bind('input[name="annot-edgeGap"]',         'input',  v => { if (v) updateFn(ids, { _annotNormalize: { edgeGap: Number(v) } }); });
  }
}

// ── Annotation panel ──────────────────────────────────────────────────────────

function renderAnnotPanel(item, updateFn, tStep) {
  const itemStep = (item.snap ?? true) ? tStep : 0.01;
  panelEl.innerHTML = `
    <h3 style="${H3}">Annotation Properties</h3>
    ${field('Label', textarea('a-label', item.label, 3) + scriptBtns())}
    ${field('Side', radioGroup('a-side', item.side, [['above', 'Above (Left)'], ['below', 'Below (Right)']]))}
    ${field('Position t', rangeEl('a-t', item.t, itemStep))}
    ${field('Snap t', checkboxEl('a-snap', item.snap ?? true))}
    ${field('Shape', selectEl('a-shape', item.shape, [['none', 'None'], ['box', 'Box']]))}
    ${field('Distance', numberEl('a-dist', item.dist ?? 40, 10, 200))}
    ${field('Show Arrow',       checkboxEl('a-arrow',         item.showArrow      ?? true))}
    ${field('Arrow Gap',        numberEl('a-gap',             item.arrowGap       ?? 2, 0, 40))}
    ${field('Arrow Color',      colorEl('a-arrowColor',       item.arrowColor     ?? '#555555'))}
    ${field('Arrow Thickness',  numberEl('a-arrowThickness',  item.arrowThickness ?? 1.5, 0.5, 6, 0.5))}
    ${field('Arrow Head',       numberEl('a-arrowHeadSize',   item.arrowHeadSize  ?? 6, 2, 20))}
    ${field('Font Size', `
      <div style="display:flex;gap:6px;align-items:center;">
        ${numberEl('a-fontSize', item.fontSize ?? 12, 6, 36)}
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;white-space:nowrap;cursor:pointer;">
          <input type="checkbox" name="annot-auto-scale" style="cursor:pointer;"> Auto-adjust
        </label>
      </div>`)}
    ${field('Text Color',  colorEl('a-color', item.color ?? '#444444'))}
    ${field('Style', boldItalicBtns(item.fontWeight, item.fontStyle))}
  `;
  const labelEl = panelEl.querySelector('textarea[name="a-label"]');
  if (labelEl) labelEl.addEventListener('input', () => updateFn(item.id, { label: labelEl.value }));
  wireScriptBtns(labelEl, v => updateFn(item.id, { label: v }));
  bind('input[name="a-fontSize"]', 'input', v => { if (v) updateFn(item.id, { fontSize: Number(v) }); });
  panelEl.querySelector('[name="btn-bold"]')?.addEventListener('click', () =>
    updateFn(item.id, { fontWeight: item.fontWeight === 'bold' ? 'normal' : 'bold' })
  );
  panelEl.querySelector('[name="btn-italic"]')?.addEventListener('click', () =>
    updateFn(item.id, { fontStyle: item.fontStyle === 'italic' ? 'normal' : 'italic' })
  );
  bindRadio('a-side', v => updateFn(item.id, { side: v }));
  const tEl = panelEl.querySelector('input[name="a-t"]');
  if (tEl) {
    const tSpan = tEl.nextElementSibling;
    tEl.addEventListener('input', () => {
      if (tSpan) tSpan.textContent = Number(tEl.value).toFixed(2);
      updateFn(item.id, { t: Number(tEl.value) });
    });
  }
  bind('input[name="a-snap"]', 'change', v => updateFn(item.id, { snap: v === 'true' }), true);
  bind('select[name="a-shape"]', 'change', v => updateFn(item.id, { shape: v }));
  bind('input[name="a-dist"]', 'input', v => updateFn(item.id, { dist: Number(v) }));
  bind('input[name="a-arrow"]',         'change', v => updateFn(item.id, { showArrow:      v === 'true' }), true);
  bind('input[name="a-gap"]',           'input',  v => updateFn(item.id, { arrowGap:       Number(v) }));
  bind('input[name="a-arrowColor"]',    'input',  v => updateFn(item.id, { arrowColor:     v }));
  bind('input[name="a-arrowThickness"]','input',  v => { if (v) updateFn(item.id, { arrowThickness: Number(v) }); });
  bind('input[name="a-arrowHeadSize"]', 'input',  v => { if (v) updateFn(item.id, { arrowHeadSize:  Number(v) }); });
  bind('input[name="a-color"]',         'input',  v => updateFn(item.id, { color: v }));
}

// ── Edge panel ────────────────────────────────────────────────────────────────

function renderEdgePanel(edge, updateFn, tStep, defaults = null) {
  const items = edge.annotations.items ?? [];

  panelEl.innerHTML = `
    <h3 style="${H3}">Edge Properties</h3>

    ${field('Coil Arrow (Reflux/Stir)', checkboxEl('coil', edge.annotations.coil))}
    ${edge.annotations.coil ? `
      ${field('Position t', rangeEl('coilT', edge.annotations.coilT ?? 0.5, tStep))}
      ${field('Side', radioGroup('coilSide', edge.annotations.coilSide ?? 'above', [['above', 'Above (Left)'], ['below', 'Below (Right)']]))}
      ${field('Line Thickness', numberEl('coilThickness', edge.annotations.coilStyle?.thickness ?? 1.5, 0.5, 6, 0.5))}
      ${field('Head Size', numberEl('coilHeadSize', edge.annotations.coilStyle?.headSize ?? 5, 2, 20))}
      ${field('Coil Diameter', numberEl('coilRadius', edge.annotations.coilStyle?.radius ?? 10, 5, 40))}
      ${field('Distance from Edge', numberEl('coilGap', edge.annotations.coilStyle?.gap ?? 12, 0, 60))}
    ` : ''}
    ${field('Routing', radioGroup('routing', edge.routing, [['orthogonal', 'Orthogonal'], ['diagonal', 'Diagonal']]))}
    ${field('Line Type', radioGroup('lineType', edge.arrowStyle.type, [['normal', 'Solid'], ['dashed', 'Dashed']]))}
    ${field('Thickness', numberEl('thickness', edge.arrowStyle.thickness, 1, 6))}
    ${field('Head Size', numberEl('headSize', edge.arrowStyle.headSize, 4, 20))}

    <div style="margin:14px 0 6px;border-top:1px solid #e2e8f0;padding-top:12px;">
      <h4 style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">Vertical Annotations</h4>
      ${items.length >= 2 ? `
      <div id="annot-batch" style="border:1px solid #bfdbfe;border-radius:6px;padding:8px;margin-bottom:12px;background:#f8fafc;">
        <div style="font-size:11px;font-weight:600;color:#2563eb;letter-spacing:.04em;margin-bottom:8px;">Apply to All</div>
        ${field('Show Arrow',      selectEl('batch-showArrow',     '', [['', '(No change)'], ['true', 'Show'], ['false', 'Hide']]))}
        ${field('Arrow Color',     colorEl('batch-arrowColor',     '#555555'))}
        ${field('Arrow Thickness', numberEl('batch-arrowThickness','', 0.5, 6, 0.5))}
        ${field('Arrow Head',      numberEl('batch-arrowHeadSize', '', 2, 20))}
        ${field('Arrow Gap',       numberEl('batch-arrowGap',      '', 0, 40))}
        ${field('Font Size',       numberEl('batch-fontSize',      '', 8, 36))}
        ${field('Edge Gap', numberEl('batch-edgeGap', '', 2, 120))}
      </div>` : ''}
      <div id="annot-list">${items.map((it, i) => annotItemHTML(it, i, tStep)).join('')}</div>
      <button id="btn-add-annot" style="${BTN_STYLE}margin-top:6px;width:100%;">+ Add Annotation</button>
    </div>
  `;

  // Coil checkbox
  bind('input[name="coil"]', 'change', v => updateFn(edge.id, { annotations: { coil: v === 'true' } }), true);
  if (edge.annotations.coil) {
    const coilTEl = panelEl.querySelector('input[name="coilT"]');
    if (coilTEl) {
      const coilTSpan = coilTEl.nextElementSibling;
      coilTEl.addEventListener('input', () => {
        if (coilTSpan) coilTSpan.textContent = Number(coilTEl.value).toFixed(2);
        updateFn(edge.id, { annotations: { coilT: Number(coilTEl.value) } });
      });
    }
    bindRadio('coilSide', v => updateFn(edge.id, { annotations: { coilSide: v } }));
    bind('input[name="coilThickness"]', 'input', v => updateFn(edge.id, { annotations: { coilStyle: { thickness: Number(v) } } }));
    bind('input[name="coilHeadSize"]', 'input', v => updateFn(edge.id, { annotations: { coilStyle: { headSize: Number(v) } } }));
    bind('input[name="coilRadius"]', 'input', v => updateFn(edge.id, { annotations: { coilStyle: { radius: Number(v) } } }));
    bind('input[name="coilGap"]', 'input', v => updateFn(edge.id, { annotations: { coilStyle: { gap: Number(v) } } }));
  }

  bindRadio('routing', v => updateFn(edge.id, { routing: v }));
  bindRadio('lineType', v => updateFn(edge.id, { arrowStyle: { type: v } }));
  bind('input[name="thickness"]', 'input', v => updateFn(edge.id, { arrowStyle: { thickness: Number(v) } }));
  bind('input[name="headSize"]', 'input', v => updateFn(edge.id, { arrowStyle: { headSize: Number(v) } }));

  wireAnnotItems(edge, updateFn);

  if (items.length >= 2) {
    const batchFn = patch => updateFn(edge.id, { _annotStyle: patch });
    bind('select[name="batch-showArrow"]',     'change', v => { if (v !== '') batchFn({ showArrow: v === 'true' }); });
    bind('input[name="batch-arrowColor"]',     'input',  v => batchFn({ arrowColor: v }));
    bind('input[name="batch-arrowThickness"]', 'input',  v => { if (v) batchFn({ arrowThickness: Number(v) }); });
    bind('input[name="batch-arrowHeadSize"]',  'input',  v => { if (v) batchFn({ arrowHeadSize: Number(v) }); });
    bind('input[name="batch-arrowGap"]',       'input',  v => { if (v !== '') batchFn({ arrowGap: Number(v) }); });
    bind('input[name="batch-fontSize"]',       'input',  v => { if (v) batchFn({ fontSize: Number(v) }); });
    bind('input[name="batch-edgeGap"]',        'input',  v => { if (v) updateFn(edge.id, { _annotNormalize: { edgeGap: Number(v) } }); });
  }

  document.getElementById('btn-add-annot').addEventListener('click', () => {
    const newItem = {
      id: uid(), side: 'above', t: 0.5, label: '', dist: 40, showArrow: true, snap: true, arrowGap: 2,
      shape:      defaults?.shape              ?? 'none',
      fontSize:   defaults?.style?.fontSize    ?? 12,
      fontWeight: defaults?.style?.fontWeight  ?? 'normal',
      fontStyle:  defaults?.style?.fontStyle   ?? 'normal',
      color:      defaults?.style?.borderColor ?? '#444444',
    };
    updateFn(edge.id, { annotations: { items: [...items, newItem] } });
  });
}

function annotItemHTML(item, idx, tStep) {
  const itemStep = (item.snap ?? true) ? tStep : 0.01;
  return `
  <div data-annot-id="${item.id}" style="border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <span style="font-size:11px;font-weight:600;color:#94a3b8;">Annotation ${idx + 1}</span>
      <button data-del-annot="${item.id}" style="font-size:11px;color:#dc2626;background:none;border:none;cursor:pointer;padding:2px 4px;">Delete</button>
    </div>
    ${field('Label', textarea(`annot-label-${item.id}`, item.label, 2) + scriptBtns())}
    ${field('Side', radioGroup(`annot-side-${item.id}`, item.side, [['above', 'Above (Left)'], ['below', 'Below (Right)']]))}
    ${field('Position t', rangeEl(`annot-t-${item.id}`, item.t, itemStep))}
    ${field('Snap t', checkboxEl(`annot-snap-${item.id}`, item.snap ?? true))}
    ${field('Shape', selectEl(`annot-shape-${item.id}`, item.shape, [['none', 'None'], ['box', 'Box']]))}
    ${field('Distance', numberEl(`annot-dist-${item.id}`, item.dist ?? 40, 10, 200))}
    ${field('Show Arrow',      checkboxEl(`annot-arrow-${item.id}`,         item.showArrow      ?? true))}
    ${field('Arrow Gap',       numberEl(`annot-gap-${item.id}`,             item.arrowGap       ?? 2, 0, 40))}
    ${field('Arrow Color',     colorEl(`annot-arrowColor-${item.id}`,       item.arrowColor     ?? '#555555'))}
    ${field('Arrow Thickness', numberEl(`annot-arrowThickness-${item.id}`,  item.arrowThickness ?? 1.5, 0.5, 6, 0.5))}
    ${field('Arrow Head',      numberEl(`annot-arrowHeadSize-${item.id}`,   item.arrowHeadSize  ?? 6, 2, 20))}
  </div>`;
}

function wireAnnotItems(edge, updateFn) {
  const getItems = () => [...(edge.annotations.items ?? [])];

  const updateItem = (id, patch) => {
    const items = getItems().map(it => it.id === id ? { ...it, ...patch } : it);
    updateFn(edge.id, { annotations: { items } });
  };

  for (const item of (edge.annotations.items ?? [])) {
    const id = item.id;

    const labelEl = panelEl.querySelector(`textarea[name="annot-label-${id}"]`);
    if (labelEl) {
      labelEl.addEventListener('input', () => updateItem(id, { label: labelEl.value }));
      wireScriptBtns(labelEl, v => updateItem(id, { label: v }));
    }

    panelEl.querySelectorAll(`input[name="annot-side-${id}"]`).forEach(el => {
      el.addEventListener('change', () => { if (el.checked) updateItem(id, { side: el.value }); });
    });

    const tEl = panelEl.querySelector(`input[name="annot-t-${id}"]`);
    if (tEl) {
      const tSpan = tEl.nextElementSibling;
      tEl.addEventListener('input', () => {
        if (tSpan) tSpan.textContent = Number(tEl.value).toFixed(2);
        updateItem(id, { t: Number(tEl.value) });
      });
    }

    const snapEl = panelEl.querySelector(`input[name="annot-snap-${id}"]`);
    if (snapEl) snapEl.addEventListener('change', () => updateItem(id, { snap: snapEl.checked }));

    const distEl = panelEl.querySelector(`input[name="annot-dist-${id}"]`);
    if (distEl) distEl.addEventListener('input', () => updateItem(id, { dist: Number(distEl.value) }));

    const shapeEl = panelEl.querySelector(`select[name="annot-shape-${id}"]`);
    if (shapeEl) shapeEl.addEventListener('change', () => updateItem(id, { shape: shapeEl.value }));

    const arrowEl = panelEl.querySelector(`input[name="annot-arrow-${id}"]`);
    if (arrowEl) arrowEl.addEventListener('change', () => updateItem(id, { showArrow: arrowEl.checked }));

    const gapEl = panelEl.querySelector(`input[name="annot-gap-${id}"]`);
    if (gapEl) gapEl.addEventListener('input', () => updateItem(id, { arrowGap: Number(gapEl.value) }));

    const arrowColorEl = panelEl.querySelector(`input[name="annot-arrowColor-${id}"]`);
    if (arrowColorEl) arrowColorEl.addEventListener('input', () => updateItem(id, { arrowColor: arrowColorEl.value }));

    const arrowThkEl = panelEl.querySelector(`input[name="annot-arrowThickness-${id}"]`);
    if (arrowThkEl) arrowThkEl.addEventListener('input', () => { if (arrowThkEl.value) updateItem(id, { arrowThickness: Number(arrowThkEl.value) }); });

    const arrowHdEl = panelEl.querySelector(`input[name="annot-arrowHeadSize-${id}"]`);
    if (arrowHdEl) arrowHdEl.addEventListener('input', () => { if (arrowHdEl.value) updateItem(id, { arrowHeadSize: Number(arrowHdEl.value) }); });

    const delBtn = panelEl.querySelector(`[data-del-annot="${id}"]`);
    if (delBtn) delBtn.addEventListener('click', () => {
      updateFn(edge.id, { annotations: { items: getItems().filter(it => it.id !== id) } });
    });
  }
}

// ── Element builders ──────────────────────────────────────────────────────────

const H3 = 'font-size:13px;font-weight:600;color:#334155;margin-bottom:12px;';
const BTN_STYLE = 'padding:5px 10px;font-size:12px;border:1px solid #e2e8f0;border-radius:5px;background:white;cursor:pointer;color:#334155;';
const INPUT_S = 'width:100%;padding:5px 7px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px;box-sizing:border-box;';
const LABEL_S = 'display:block;font-size:11px;color:#64748b;margin-bottom:3px;';

function field(label, control) {
  return `<div style="margin-bottom:9px;"><label style="${LABEL_S}">${label}</label>${control}</div>`;
}
function textarea(name, value, rows = 3) {
  return `<textarea name="${name}" rows="${rows}" style="${INPUT_S}resize:vertical;">${esc(value)}</textarea>`;
}
function selectEl(name, value, options) {
  const opts = options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('');
  return `<select name="${name}" style="${INPUT_S}">${opts}</select>`;
}
function colorEl(name, value) {
  return `<input type="color" name="${name}" value="${value}" style="width:100%;height:32px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;">`;
}
function numberEl(name, value, min, max, step = 1) {
  return `<input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" style="${INPUT_S}">`;
}
function checkboxEl(name, checked) {
  return `<input type="checkbox" name="${name}" value="true" ${checked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">`;
}
function radioGroup(name, value, options) {
  return options.map(([v, l]) =>
    `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:13px;cursor:pointer;">
      <input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}> ${l}
    </label>`
  ).join('');
}
function rangeEl(name, value, step) {
  const display = Number(value).toFixed(2);
  return `<div style="display:flex;align-items:center;gap:8px;">
    <input type="range" name="${name}" value="${value}" min="0" max="1" step="${step}" style="flex:1;">
    <span style="font-size:12px;color:#64748b;width:32px;text-align:right;">${display}</span>
  </div>`;
}

function boldItalicBtns(fw, fi) {
  const base = 'padding:2px 12px;font-size:14px;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;flex:1;';
  const on = 'background:#eff6ff;border-color:#2563eb;color:#2563eb;';
  const off = 'background:white;color:#334155;';
  return `<div style="display:flex;gap:4px;">
    <button name="btn-bold"   style="${base}${fw === 'bold' ? on : off}font-weight:bold;"  title="Bold (Ctrl+B)">B</button>
    <button name="btn-italic" style="${base}${fi === 'italic' ? on : off}font-style:italic;" title="Italic (Ctrl+I)">I</button>
  </div>`;
}

function scriptBtns() {
  const s = 'padding:2px 8px;font-size:12px;border:1px solid #e2e8f0;border-radius:4px;background:white;cursor:pointer;color:#334155;flex:1;';
  return `<div style="display:flex;gap:4px;margin-top:3px;">
    <button name="btn-sub" style="${s}" title="下付き文字 (0–9, +/-)">x<sub>n</sub></button>
    <button name="btn-sup" style="${s}" title="上付き文字 (0–9, +/-)">x<sup>n</sup></button>
  </div>`;
}

function applyScriptMap(ta, map, onUpdate) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (s === e) return;
  const val = ta.value;
  const conv = [...val.slice(s, e)].map(c => map[c] ?? c).join('');
  ta.value = val.slice(0, s) + conv + val.slice(e);
  ta.setSelectionRange(s, s + conv.length);
  onUpdate(ta.value);
}

function wireScriptBtns(ta, onUpdate) {
  if (!ta) return;
  const parent = ta.parentElement;
  parent?.querySelector('[name="btn-sub"]')?.addEventListener('mousedown', ev => { ev.preventDefault(); applyScriptMap(ta, SCRIPT_SUB, onUpdate); });
  parent?.querySelector('[name="btn-sup"]')?.addEventListener('mousedown', ev => { ev.preventDefault(); applyScriptMap(ta, SCRIPT_SUP, onUpdate); });
}

// ── Binding helpers ───────────────────────────────────────────────────────────

function bind(selector, event, fn, isChecked = false) {
  const el = panelEl.querySelector(selector);
  if (!el) return;
  el.addEventListener(event, () => fn(isChecked ? String(el.checked) : el.value));
}
function bindRadio(name, fn) {
  panelEl.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.addEventListener('change', () => { if (el.checked) fn(el.value); });
  });
}
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
