import { Edge, GraphData, GraphLODData, GroupingData, Node } from '../types';

type ClusterInfo = {
  id: string;
  segments: string[];
  depth: number;
  label: string;
  memberCount: number;
  children: Set<string>;
};

type NodeClusterAssignment = {
  segments: string[];
  clusterPathIds: string[];
};

const OTHER_SEGMENTS = ['Other'];

const normalizeMetadataPath = (metadata?: Record<string, any>): string[] | null => {
  if (!metadata) return null;
  const rawPath = metadata.path;
  if (Array.isArray(rawPath)) {
    const segments = rawPath
      .filter((segment): segment is string => typeof segment === 'string')
      .map(segment => segment.trim())
      .filter(Boolean);
    return segments.length ? segments : null;
  }
  if (typeof rawPath === 'string') {
    const segments = rawPath
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
    return segments.length ? segments : null;
  }
  return null;
};

const normalizeLabel = (label: string) => (
  label.replace(/\s*\(\d+\)\s*$/, '').trim() || label.trim()
);

const resolveGroupSetId = (groupings: GroupingData | null, activeGroupingMode: string): string | null => {
  if (!groupings?.group_sets?.length) return null;
  const hasComputed = groupings.group_sets.some(set => set.id === 'computed');
  if (hasComputed) return 'computed';
  const hasActive = groupings.group_sets.some(set => set.id === activeGroupingMode);
  if (hasActive) return activeGroupingMode;
  return groupings.group_sets[0]?.id || null;
};

const encodeSegment = (segment: string) => encodeURIComponent(segment.trim());

const buildClusterId = (groupSetId: string, segments: string[]) => (
  `cluster:${groupSetId}/${segments.map(encodeSegment).join('/')}`
);

const buildClusterPathIds = (rootId: string, groupSetId: string, segments: string[]) => {
  const ids = [rootId];
  segments.forEach((_, index) => {
    ids.push(buildClusterId(groupSetId, segments.slice(0, index + 1)));
  });
  return ids;
};

const aggregateEdgesForDepth = (
  edges: Edge[],
  nodeAssignments: Map<string, NodeClusterAssignment>,
  depth: number,
  validNodeIds: Set<string>
) => {
  const edgeMap = new Map<string, Edge>();
  const edgeCounts = new Map<string, number>();
  const depthIndex = depth + 1;

  edges.forEach(edge => {
    const source = nodeAssignments.get(edge.from);
    const target = nodeAssignments.get(edge.to);
    const sourceClusterId = source?.clusterPathIds[depthIndex];
    const targetClusterId = target?.clusterPathIds[depthIndex];
    if (!sourceClusterId || !targetClusterId) return;
    if (!validNodeIds.has(sourceClusterId) || !validNodeIds.has(targetClusterId)) return;
    if (sourceClusterId === targetClusterId) return;

    const edgeType = edge.type || 'default';
    const key = `${sourceClusterId}::${targetClusterId}::${edgeType}`;
    const existing = edgeMap.get(key);

    if (!existing) {
      edgeMap.set(key, {
        from: sourceClusterId,
        to: targetClusterId,
        type: edgeType,
        weight: edge.weight || 1,
        aggregated: true,
        memberCount: 1
      });
      edgeCounts.set(key, 1);
      return;
    }

    const count = (edgeCounts.get(key) || 1) + 1;
    edgeCounts.set(key, count);
    existing.weight = (existing.weight || 0) + (edge.weight || 1);
    existing.memberCount = count;
  });

  return Array.from(edgeMap.values());
};

const buildClusterNode = (
  info: ClusterInfo,
  clusterPathIds: string[]
): Node => ({
  id: info.id,
  cluster_id: info.id,
  cluster_path: clusterPathIds,
  kind: 'cluster',
  type: 'cluster',
  label: info.label,
  label_short: info.label,
  member_count: info.memberCount,
  modulePath: info.segments,
  module: info.segments[info.segments.length - 1],
  size: 0,
  canExpand: info.children.size > 0
});

