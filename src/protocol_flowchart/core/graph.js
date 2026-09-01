// DAG data model for protocol flowcharts.
// Zero dependencies — safe to import in any context.

export function createGraph(meta = {}) {
  return {
    nodes: [],
    edges: [],
    meta: {
      title: meta.title ?? '',
      defaultRouting: meta.defaultRouting ?? 'orthogonal',
      cellW: meta.cellW ?? 180,
      cellH: meta.cellH ?? 100,
      fontFamily: meta.fontFamily ?? 'sans-serif',
      nodePadding: meta.nodePadding ?? 8,
    },
  };
}

// ── Node CRUD ────────────────────────────────────────────────────────────────

export function addNode(graph, props = {}) {
  const node = {
    id: props.id ?? uid(),
    label: props.label ?? 'New Node',
    shape: props.shape ?? 'none',
    style: {
      borderColor: props.style?.borderColor ?? '#333333',
      fillColor:   props.style?.fillColor   ?? '#ffffff',
      fontSize:    props.style?.fontSize    ?? 14,
      fontWeight:  props.style?.fontWeight  ?? 'normal',
      fontStyle:   props.style?.fontStyle   ?? 'normal',
    },
    x: props.x ?? 0,
    y: props.y ?? 0,
  };
  graph.nodes.push(node);
  return node;
}

export function removeNode(graph, id) {
  graph.nodes = graph.nodes.filter(n => n.id !== id);
  graph.edges = graph.edges.filter(e => e.fromId !== id && e.toId !== id);
}

export function updateNode(graph, id, props) {
  const node = findNode(graph, id);
  if (!node) return;
  if (props.label    !== undefined) node.label    = props.label;
  if (props.shape    !== undefined) node.shape    = props.shape;
  if (props.x        !== undefined) node.x        = props.x;
  if (props.y        !== undefined) node.y        = props.y;
  if (props.style) {
    Object.assign(node.style, props.style);
  }
}

// ── Edge CRUD ────────────────────────────────────────────────────────────────

export function addEdge(graph, fromId, toId, props = {}) {
  if (!findNode(graph, fromId)) throw new Error(`Node not found: ${fromId}`);
  if (!findNode(graph, toId))   throw new Error(`Node not found: ${toId}`);
  if (fromId === toId)          throw new Error('Self-loop not allowed');

  const edge = {
    id: props.id ?? uid(),
    fromId,
    toId,
    annotations: {
      coil:      props.annotations?.coil      ?? false,
      coilT:     props.annotations?.coilT     ?? 0.5,
      coilSide:  props.annotations?.coilSide  ?? 'above',
      coilStyle: {
        thickness: props.annotations?.coilStyle?.thickness ?? 1.5,
        headSize:  props.annotations?.coilStyle?.headSize  ?? 5,
        radius:    props.annotations?.coilStyle?.radius    ?? 10,
        gap:       props.annotations?.coilStyle?.gap       ?? 12,
      },
      items: props.annotations?.items ? props.annotations.items.map(it => ({ ...it })) : [],
    },
    routing: props.routing ?? graph.meta.defaultRouting,
    arrowStyle: {
      type:      props.arrowStyle?.type      ?? 'normal',
      thickness: props.arrowStyle?.thickness ?? 2,
      headSize:  props.arrowStyle?.headSize  ?? 10,
      color:     props.arrowStyle?.color     ?? '#333333',
    },
  };

  // Temporarily add and check for cycles; roll back if found.
  graph.edges.push(edge);
  if (hasCycle(graph)) {
    graph.edges.pop();
    throw new Error(`Adding edge ${fromId}→${toId} would create a cycle`);
  }

  return edge;
}

export function removeEdge(graph, id) {
  graph.edges = graph.edges.filter(e => e.id !== id);
}

export function updateEdge(graph, id, props) {
  const edge = findEdge(graph, id);
  if (!edge) return;
  if (props.routing !== undefined) edge.routing = props.routing;
  if (props.annotations) {
    const { coilStyle, ...annotRest } = props.annotations;
    Object.assign(edge.annotations, annotRest);
    if (coilStyle) Object.assign(edge.annotations.coilStyle, coilStyle);
  }
  if (props.arrowStyle)  Object.assign(edge.arrowStyle,  props.arrowStyle);
}

// ── Graph algorithms ─────────────────────────────────────────────────────────

export function hasCycle(graph) {
  const visited = new Set();
  const stack   = new Set();

  function dfs(id) {
    if (stack.has(id))   return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const e of graph.edges) {
      if (e.fromId === id && dfs(e.toId)) return true;
    }
    stack.delete(id);
    return false;
  }

  return graph.nodes.some(n => dfs(n.id));
}

// Returns node ids in topological order (sources first).
// Throws if a cycle exists (should not happen if addEdge is used correctly).
export function topologicalSort(graph) {
  const inDegree = new Map(graph.nodes.map(n => [n.id, 0]));
  for (const e of graph.edges) {
    inDegree.set(e.toId, (inDegree.get(e.toId) ?? 0) + 1);
  }

  const queue  = graph.nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const result = [];

  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    for (const e of graph.edges) {
      if (e.fromId !== id) continue;
      const deg = inDegree.get(e.toId) - 1;
      inDegree.set(e.toId, deg);
      if (deg === 0) queue.push(e.toId);
    }
  }

  if (result.length !== graph.nodes.length) {
    throw new Error('Cycle detected during topological sort');
  }
  return result;
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export function findNode(graph, id) {
  return graph.nodes.find(n => n.id === id) ?? null;
}

export function findEdge(graph, id) {
  return graph.edges.find(e => e.id === id) ?? null;
}

export function edgesFrom(graph, nodeId) {
  return graph.edges.filter(e => e.fromId === nodeId);
}

export function edgesTo(graph, nodeId) {
  return graph.edges.filter(e => e.toId === nodeId);
}

// Returns all nodeIds and edgeIds in the weakly connected component containing startNodeId.
export function getComponent(graph, startNodeId) {
  const nodeIds = new Set();
  const edgeIds = new Set();
  const queue   = [startNodeId];
  while (queue.length) {
    const id = queue.shift();
    if (nodeIds.has(id)) continue;
    nodeIds.add(id);
    for (const e of graph.edges) {
      if (e.fromId !== id && e.toId !== id) continue;
      edgeIds.add(e.id);
      const neighbor = e.fromId === id ? e.toId : e.fromId;
      if (!nodeIds.has(neighbor)) queue.push(neighbor);
    }
  }
  return { nodeIds, edgeIds };
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function toJSON(graph) {
  return JSON.stringify(graph, null, 2);
}

export function fromJSON(json) {
  const g = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error('Invalid graph JSON');
  }
  // Migrate old above/below text annotations to items format
  for (const edge of g.edges) {
    const a = edge.annotations;
    if (!a) { edge.annotations = { coil: false, items: [] }; continue; }
    if (a.above !== undefined || a.below !== undefined) {
      const items = [];
      if (a.above) items.push({ id: uid(), side: 'above', t: 0.5, label: a.above, shape: 'none' });
      if (a.below) items.push({ id: uid(), side: 'below', t: 0.5, label: a.below, shape: 'none' });
      edge.annotations = { coil: a.coil ?? false, items };
    }
    if (!edge.annotations.items) edge.annotations.items = [];
  }
  return g;
}

// ── Internal ──────────────────────────────────────────────────────────────────

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
