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

const bundleClusterEdges = (nodes: Node[], edges: Edge[]): Edge[] => {
  const nodeIndex = new Map(nodes.map(node => [node.id, node]));
  const bundledEdges = new Map<string, Edge>();
  const passthroughEdges: Edge[] = [];

  edges.forEach(edge => {
    const source = nodeIndex.get(edge.from);
    const target = nodeIndex.get(edge.to);
    const sourceIsCluster = source?.kind === 'cluster';
    const targetIsCluster = target?.kind === 'cluster';
    if (!sourceIsCluster || !targetIsCluster) {
      passthroughEdges.push(edge);
      return;
    }
    const edgeType = edge.type || 'default';
    const key = `${edge.from}::${edge.to}::${edgeType}`;
    const existing = bundledEdges.get(key);
    if (!existing) {
      bundledEdges.set(key, { ...edge, weight: edge.weight || 1 });
      return;
    }
    existing.weight = (existing.weight || 0) + (edge.weight || 1);
  });

  return [...passthroughEdges, ...bundledEdges.values()];
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
  const baseEdges = baseGraph.edges.filter(edge => !expandedSet.has(edge.from) && !expandedSet.has(edge.to));
  const childEdges = childGraph.edges.filter(edge => childNodeIds.has(edge.from) && childNodeIds.has(edge.to));

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
}

export const useGraphLOD = ({
  baseData,
  lodData,
  zoomLevel,
  allowLod
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
      setExpandedClusters(new Set());
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

    if (childData && expandedClusters.size > 0 && lodLevel < 3) {
      nextGraph = applyClusterExpansions(activeData, childData, expandedClusters);
    }

    if (lodLevel <= 1) {
      nextGraph = {
        ...nextGraph,
        edges: bundleClusterEdges(nextGraph.nodes, nextGraph.edges)
      };
    }

    return attachTotalDegree(filterEdgesToNodes(nextGraph));
  }, [allowLod, baseData, expandedClusters, lodData, lodLevel]);

  return {
    graphData,
    lodLevel,
    expandedClusters,
    toggleCluster
  };
};
