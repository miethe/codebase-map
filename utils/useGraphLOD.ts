import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLUSTER_KINDS, Edge, ExpandDepthMode, GraphData, GraphLODData, LodMode, Node } from '../types';

const LOD_THRESHOLDS = [0.45, 0.9, 1.8, 3.0];
const LOD_HYSTERESIS = 0.1;

type LodLevel = 0 | 1 | 2 | 3 | 4;

const getNodeDepth = (node: Node): number => {
  if (typeof node.lodDepth === 'number') return Math.max(0, Math.round(node.lodDepth));
  if (node.cluster_path?.length) return Math.max(0, node.cluster_path.length - 1);
  return 0;
};

const getClusterId = (node: Node) => node.cluster_id || node.id;

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
  if (current === 3) {
    if (zoomLevel < LOD_THRESHOLDS[2] - LOD_HYSTERESIS) return 2;
    return zoomLevel > LOD_THRESHOLDS[3] + LOD_HYSTERESIS ? 4 : 3;
  }
  // Level 4
  if (zoomLevel < LOD_THRESHOLDS[3] - LOD_HYSTERESIS) return 3;
  return 4;
};

const getLodLevelForZoom = (zoomLevel: number): LodLevel => {
  if (zoomLevel < LOD_THRESHOLDS[0]) return 0;
  if (zoomLevel < LOD_THRESHOLDS[1]) return 1;
  if (zoomLevel < LOD_THRESHOLDS[2]) return 2;
  if (zoomLevel < LOD_THRESHOLDS[3]) return 3;
  return 4;
};

const getLodData = (lodData: GraphLODData | null | undefined, level: LodLevel): GraphData | null => {
  if (!lodData) return null;
  if (level === 0) return lodData.lod0 || null;
  if (level === 1) return lodData.lod1 || null;
  if (level === 2) return lodData.lod2 || null;
  if (level === 3) return lodData.lod3 || null;
  return lodData.lod4 || null; // Requires GraphLODData update in types.ts too? Yes.
};

const getManualBaseLevel = (lodData: GraphLODData | null | undefined): LodLevel => {
  if (lodData?.lod0) return 0;
  if (lodData?.lod1) return 1;
  if (lodData?.lod2) return 2;
  if (lodData?.lod3) return 3;
  return 4;
};

const getClusterLevel = (node: Node): LodLevel | null => {
  // Heuristic based on node types or paths
  if (node.type === 'package') return 0;
  if (node.type === 'module') return 1;
  if (node.kind === 'folder') return 2; // Explicit kind check
  if (node.type === 'file') return 3;

  if (!node.cluster_path || !node.cluster_path.length) return null;
  const last = node.cluster_path[node.cluster_path.length - 1] || '';
  if (last.startsWith('package:')) return 0;
  if (last.startsWith('module:')) return 1;
  if (last.startsWith('folder:')) return 2;
  if (last.startsWith('file:')) return 3;
  return null;
};

const getLodLevelForNode = (node: Node): LodLevel | null => {
  const explicit = getClusterLevel(node);
  if (explicit !== null) return explicit;
  const depth = getNodeDepth(node);
  if (depth <= 0) return null;
  const inferred = Math.min(4, Math.max(0, depth - 1));
  return inferred as LodLevel;
};

const buildDescendantDepthMap = (graphs: Array<GraphData | null | undefined>) => {
  const map = new Map<string, number>();
  graphs.forEach(graph => {
    if (!graph) return;
    graph.nodes.forEach(node => {
      const path = node.cluster_path;
      if (!path || path.length < 2) return;
      const nodeDepth = getNodeDepth(node);
      path.forEach((clusterId, index) => {
        if (nodeDepth <= index) return;
        const existing = map.get(clusterId);
        if (existing === undefined || nodeDepth < existing) {
          map.set(clusterId, nodeDepth);
        }
      });
    });
  });
  return map;
};

const findChildLevel = (
  clusterId: string,
  startLevel: LodLevel,
  lodData: GraphLODData | null | undefined
): LodLevel | null => {
  for (let level = (startLevel + 1) as number; level <= 4; level += 1) {
    const data = getLodData(lodData, level as LodLevel);
    if (!data) continue;
    const hasChildren = data.nodes.some(node => node.cluster_path?.includes(clusterId));
    if (hasChildren) return level as LodLevel;
  }
  return null;
};

