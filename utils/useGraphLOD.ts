import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Edge, GraphData, GraphLODData, Node } from '../types';

const LOD_THRESHOLDS = [0.45, 0.9, 1.8];
const LOD_HYSTERESIS = 0.1;

type LodLevel = 0 | 1 | 2 | 3;

const nextLodLevel = (zoomLevel: number, current: LodLevel): LodLevel => {
  if (current === 0) {
    return zoomLevel > LOD_THRESHOLDS[0] + LOD_HYSTERESIS ? 1 : 0;
  }
  if (current === 1) {
    if (zoomLevel < LOD_THRESHOLDS[0] - LOD_HYSTERESIS) return 0;
    return zoomLevel > LOD_THRESHOLDS[1] + LOD_HYSTERESIS ? 2 : 1;
  }
  if (current === 2) {
    if (zoomLevel < LOD_THRESHOLDS[1] - LOD_HYSTERESIS) return 1;
    return zoomLevel > LOD_THRESHOLDS[2] + LOD_HYSTERESIS ? 3 : 2;
  }
  if (zoomLevel < LOD_THRESHOLDS[2] - LOD_HYSTERESIS) return 2;
  return 3;
};

const getLodData = (lodData: GraphLODData | null | undefined, level: LodLevel): GraphData | null => {
  if (!lodData) return null;
  if (level === 0) return lodData.lod0 || null;
  if (level === 1) return lodData.lod1 || null;
  if (level === 2) return lodData.lod2 || null;
  return lodData.lod3 || null;
};

const attachTotalDegree = (graph: GraphData): GraphData => {
  const totalDegreeMap = new Map<string, number>();
  graph.edges.forEach(edge => {
    if (edge.from) totalDegreeMap.set(edge.from, (totalDegreeMap.get(edge.from) || 0) + 1);
    if (edge.to) totalDegreeMap.set(edge.to, (totalDegreeMap.get(edge.to) || 0) + 1);
  });
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({
      ...node,
      totalDegree: totalDegreeMap.get(node.id) || 0
    }))
  };
};

const filterEdgesToNodes = (graph: GraphData): GraphData => {
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const filteredEdges = graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (filteredEdges.length === graph.edges.length) return graph;
  if (import.meta.env.DEV) {
    const dropped = graph.edges.length - filteredEdges.length;
    console.warn(`[graph] Dropped ${dropped} edges with missing node references.`);
  }
  return { ...graph, edges: filteredEdges };
};

const aggregateClusterEdges = (nodes: Node[], edges: Edge[]): Edge[] => {
  const nodeIndex = new Map(nodes.map(node => [node.id, node]));
  const bundledEdges = new Map<string, Edge>();
  const bundledMembers = new Map<string, Array<{ from: string; to: string; type?: string }>>();
  const bundledCounts = new Map<string, number>();
  const passthroughEdges: Edge[] = [];
  const MAX_EDGE_SAMPLE = 12;

  edges.forEach(edge => {
    const source = nodeIndex.get(edge.from);
    const target = nodeIndex.get(edge.to);
    const sourceClusterId = source?.cluster_id || source?.id;
    const targetClusterId = target?.cluster_id || target?.id;
    if (!sourceClusterId || !targetClusterId) {
      passthroughEdges.push(edge);
      return;
    }
    const sameCluster = sourceClusterId === targetClusterId;
    const sourceClusterNode = nodeIndex.get(sourceClusterId);
    const targetClusterNode = nodeIndex.get(targetClusterId);

    if (sameCluster && (source?.kind !== 'cluster' || target?.kind !== 'cluster')) {
      passthroughEdges.push(edge);
      return;
    }

    if (!sourceClusterNode || !targetClusterNode) {
      passthroughEdges.push(edge);
      return;
    }

    if (sameCluster) return;

    const edgeType = edge.type || 'default';
    const key = `${sourceClusterId}::${targetClusterId}::${edgeType}`;
    const existing = bundledEdges.get(key);
    if (!existing) {
      const members = [{ from: edge.from, to: edge.to, type: edge.type }];
      bundledMembers.set(key, members);
      bundledCounts.set(key, 1);
      bundledEdges.set(key, {
        ...edge,
        from: sourceClusterId,
        to: targetClusterId,
        weight: edge.weight || 1,
        aggregated: true,
        memberCount: 1,
        members
      });
      return;
    }
    const members = bundledMembers.get(key);
    if (members && members.length < MAX_EDGE_SAMPLE) {
      members.push({ from: edge.from, to: edge.to, type: edge.type });
    }
    const count = (bundledCounts.get(key) || 1) + 1;
    bundledCounts.set(key, count);
    existing.weight = (existing.weight || 0) + (edge.weight || 1);
    existing.aggregated = true;
    existing.memberCount = count;
    if (members) existing.members = members;
  });

  return [...passthroughEdges, ...bundledEdges.values()];
};

