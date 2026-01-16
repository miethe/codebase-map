import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import { Node, Edge, GraphRendererProps, NODE_SIZE_CONFIG, EDGE_STYLES } from '../types';
import { getNodeColor } from '../utils/colorMapping';
import { computeClusterLayout } from '../utils/clusterLayout';

const GROUP_MAPPING: Record<string, number> = {
  route: 0,
  page: 1,
  component: 2,
  hook: 3,
  api_endpoint: 4,
  endpoint: 4,
  handler: 5,
  service: 5,
  router: 5,
  api_client: 5,
  model: 6,
  repository: 6,
  schema: 6,
  type: 6,
  migration: 6,
  query_key: 6
};

const ARCHITECTURE_FLOW: Record<string, number> = {
  route: 0.1,
  page: 0.2,
  component: 0.35,
  hook: 0.35,
  query_key: 0.45,
  api_client: 0.5,
  api_endpoint: 0.6,
  router: 0.6,
  handler: 0.7,
  service: 0.75,
  model: 0.9,
  repository: 0.85,
  schema: 0.9,
  migration: 0.95,
  type: 0.5
};

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

const toRgba = (color: string, alpha: number) => {
  if (!color.startsWith('#')) return color;
  const hex = color.replace('#', '');
  const normalized = hex.length === 3
    ? hex.split('').map(char => char + char).join('')
    : hex;
  const value = parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getLinkEndpointId = (endpoint?: Edge['source'] | Edge['target']) => {
  if (!endpoint) return null;
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
};

const createModuleForce = (
  moduleCenters: Record<string, { x: number; y: number }>,
  strength: number
) => {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    nodes.forEach(node => {
      const center = moduleCenters[node.module || 'Other'];
      if (!center || node.x === undefined || node.y === undefined) return;
      node.vx = (node.vx || 0) + (center.x - node.x) * strength * alpha;
      node.vy = (node.vy || 0) + (center.y - node.y) * strength * alpha;
    });
  };
  force.initialize = (newNodes: Node[]) => {
    nodes = newNodes;
  };
  return force;
};

const createFlowForce = (width: number, height: number, strength: number) => {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      const targetX = width * (ARCHITECTURE_FLOW[node.type] || 0.5);
      node.vx = (node.vx || 0) + (targetX - node.x) * strength * alpha;
      node.vy = (node.vy || 0) + (height / 2 - node.y) * strength * alpha;
    });
  };
  force.initialize = (newNodes: Node[]) => {
    nodes = newNodes;
  };
  return force;
};

const createLabelSprite = (text: string) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Object3D();
  const fontSize = 32;
  const padding = 12;
  context.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
  const textWidth = context.measureText(text).width;
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = Math.ceil(fontSize + padding * 2);
  context.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
  context.fillStyle = 'rgba(15, 23, 42, 0.82)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e2e8f0';
  context.textBaseline = 'middle';
  context.fillText(text, padding, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = 0.18;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.position.set(0, 12, 0);
  return sprite;
};

const applyStructuredLayout = (nodes: Node[], width: number, height: number) => {
  const groupsCount = 7;
  const colWidth = width / (groupsCount + 1);
  const startX = colWidth * 0.8;
  const groupedNodes: Record<number, Node[]> = {};
  for (let i = 0; i < groupsCount; i += 1) groupedNodes[i] = [];

  nodes.forEach(node => {
    const groupIdx = GROUP_MAPPING[node.type] ?? 2;
    groupedNodes[groupIdx].push(node);
  });

  Object.entries(groupedNodes).forEach(([gIdxStr, gNodes]) => {
    const gIdx = Number(gIdxStr);
    gNodes.sort((a, b) => a.id.localeCompare(b.id));
    const totalInCol = gNodes.length;
    const virtualHeight = Math.max(height * 0.8, totalInCol * 40);
    const startY = (height - virtualHeight) / 2 + 50;
    gNodes.forEach((node, idx) => {
      node.fx = startX + (gIdx * colWidth);
      node.fy = startY + (idx * (virtualHeight / (totalInCol || 1)));
      node.fz = 0;
      node.x = node.fx;
      node.y = node.fy;
    });
  });
};

