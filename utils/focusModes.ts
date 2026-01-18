import { Edge, FocusMode } from '../types';

const getEndpointId = (endpoint?: Edge['source'] | Edge['target']) => {
  if (!endpoint) return null;
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
};

const getEdgeEndpoints = (edge: Edge) => {
  const from = edge.from || getEndpointId(edge.source);
  const to = edge.to || getEndpointId(edge.target);
  if (!from || !to) return null;
  return { from, to };
};

const buildAdjacency = (edges: Edge[]) => {
  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  const undirected = new Map<string, string[]>();

  edges.forEach(edge => {
    const endpoints = getEdgeEndpoints(edge);
    if (!endpoints) return;
    const { from, to } = endpoints;

    if (!outMap.has(from)) outMap.set(from, []);
    outMap.get(from)!.push(to);

    if (!inMap.has(to)) inMap.set(to, []);
    inMap.get(to)!.push(from);

    if (!undirected.has(from)) undirected.set(from, []);
    if (!undirected.has(to)) undirected.set(to, []);
    undirected.get(from)!.push(to);
    undirected.get(to)!.push(from);
  });

  return { outMap, inMap, undirected };
};

const traverseDirected = (startId: string, adjacency: Map<string, string[]>) => {
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) || [];
    neighbors.forEach(next => {
      if (visited.has(next)) return;
      visited.add(next);
      queue.push(next);
    });
  }
  return visited;
};

const traverseKHop = (startId: string, adjacency: Map<string, string[]>, hopCount: number) => {
  const maxHops = Math.max(1, hopCount);
  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxHops) continue;
    const neighbors = adjacency.get(id) || [];
    neighbors.forEach(next => {
      if (visited.has(next)) return;
      visited.add(next);
      queue.push({ id: next, depth: depth + 1 });
    });
  }
  return visited;
};

export const getFocusNodeIds = (
  mode: FocusMode,
  startId: string | null | undefined,
  edges: Edge[],
  hopCount = 2
) => {
  if (!startId || mode === 'off') return null;
  const { outMap, inMap, undirected } = buildAdjacency(edges);

  if (mode === 'downstream') {
    return traverseDirected(startId, outMap);
  }
  if (mode === 'upstream') {
    return traverseDirected(startId, inMap);
  }
  if (mode === 'k-hop') {
    return traverseKHop(startId, undirected, hopCount);
  }

  const downstream = traverseDirected(startId, outMap);
  const upstream = traverseDirected(startId, inMap);
  upstream.forEach(nodeId => downstream.add(nodeId));
  return downstream;
};