const findDeepestChildLevel = (
  clusterId: string,
  startLevel: LodLevel,
  lodData: GraphLODData | null | undefined
): LodLevel | null => {
  let deepest: LodLevel | null = null;
  for (let level = (startLevel + 1) as number; level <= 4; level += 1) {
    const data = getLodData(lodData, level as LodLevel);
    if (!data) continue;
    const hasChildren = data.nodes.some(node => node.cluster_path?.includes(clusterId));
    if (hasChildren) deepest = level as LodLevel;
  }
  return deepest;
};

const resolveChildLevel = (
  clusterId: string,
  startLevel: LodLevel,
  lodData: GraphLODData | null | undefined,
  expandDepthMode: ExpandDepthMode
) => (
  expandDepthMode === 'deep'
    ? findDeepestChildLevel(clusterId, startLevel, lodData)
    : findChildLevel(clusterId, startLevel, lodData)
);

const applyManualExpansions = (
  baseGraph: GraphData,
  lodData: GraphLODData | null | undefined,
  patchTargets: Set<string>,
  expandDepthMode: ExpandDepthMode
) => {
  let graph = baseGraph;
  for (let pass = 0; pass < 4; pass += 1) {
    const expansionsByLevel = new Map<LodLevel, Set<string>>();
    const nodeByClusterId = new Map<string, Node>();
    graph.nodes.forEach(node => {
      const clusterId = getClusterId(node);
      if (!nodeByClusterId.has(clusterId)) nodeByClusterId.set(clusterId, node);
    });

    patchTargets.forEach(clusterId => {
      const node = nodeByClusterId.get(clusterId);
      if (!node) return;
      const startLevel = getLodLevelForNode(node);
      if (startLevel === null) return;
      const targetLevel = resolveChildLevel(clusterId, startLevel, lodData, expandDepthMode);
      if (targetLevel === null) return;
      if (!expansionsByLevel.has(targetLevel)) expansionsByLevel.set(targetLevel, new Set());
      expansionsByLevel.get(targetLevel)!.add(clusterId);
    });

    if (!expansionsByLevel.size) break;

    (Array.from(expansionsByLevel.keys()) as LodLevel[])
      .sort((a, b) => a - b)
      .forEach(level => {
        const childData = getLodData(lodData, level);
        if (!childData) return;
        const clusters = expansionsByLevel.get(level);
        if (!clusters || !clusters.size) return;
        graph = applyClusterExpansions(graph, childData, clusters, expandDepthMode);
      });
  }
  return graph;
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
  if ((import.meta as any).env?.DEV) {
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

    if (sameCluster && ((source?.kind && !CLUSTER_KINDS.has(source.kind)) || (target?.kind && !CLUSTER_KINDS.has(target.kind)))) {
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
    const isClusterEdge = (source?.kind && CLUSTER_KINDS.has(source.kind)) || source?.cluster_id
      && ((target?.kind && CLUSTER_KINDS.has(target.kind)) || target?.cluster_id);
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
  expandDepthMode: ExpandDepthMode,
): GraphData => {
  if (!expandedClusters.size) return baseGraph;

  const expandedList = Array.from(expandedClusters);
  const expandedSet = new Set(expandedList);
  const parentDepthMap = new Map<string, number>();

  baseGraph.nodes.forEach(node => {
    const clusterId = getClusterId(node);
    if (!expandedSet.has(clusterId)) return;
    parentDepthMap.set(clusterId, getNodeDepth(node));
  });

  const nextDepthByCluster = new Map<string, number>();
  expandedList.forEach(clusterId => {
    const parentDepth = parentDepthMap.get(clusterId);
    if (parentDepth === undefined) return;
    let minDepth: number | null = null;
    let maxDepth: number | null = null;
    childGraph.nodes.forEach(node => {
      if (!node.cluster_path?.includes(clusterId)) return;
      const depth = getNodeDepth(node);
      if (depth <= parentDepth) return;
      if (minDepth === null || depth < minDepth) minDepth = depth;
      if (maxDepth === null || depth > maxDepth) maxDepth = depth;
    });
    const targetDepth = expandDepthMode === 'deep' ? maxDepth : minDepth;
    if (targetDepth !== null) nextDepthByCluster.set(clusterId, targetDepth);
  });

  const childNodes = childGraph.nodes.filter(node => {
    if (!node.cluster_path) return false;
    const nodeDepth = getNodeDepth(node);
    return expandedList.some(clusterId => {
      const targetDepth = nextDepthByCluster.get(clusterId);
      if (targetDepth === undefined) return false;
      return node.cluster_path?.includes(clusterId) && nodeDepth === targetDepth;
    });
  });
  const childNodeIds = new Set(childNodes.map(node => node.id));

  const baseNodes = baseGraph.nodes;
  const baseNodeIds = new Set(baseNodes.map(node => node.id));
  const filteredChildNodes = childNodes.filter(node => !baseNodeIds.has(node.id));
  const mergedNodeIds = new Set([...baseNodeIds, ...filteredChildNodes.map(node => node.id)]);
  const baseEdges = baseGraph.edges.filter(edge => baseNodeIds.has(edge.from) && baseNodeIds.has(edge.to));
  const childEdges = childGraph.edges.filter(edge => {
    const fromInChild = childNodeIds.has(edge.from);
    const toInChild = childNodeIds.has(edge.to);
    if (!fromInChild && !toInChild) return false;
    return mergedNodeIds.has(edge.from) && mergedNodeIds.has(edge.to);
  });

  const mergedNodeMap = new Map<string, Node>();
  baseNodes.forEach(node => mergedNodeMap.set(node.id, node));
  filteredChildNodes.forEach(node => mergedNodeMap.set(node.id, node));

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
  lodMode: LodMode;
  focusClusterId?: string | null;
  backboneEdgeDensity?: number;
  expandDepthMode: ExpandDepthMode;
}

export const useGraphLOD = ({
  baseData,
  lodData,
  zoomLevel,
  allowLod,
  lodMode,
  focusClusterId,
  backboneEdgeDensity = 1,
  expandDepthMode
}: UseGraphLODOptions) => {
  const [lodLevel, setLodLevel] = useState<LodLevel>(() => {
    if (!allowLod) return 3;
    if (lodMode === 'manual') return getManualBaseLevel(lodData);
    return getLodLevelForZoom(zoomLevel);
  });
  const [expandedByDepth, setExpandedByDepth] = useState<Map<number, string>>(new Map());
  const expandedClusters = useMemo(() => new Set(expandedByDepth.values()), [expandedByDepth]);
  const lodLevelRef = useRef<LodLevel>(lodLevel);
  const descendantDepthMap = useMemo(() => {
    if (lodData && (lodData.lod0 || lodData.lod1 || lodData.lod2 || lodData.lod3 || lodData.lod4)) {
      return buildDescendantDepthMap([lodData.lod0, lodData.lod1, lodData.lod2, lodData.lod3, lodData.lod4]);
    }
    return buildDescendantDepthMap([baseData]);
  }, [baseData, lodData]);

  useEffect(() => {
    if (!allowLod) {
      setLodLevel(3);
      lodLevelRef.current = 3;
      setExpandedByDepth(new Map());
      return;
    }
    if (lodMode === 'manual') {
      const baseLevel = getManualBaseLevel(lodData);
      if (lodLevelRef.current !== baseLevel) {
        lodLevelRef.current = baseLevel;
        setLodLevel(baseLevel);
        setExpandedByDepth(new Map());
      }
      return;
    }
    const next = nextLodLevel(zoomLevel, lodLevelRef.current);
    if (next !== lodLevelRef.current) {
      lodLevelRef.current = next;
      setLodLevel(next);
    }
  }, [allowLod, zoomLevel, lodMode, lodData]);

  const toggleCluster = useCallback((clusterId: string, depth?: number | null) => {
    setExpandedByDepth(prev => {
      const next = new Map(prev);
      const depthKey = typeof depth === 'number' ? depth : null;
      const existingAtDepth = depthKey !== null ? prev.get(depthKey) : null;

      if (depthKey !== null && existingAtDepth === clusterId) {
        next.delete(depthKey);
        // Collapse deeper expansions once the anchor is removed.
        Array.from(next.keys()).forEach(key => {
          if (key > depthKey) next.delete(key);
        });
        return next;
      }

      // Remove any stale entries for this cluster id.
      Array.from(next.entries()).forEach(([key, id]) => {
        if (id === clusterId) next.delete(key);
      });

      if (depthKey !== null) {
        next.set(depthKey, clusterId);
        // Enforce a single expansion per depth and collapse deeper levels.
        Array.from(next.keys()).forEach(key => {
          if (key > depthKey) next.delete(key);
        });
      }

      return next;
    });
  }, []);

  const popExpansion = useCallback(() => {
    setExpandedByDepth(prev => {
      if (!prev.size) return prev;
      const depths = Array.from(prev.keys()).sort((a, b) => a - b);
      const deepest = depths[depths.length - 1];
      const next = new Map(prev);
      next.delete(deepest);
      return next;
    });
  }, []);

  const graphData = useMemo(() => {
    if (!allowLod) {
      const baseGraph = attachTotalDegree(filterEdgesToNodes(baseData));
      if (!descendantDepthMap.size) return baseGraph;
      return {
        ...baseGraph,
        nodes: baseGraph.nodes.map(node => {
          if (!node.cluster_path?.length) return node;
          const clusterId = getClusterId(node);
          const nextDepth = descendantDepthMap.get(clusterId);
          if (nextDepth === undefined) return { ...node, canExpand: false };
          const canExpand = nextDepth > getNodeDepth(node);
          return canExpand === node.canExpand ? node : { ...node, canExpand };
        })
      };
    }

    const baseLevel = lodMode === 'manual' ? getManualBaseLevel(lodData) : lodLevel;
    const activeData = getLodData(lodData, baseLevel) || baseData;
    let nextGraph = activeData;

    const patchTargets = new Set<string>(expandedClusters);
    if (focusClusterId) patchTargets.add(focusClusterId);

    if (lodMode === 'manual') {
      if (lodData && patchTargets.size > 0) {
        nextGraph = applyManualExpansions(activeData, lodData, patchTargets, expandDepthMode);
      }
    } else {
      const nodeByClusterId = new Map<string, Node>();
      activeData.nodes.forEach(node => {
        const clusterId = getClusterId(node);
        if (!nodeByClusterId.has(clusterId)) nodeByClusterId.set(clusterId, node);
      });
      const patchClusters = new Set<string>();
      expandedClusters.forEach(clusterId => {
        if (nodeByClusterId.has(clusterId)) patchClusters.add(clusterId);
      });
      if (focusClusterId && nodeByClusterId.has(focusClusterId)) {
        patchClusters.add(focusClusterId);
      }

      if (lodData && patchClusters.size > 0) {
        const expansionsByLevel = new Map<LodLevel, Set<string>>();
        patchClusters.forEach(clusterId => {
          const node = nodeByClusterId.get(clusterId);
          if (!node) return;
          const startLevel = getLodLevelForNode(node);
          if (startLevel === null) return;
          const targetLevel = resolveChildLevel(clusterId, startLevel, lodData, expandDepthMode);
          if (targetLevel === null) return;
          if (!expansionsByLevel.has(targetLevel)) expansionsByLevel.set(targetLevel, new Set());
          expansionsByLevel.get(targetLevel)!.add(clusterId);
        });

        if (expansionsByLevel.size > 0) {
          (Array.from(expansionsByLevel.keys()) as LodLevel[])
            .sort((a, b) => a - b)
            .forEach(level => {
              const childData = getLodData(lodData, level);
              if (!childData) return;
              const clusters = expansionsByLevel.get(level);
              if (!clusters || !clusters.size) return;
              nextGraph = applyClusterExpansions(nextGraph, childData, clusters, expandDepthMode);
            });
        }
      }
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

    const nextGraphWithDegree = attachTotalDegree(filterEdgesToNodes(nextGraph));
    if (!descendantDepthMap.size) return nextGraphWithDegree;
    return {
      ...nextGraphWithDegree,
      nodes: nextGraphWithDegree.nodes.map(node => {
        if (!node.cluster_path?.length) return node;
        const clusterId = getClusterId(node);
        const nextDepth = descendantDepthMap.get(clusterId);
        if (nextDepth === undefined) return { ...node, canExpand: false };
        const canExpand = nextDepth > getNodeDepth(node);
        return canExpand === node.canExpand ? node : { ...node, canExpand };
      })
    };
  }, [allowLod, baseData, expandedClusters, focusClusterId, lodData, lodLevel, lodMode, backboneEdgeDensity, descendantDepthMap, expandDepthMode]);

  return {
    graphData,
    lodLevel,
    expandedClusters,
    expandedByDepth,
    toggleCluster,
    popExpansion
  };
};