const applyBackboneEdgeDensity = (nodes: Node[], edges: Edge[], density = 1) => {
  const clampedDensity = Math.max(0, Math.min(1, density));
  if (clampedDensity >= 0.98) return edges;
  if (edges.length === 0) return edges;
  const nodeIndex = new Map(nodes.map(node => [node.id, node]));
  const backboneEdges: Edge[] = [];
  const passthroughEdges: Edge[] = [];

  edges.forEach(edge => {
    const source = nodeIndex.get(edge.from);
    const target = nodeIndex.get(edge.to);
    const isClusterEdge = (source?.kind === 'cluster' || source?.cluster_id)
      && (target?.kind === 'cluster' || target?.cluster_id);
    if (isClusterEdge) {
      backboneEdges.push(edge);
    } else {
      passthroughEdges.push(edge);
    }
  });

  if (!backboneEdges.length) return edges;
  if (clampedDensity <= 0) return passthroughEdges;

  const sorted = backboneEdges
    .slice()
    .sort((a, b) => (b.weight || 1) - (a.weight || 1));
  const keepCount = Math.max(1, Math.round(sorted.length * clampedDensity));
  return [...passthroughEdges, ...sorted.slice(0, keepCount)];
};

const applyClusterExpansions = (
  baseGraph: GraphData,
  childGraph: GraphData,
  expandedClusters: Set<string>,
): GraphData => {
  if (!expandedClusters.size) return baseGraph;

  const expandedList = Array.from(expandedClusters);
  const expandedSet = new Set(expandedList);

  const childNodes = childGraph.nodes.filter(node => {
    if (!node.cluster_path) return false;
    return expandedList.some(clusterId => node.cluster_path?.includes(clusterId));
  });
  const childNodeIds = new Set(childNodes.map(node => node.id));

  const baseNodes = baseGraph.nodes.filter(node => {
    const clusterId = node.cluster_id || node.id;
    return !expandedSet.has(clusterId);
  });
  const baseNodeIds = new Set(baseNodes.map(node => node.id));
  const mergedNodeIds = new Set([...baseNodeIds, ...childNodeIds]);
  const baseEdges = baseGraph.edges.filter(edge => baseNodeIds.has(edge.from) && baseNodeIds.has(edge.to));
  const childEdges = childGraph.edges.filter(edge => {
    const fromInChild = childNodeIds.has(edge.from);
    const toInChild = childNodeIds.has(edge.to);
    if (!fromInChild && !toInChild) return false;
    return mergedNodeIds.has(edge.from) && mergedNodeIds.has(edge.to);
  });

  const mergedNodeMap = new Map<string, Node>();
  baseNodes.forEach(node => mergedNodeMap.set(node.id, node));
  childNodes.forEach(node => mergedNodeMap.set(node.id, node));

  return {
    ...baseGraph,
    nodes: Array.from(mergedNodeMap.values()),
    edges: [...baseEdges, ...childEdges]
  };
};

interface UseGraphLODOptions {
  baseData: GraphData;
  lodData?: GraphLODData | null;
  zoomLevel: number;
  allowLod: boolean;
  focusClusterId?: string | null;
  backboneEdgeDensity?: number;
}

export const useGraphLOD = ({
  baseData,
  lodData,
  zoomLevel,
  allowLod,
  focusClusterId,
  backboneEdgeDensity = 1
}: UseGraphLODOptions) => {
  const [lodLevel, setLodLevel] = useState<LodLevel>(2);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const lodLevelRef = useRef<LodLevel>(lodLevel);

  useEffect(() => {
    if (!allowLod) {
      setLodLevel(3);
      lodLevelRef.current = 3;
      setExpandedClusters(new Set());
      return;
    }
    const next = nextLodLevel(zoomLevel, lodLevelRef.current);
    if (next !== lodLevelRef.current) {
      lodLevelRef.current = next;
      setLodLevel(next);
    }
  }, [allowLod, zoomLevel]);

  const toggleCluster = useCallback((clusterId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  }, []);

  const graphData = useMemo(() => {
    if (!allowLod) {
      return attachTotalDegree(filterEdgesToNodes(baseData));
    }

    const activeData = getLodData(lodData, lodLevel) || baseData;
    const childData = getLodData(lodData, Math.min(lodLevel + 1, 3) as LodLevel);
    let nextGraph = activeData;
    const activeClusterIds = new Set(
      activeData.nodes
        .filter(node => node.kind === 'cluster')
        .map(node => node.cluster_id || node.id)
    );
    const patchClusters = new Set<string>();
    expandedClusters.forEach(clusterId => {
      if (activeClusterIds.has(clusterId)) patchClusters.add(clusterId);
    });
    if (focusClusterId && activeClusterIds.has(focusClusterId)) {
      patchClusters.add(focusClusterId);
    }

    if (childData && patchClusters.size > 0 && lodLevel < 3) {
      nextGraph = applyClusterExpansions(activeData, childData, patchClusters);
    }

    if (lodLevel <= 1) {
      nextGraph = {
        ...nextGraph,
        edges: aggregateClusterEdges(nextGraph.nodes, nextGraph.edges)
      };
      nextGraph = {
        ...nextGraph,
        edges: applyBackboneEdgeDensity(nextGraph.nodes, nextGraph.edges, backboneEdgeDensity)
      };
    }

    return attachTotalDegree(filterEdgesToNodes(nextGraph));
  }, [allowLod, baseData, expandedClusters, focusClusterId, lodData, lodLevel, backboneEdgeDensity]);

  return {
    graphData,
    lodLevel,
    expandedClusters,
    toggleCluster
  };
};