const buildRawNode = (
  node: Node,
  assignment: NodeClusterAssignment
): Node => {
  const clusterPathIds = assignment.clusterPathIds;
  const clusterId = clusterPathIds[clusterPathIds.length - 1];
  return {
    ...node,
    cluster_id: clusterId,
    cluster_path: [...clusterPathIds, node.id],
    modulePath: assignment.segments
  };
};

export const buildClusterLodData = (
  rawData: GraphData,
  groupingData: GroupingData | null,
  activeGroupingMode: string
): GraphLODData | null => {
  if (!rawData.nodes.length || !groupingData) return null;

  const groupSetId = resolveGroupSetId(groupingData, activeGroupingMode);
  if (!groupSetId) return null;

  const rootId = `cluster-root:${groupSetId}`;
  const nodePathMap = new Map<string, string[]>();
  const relevantGroups = groupingData.groups.filter(group => group.group_set === groupSetId);

  relevantGroups.forEach(group => {
    const metadataPath = normalizeMetadataPath(group.metadata);
    const segments = metadataPath?.length ? metadataPath : [normalizeLabel(group.label)];
    if (!segments.length) return;
    group.nodes.forEach(nodeId => {
      const existing = nodePathMap.get(nodeId);
      if (!existing || segments.length > existing.length) {
        nodePathMap.set(nodeId, segments);
      }
    });
  });

  const clusterInfoMap = new Map<string, ClusterInfo>();
  const nodeAssignments = new Map<string, NodeClusterAssignment>();

  rawData.nodes.forEach(node => {
    const segments = nodePathMap.get(node.id) || OTHER_SEGMENTS;
    const clusterPathIds = buildClusterPathIds(rootId, groupSetId, segments);
    nodeAssignments.set(node.id, { segments, clusterPathIds });

    segments.forEach((_, index) => {
      const prefix = segments.slice(0, index + 1);
      const clusterId = buildClusterId(groupSetId, prefix);
      const info = clusterInfoMap.get(clusterId) || {
        id: clusterId,
        segments: prefix,
        depth: prefix.length - 1,
        label: prefix[prefix.length - 1],
        memberCount: 0,
        children: new Set<string>()
      };
      info.memberCount += 1;
      if (index < segments.length - 1) {
        const childId = buildClusterId(groupSetId, segments.slice(0, index + 2));
        info.children.add(childId);
      }
      clusterInfoMap.set(clusterId, info);
    });
  });

  const maxDepth = Array.from(clusterInfoMap.values())
    .reduce((acc, info) => Math.max(acc, info.depth), 0);
  const maxClusterLevel = Math.min(maxDepth, 3);

  const lodData: GraphLODData = {};

  for (let level = 0; level <= maxClusterLevel; level += 1) {
    const clusterNodes = Array.from(clusterInfoMap.values())
      .filter(info => info.depth === level)
      .map(info => buildClusterNode(info, buildClusterPathIds(rootId, groupSetId, info.segments)));
    if (!clusterNodes.length) continue;
    const nodeIds = new Set(clusterNodes.map(node => node.id));
    const edges = aggregateEdgesForDepth(rawData.edges, nodeAssignments, level, nodeIds);
    const graph: GraphData = {
      nodes: clusterNodes,
      edges,
      generated_at: rawData.generated_at,
      schema_version: rawData.schema_version,
      source_commit: rawData.source_commit,
      source: `cluster-lod:${groupSetId}:lod${level}`
    };

    if (level === 0) lodData.lod0 = graph;
    if (level === 1) lodData.lod1 = graph;
    if (level === 2) lodData.lod2 = graph;
    if (level === 3) lodData.lod3 = graph;
  }

  const rawNodes = rawData.nodes.map(node => buildRawNode(node, nodeAssignments.get(node.id) || {
    segments: OTHER_SEGMENTS,
    clusterPathIds: buildClusterPathIds(rootId, groupSetId, OTHER_SEGMENTS)
  }));

  if (rawNodes.length) {
    lodData.lod4 = {
      nodes: rawNodes,
      edges: rawData.edges.slice(),
      generated_at: rawData.generated_at,
      schema_version: rawData.schema_version,
      source_commit: rawData.source_commit,
      source: `cluster-lod:${groupSetId}:lod4`
    };
  }

  return lodData;
};