export const GraphCanvasWebGL: React.FC<GraphRendererProps> = ({ data, viewState, handlers }) => {
  const {
    selectedNode,
    focusMode,
    viewMode,
    activeColorMode,
    groupingData,
    gitMetadata
  } = viewState;
  const {
    onNodeSelect,
    onNodeHover,
    onBackgroundClick
  } = handlers;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [showLabels, setShowLabels] = useState(false);
  const labelCache = useRef<Map<string, THREE.Object3D>>(new Map());

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
    if (!selectedNode) return null;
    return getFlowNodes(selectedNode.id, data.edges);
  }, [selectedNode?.id, data.edges]);

  const visibleData = useMemo(() => {
    let nodes = data.nodes.map(n => ({ ...n }));
    let edges = data.edges.map(e => ({ ...e }));

    if (focusMode && selectedNode && flowNodeIds) {
      const nodeSet = new Set(nodes.filter(n => flowNodeIds.has(n.id)).map(n => n.id));
      nodes = nodes.filter(n => nodeSet.has(n.id));
      edges = edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));
    }

    return { nodes, edges };
  }, [data, focusMode, selectedNode?.id, flowNodeIds]);

  const moduleCenters = useMemo(() => {
    if (viewMode !== 'hierarchical') return null;
    if (!dimensions.width || !dimensions.height) return null;
    return computeClusterLayout(visibleData.nodes, visibleData.edges, dimensions.width, dimensions.height);
  }, [viewMode, visibleData, dimensions.width, dimensions.height]);

  const graphData = useMemo(() => {
    const nodes = visibleData.nodes.map(n => ({ ...n }));
    const edges = visibleData.edges.map(e => ({ ...e }));

    if (viewMode === 'structured' && dimensions.width && dimensions.height) {
      applyStructuredLayout(nodes, dimensions.width, dimensions.height);
    } else {
      nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
        node.fz = null;
      });
    }

    if (viewMode === 'hierarchical' && moduleCenters) {
      const moduleBuckets = new Map<string, Node[]>();
      nodes.forEach(node => {
        const key = node.module || 'Other';
        if (!moduleBuckets.has(key)) moduleBuckets.set(key, []);
        moduleBuckets.get(key)!.push(node);
      });
      moduleBuckets.forEach((bucket, key) => {
        const center = moduleCenters[key];
        if (!center) return;
        const gridSize = Math.max(1, Math.ceil(Math.sqrt(bucket.length)));
        const spacing = 24;
        bucket.forEach((node, idx) => {
          const row = Math.floor(idx / gridSize);
          const col = idx % gridSize;
          const offsetX = (col - gridSize / 2) * spacing;
          const offsetY = (row - gridSize / 2) * spacing;
          if (node.x === undefined) node.x = center.x + offsetX;
          if (node.y === undefined) node.y = center.y + offsetY;
        });
      });
    }

    return {
      nodes,
      links: edges.map(e => ({
        ...e,
        source: e.from,
        target: e.to
      }))
    };
  }, [visibleData, viewMode, dimensions.width, dimensions.height, moduleCenters]);

  useEffect(() => {
    let cancelled = false;

    const applyForces = () => {
      if (cancelled) return;
      const graph = graphRef.current;
      if (!graph) {
        requestAnimationFrame(applyForces);
        return;
      }

      const chargeForce = graph.d3Force('charge') as any;
      const linkForce = graph.d3Force('link') as any;
      if (!chargeForce || !linkForce) {
        requestAnimationFrame(applyForces);
        return;
      }

      const strength = viewMode === 'structured' ? 0 : viewMode === 'hierarchical' ? -80 : -120;
      if (chargeForce?.strength) {
        chargeForce.strength(strength);
      }

      if (linkForce?.distance) {
        const distance = viewMode === 'structured' ? 0 : viewMode === 'hierarchical' ? 80 : 60;
        linkForce.distance(distance);
      }

      if (viewMode === 'hierarchical' && moduleCenters) {
        graph.d3Force('module', createModuleForce(moduleCenters, 0.12));
        graph.d3Force('flow', null);
      } else if (viewMode === 'force' && dimensions.width && dimensions.height) {
        graph.d3Force('flow', createFlowForce(dimensions.width, dimensions.height, 0.08));
        graph.d3Force('module', null);
      } else {
        graph.d3Force('module', null);
        graph.d3Force('flow', null);
      }

      graph.d3ReheatSimulation();
    };

    applyForces();

    return () => {
      cancelled = true;
    };
  }, [
    viewMode,
    moduleCenters,
    dimensions.width,
    dimensions.height,
    graphData.nodes.length,
    graphData.links.length
  ]);

  useEffect(() => {
    let disposed = false;
    let controls: any;
    const updateLabelState = () => {
      const camera = graphRef.current?.camera() as THREE.Camera | undefined;
      if (!camera) return;
      const distance = camera.position.length();
      setShowLabels(distance < 650);
    };

    const attachControls = () => {
      if (disposed) return;
      controls = graphRef.current?.controls() as any;
      if (!controls) {
        requestAnimationFrame(attachControls);
        return;
      }
      controls.addEventListener('change', updateLabelState);
      updateLabelState();
    };

    attachControls();

    return () => {
      disposed = true;
      if (controls) controls.removeEventListener('change', updateLabelState);
    };
  }, [dimensions.width, dimensions.height]);

  useEffect(() => {
    labelCache.current.clear();
    graphRef.current?.refresh();
  }, [graphData.nodes.length]);

  useEffect(() => {
    labelCache.current.forEach(object => {
      object.visible = showLabels;
    });
    graphRef.current?.refresh();
  }, [showLabels]);

  const nodeVal = useCallback((node: Node) => {
    const base = getNodeRadius(node);
    return selectedNode?.id === node.id ? base + 3 : base;
  }, [selectedNode?.id]);

  const nodeColor = useCallback((node: Node) => {
    const base = getNodeColor(node, activeColorMode, groupingData, gitMetadata);
    if (!selectedNode || focusMode) return base;
    if (!flowNodeIds) return base;
    return flowNodeIds.has(node.id) ? base : toRgba(base, 0.12);
  }, [activeColorMode, groupingData, gitMetadata, selectedNode, focusMode, flowNodeIds]);

  const linkColor = useCallback((link: Edge) => {
    const base = EDGE_STYLES[link.type]?.stroke || EDGE_STYLES.default.stroke;
    if (!selectedNode) return toRgba(base, 0.4);
    if (focusMode) return toRgba(base, 0.85);
    const srcId = getLinkEndpointId(link.source);
    const tgtId = getLinkEndpointId(link.target);
    if (flowNodeIds?.has(srcId || '') && flowNodeIds?.has(tgtId || '')) {
      return toRgba(base, 0.85);
    }
    return toRgba(base, 0.05);
  }, [selectedNode, focusMode, flowNodeIds]);

  const nodeThreeObject = useCallback((node: Node) => {
    const cached = labelCache.current.get(node.id);
    if (cached) {
      cached.visible = showLabels;
      return cached;
    }
    const sprite = createLabelSprite(getCleanLabel(node));
    sprite.visible = showLabels;
    labelCache.current.set(node.id, sprite);
    return sprite;
  }, [showLabels]);

  const labelAccessor = showLabels ? nodeThreeObject : undefined;

  const hasRenderableData = graphData.nodes.length > 0 || graphData.links.length > 0;

  return (
    <div ref={containerRef} className="h-full w-full">
      {dimensions.width > 0 && dimensions.height > 0 && hasRenderableData && (
        <ForceGraph3D<Node, Edge>
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0f172a"
          nodeRelSize={3}
          nodeVal={nodeVal}
          nodeLabel={node => getCleanLabel(node)}
          nodeColor={nodeColor}
          nodeOpacity={1}
          nodeThreeObject={labelAccessor}
          nodeThreeObjectExtend={showLabels}
          linkColor={linkColor}
          linkWidth={link => (EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width) * 0.5}
          linkOpacity={1}
          linkCurvature={viewMode === 'hierarchical' ? 0.25 : 0}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={linkColor}
          enableNodeDrag
          onNodeDragEnd={node => {
            const dragged = node as Node;
            if (viewMode === 'structured') {
              dragged.fx = dragged.x;
              dragged.fy = dragged.y;
              dragged.fz = 0;
            } else {
              dragged.fx = null;
              dragged.fy = null;
              dragged.fz = null;
            }
          }}
          onNodeHover={node => onNodeHover((node as Node) || null)}
          onNodeClick={node => {
            const clicked = node as Node;
            onNodeSelect(selectedNode?.id === clicked.id ? null : clicked);
          }}
          onBackgroundClick={() => {
            if (onBackgroundClick) onBackgroundClick();
            else onNodeSelect(null);
          }}
        />
      )}
    </div>
  );
};
