import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import { GraphContext } from '../App';
import { Node, Edge, NODE_SIZE_CONFIG, EDGE_STYLES } from '../types';
import { getNodeColor } from '../utils/colorMapping';

// Helper: Calculate Node Radius using Logarithmic Scale
const getNodeRadius = (node: Node) => {
  const totalDegree = node.totalDegree || 0;
  const radius = NODE_SIZE_CONFIG.baseRadius + (Math.log(totalDegree + 1) * NODE_SIZE_CONFIG.scaleFactor);
  return Math.min(radius, NODE_SIZE_CONFIG.maxRadius);
};

// Helper function to clean labels
const getCleanLabel = (node: Node) => {
  let text = node.label || node.id;

  if (node.type === 'api_endpoint' && node.path && node.method) {
    let cleanPath = node.path.replace(/^\/api\/v1\//, '/');
    if (cleanPath.length > 30) cleanPath = '...' + cleanPath.slice(-27);
    return `${node.method} ${cleanPath}`;
  }

  if (text.includes(':')) {
    const typePrefix = node.type + ':';
    if (text.startsWith(typePrefix)) {
      text = text.substring(typePrefix.length);
    } else if (['page:', 'hook:', 'component:', 'service:', 'model:', 'endpoint:', 'api_endpoint:'].some(p => text.startsWith(p))) {
      text = text.split(':').slice(1).join(':');
    }
  }

  text = text.replace('skillmeat/web/', '')
    .replace('skillmeat/api/', '')
    .replace('skillmeat/core/', '')
    .replace('skillmeat/cache/', '')
    .replace('skillmeat/db/', '');

  if (text.endsWith('.tsx') || text.endsWith('.ts') || text.endsWith('.py')) {
    text = text.replace(/\.tsx?$/, '').replace(/\.py$/, '');
  }

  text = text.replace(/^app\//, '');

  if (text.includes('::')) {
    text = text.split('::').pop() || text;
  }

  if (text.includes('/') && !text.includes(' ')) {
    const parts = text.split('/');
    if (parts[parts.length - 1] === 'page') {
      return parts[parts.length - 2] || 'Home';
    }
    return parts[parts.length - 1];
  }

  return text;
};

// Traversal for Flow Highlighting
const getFlowNodes = (startNodeId: string, edges: Edge[]) => {
  const connectedNodeIds = new Set<string>();
  connectedNodeIds.add(startNodeId);

  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();

  edges.forEach(e => {
    const u = e.from || (typeof e.source === 'string' ? e.source : e.source?.id);
    const v = e.to || (typeof e.target === 'string' ? e.target : e.target?.id);

    if (!u || !v) return;

    if (!outMap.has(u)) outMap.set(u, []);
    outMap.get(u)!.push(v);

    if (!inMap.has(v)) inMap.set(v, []);
    inMap.get(v)!.push(u);
  });

  const queueDown = [startNodeId];
  const visitedDown = new Set([startNodeId]);
  while (queueDown.length > 0) {
    const curr = queueDown.shift()!;
    const neighbors = outMap.get(curr) || [];
    for (const next of neighbors) {
      if (!visitedDown.has(next)) {
        visitedDown.add(next);
        connectedNodeIds.add(next);
        queueDown.push(next);
      }
    }
  }

  const queueUp = [startNodeId];
  const visitedUp = new Set([startNodeId]);
  while (queueUp.length > 0) {
    const curr = queueUp.shift()!;
    const neighbors = inMap.get(curr) || [];
    for (const prev of neighbors) {
      if (!visitedUp.has(prev)) {
        visitedUp.add(prev);
        connectedNodeIds.add(prev);
        queueUp.push(prev);
      }
    }
  }

  return connectedNodeIds;
};

export const GraphCanvasWebGL: React.FC = () => {
  const {
    data,
    selectedNode,
    setSelectedNode,
    setHoveredNode,
    focusMode,
    activeColorMode,
    groupingData,
    gitMetadata
  } = useContext(GraphContext);

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDimensions({
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height))
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  const flowNodeIds = useMemo(() => {
    if (!focusMode || !selectedNode) return null;
    return getFlowNodes(selectedNode.id, data.edges);
  }, [focusMode, selectedNode?.id, data.edges]);

  const graphData = useMemo(() => {
    let nodes = data.nodes.map(n => ({ ...n }));
    let edges = data.edges.map(e => ({ ...e }));

    if (focusMode && selectedNode && flowNodeIds) {
      const nodeSet = new Set(nodes.filter(n => flowNodeIds.has(n.id)).map(n => n.id));
      nodes = nodes.filter(n => nodeSet.has(n.id));
      edges = edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));
    }

    return {
      nodes,
      links: edges.map(e => ({
        ...e,
        source: e.from,
        target: e.to
      }))
    };
  }, [data, focusMode, selectedNode?.id, flowNodeIds]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <ForceGraph3D<Node, Edge>
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0f172a"
          nodeRelSize={3}
          nodeVal={node => getNodeRadius(node)}
          nodeLabel={node => getCleanLabel(node)}
          nodeColor={node => getNodeColor(node, activeColorMode, groupingData, gitMetadata)}
          linkColor={link => (EDGE_STYLES[link.type]?.stroke || EDGE_STYLES.default.stroke)}
          linkWidth={link => (EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width) * 0.5}
          linkOpacity={0.4}
          enableNodeDrag
          onNodeHover={node => setHoveredNode((node as Node) || null)}
          onNodeClick={node => setSelectedNode(node as Node)}
          onBackgroundClick={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
};
