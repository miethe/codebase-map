import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import { forceCollide, forceZ } from 'd3-force-3d';
import { Node as GraphNode, Edge, GraphRendererProps, NODE_SIZE_CONFIG, EDGE_STYLES, ExportPass, CameraPresetId, ExportRequest, DrilldownContext, CLUSTER_KINDS } from '../types';

// Fix for global Node type collision
type Node = GraphNode;
import { getNodeColor } from '../utils/colorMapping';
import { computeClusterLayout } from '../utils/clusterLayout';
import { getFocusNodeIds } from '../utils/focusModes';
import { getLabelBucketForZoom, getNextLabelBucket, getLabelBudgetForBucket, getLabelRank, compareLabelRank, shouldForceLabel } from '../utils/labeling';
import { loadLayoutCache, saveLayoutCache, LayoutCachePoint } from '../utils/layoutCache';

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

const LOD_PLANE_COLORS = ['#0f172a', '#1e293b', '#243244', '#334155', '#475569'];

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
  strength: number | ((node: Node) => number)
) => {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    nodes.forEach(node => {
      const center = moduleCenters[node.module || 'Other'];
      if (!center || node.x === undefined || node.y === undefined) return;
      const appliedStrength = typeof strength === 'function' ? strength(node) : strength;
      node.vx = (node.vx || 0) + (center.x - node.x) * appliedStrength * alpha;
      node.vy = (node.vy || 0) + (center.y - node.y) * appliedStrength * alpha;
    });
  };
  force.initialize = (newNodes: Node[]) => {
    nodes = newNodes;
  };
  return force;
};

const MAX_UINT32 = 0xffffffff;
const directionCache = new Map<string, { x: number; y: number; z: number }>();

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getStableDirection = (key: string) => {
  const cached = directionCache.get(key);
  if (cached) return cached;
  const u = hashString(`${key}|u`) / MAX_UINT32;
  const v = hashString(`${key}|v`) / MAX_UINT32;
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const sinPhi = Math.sin(phi);
  const dir = {
    x: Math.cos(theta) * sinPhi,
    y: Math.sin(theta) * sinPhi,
    z: Math.cos(phi)
  };
  directionCache.set(key, dir);
  return dir;
};

const getBalloonRadius = (node: Node, maxRadius: number) => {
  const layer = ARCHITECTURE_FLOW[node.type] ?? 0.5;
  const minRadius = maxRadius * 0.15; // Slightly reduced minimum
  // Adjust for finer granularity with more LODs
  // Pre-computed layouts might mean we don't even need this force, but keeping it for dynamic modes
  return minRadius + (maxRadius - minRadius) * layer;
};

const getNodeLodDepth = (node: Node) => {
  if (typeof node.lodDepth === 'number') return Math.max(0, Math.round(node.lodDepth));
  if (node.cluster_path?.length) return Math.max(0, node.cluster_path.length - 1);
  return 0;
};

const isNodeInCluster = (node: Node, clusterId: string | null) => {
  if (!clusterId) return false;
  if (node.id === clusterId) return true;
  if (node.cluster_id === clusterId) return true;
  return node.cluster_path?.includes(clusterId) ?? false;
};

const getFocusClusterDepth = (nodes: Node[], clusterId: string) => {
  const direct = nodes.find(node => node.id === clusterId || node.cluster_id === clusterId);
  if (direct) return getNodeLodDepth(direct);
  for (const node of nodes) {
    if (!node.cluster_path) continue;
    const index = node.cluster_path.indexOf(clusterId);
    if (index >= 0) return index;
  }
  return null;
};

const buildDrilldownContextNodeIds = (
  nodes: Node[],
  focusClusterIds: Set<string> | null,
  mode: DrilldownContext
) => {
  if (!focusClusterIds || focusClusterIds.size === 0 || mode === 'all') return null;
  const clusterNodeIds = new Set<string>();
  nodes.forEach(node => {
    for (const clusterId of focusClusterIds) {
      if (isNodeInCluster(node, clusterId)) {
        clusterNodeIds.add(node.id);
        break;
      }
    }
  });
  if (!clusterNodeIds.size) return null;
  if (mode === 'cluster-only') return clusterNodeIds;
  // Get focus depth from the first focused cluster
  const firstClusterId = focusClusterIds.values().next().value;
  const focusDepth = getFocusClusterDepth(nodes, firstClusterId);
  if (focusDepth === null) return clusterNodeIds;
  nodes.forEach(node => {
    if (getNodeLodDepth(node) === focusDepth) clusterNodeIds.add(node.id);
  });
  return clusterNodeIds;
};

const getEdgeEndpoints = (edge: Edge) => {
  const from = edge.from || (typeof edge.source === 'string' ? edge.source : edge.source?.id);
  const to = edge.to || (typeof edge.target === 'string' ? edge.target : edge.target?.id);
  if (!from || !to) return null;
  return { from, to };
};

const buildUndirectedAdjacency = (edges: Edge[]) => {
  const undirected = new Map<string, string[]>();
  edges.forEach(edge => {
    const endpoints = getEdgeEndpoints(edge);
    if (!endpoints) return;
    const { from, to } = endpoints;
    if (!undirected.has(from)) undirected.set(from, []);
    if (!undirected.has(to)) undirected.set(to, []);
    undirected.get(from)!.push(to);
    undirected.get(to)!.push(from);
  });
  return undirected;
};

const traverseUndirectedFromSeeds = (startIds: string[], adjacency: Map<string, string[]>) => {
  const visited = new Set<string>();
  const queue: string[] = [];
  startIds.forEach(id => {
    if (visited.has(id)) return;
    visited.add(id);
    queue.push(id);
  });
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

const getClusterAncestorIds = (nodes: Node[], clusterId: string) => {
  const direct = nodes.find(node => node.id === clusterId || node.cluster_id === clusterId);
  if (direct?.cluster_path?.length) {
    const index = direct.cluster_path.indexOf(clusterId);
    if (index >= 0) return direct.cluster_path.slice(0, index + 1);
    return direct.cluster_path;
  }
  for (const node of nodes) {
    if (!node.cluster_path?.length) continue;
    const index = node.cluster_path.indexOf(clusterId);
    if (index >= 0) return node.cluster_path.slice(0, index + 1);
  }
  return [clusterId];
};

const buildDrilldownFocusNodeIds = (nodes: Node[], edges: Edge[], focusClusterIds: Set<string> | null) => {
  if (!focusClusterIds || focusClusterIds.size === 0) return null;
  const seedIds = new Set<string>();
  nodes.forEach(node => {
    for (const clusterId of focusClusterIds) {
      if (isNodeInCluster(node, clusterId)) {
        seedIds.add(node.id);
        break;
      }
    }
  });
  if (!seedIds.size) return null;
  const adjacency = buildUndirectedAdjacency(edges);
  const connected = traverseUndirectedFromSeeds(Array.from(seedIds), adjacency);
  // Add ancestors for all focused clusters
  for (const clusterId of focusClusterIds) {
    getClusterAncestorIds(nodes, clusterId).forEach(id => connected.add(id));
  }
  return connected;
};

const getLodPlaneColor = (depth: number) => LOD_PLANE_COLORS[depth % LOD_PLANE_COLORS.length];

const clampLayerSpacing = (value: number) => Math.min(400, Math.max(80, value));

const getChargeStrength = (node: Node, mode: string) => {
  const degree = node.degree || 0;
  const base = mode === 'hierarchical' ? -110 : -140;
  const scale = mode === 'hierarchical' ? 20 : 24;
  const maxRepel = mode === 'hierarchical' ? -750 : -850;
  const strength = base - (degree * scale);
  return Math.max(maxRepel, strength);
};

const getLinkDistance = (link: any, mode: string) => {
  if (mode === 'structured') return 0;
  const src = link.source as Node;
  const tgt = link.target as Node;
  const degreeBoost = Math.sqrt((src.degree || 0) + (tgt.degree || 0)) * 5;
  if (mode === 'hierarchical') {
    const sameModule = src.module === tgt.module;
    const base = sameModule ? 55 : 170;
    return Math.min(260, base + degreeBoost);
  }
  return Math.min(170, 70 + degreeBoost);
};

const getModulePullStrength = (node: Node) => {
  const degree = node.degree || 0;
  const base = 0.25;
  const extra = Math.min(0.35, Math.sqrt(degree) * 0.06);
  return base + extra;
};

const isDashedLink = (link: Edge) => Boolean(EDGE_STYLES[link.type]?.dash);

const createBalloonForce = (maxRadius: number, strength: number) => {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    nodes.forEach(node => {
      const dir = getStableDirection(node.id);
      const radius = getBalloonRadius(node, maxRadius);
      const targetX = dir.x * radius;
      const targetY = dir.y * radius;
      const targetZ = dir.z * radius;
      node.vx = (node.vx || 0) + (targetX - (node.x || 0)) * strength * alpha;
      node.vy = (node.vy || 0) + (targetY - (node.y || 0)) * strength * alpha;
      node.vz = (node.vz || 0) + (targetZ - (node.z || 0)) * strength * alpha;
    });
  };
  force.initialize = (newNodes: Node[]) => {
    nodes = newNodes;
  };
  return force;
};

type TextSpriteOptions = {
  fontSize: number;
  fontWeight: number;
  padding: number;
  textColor: string;
  backgroundColor?: string;
  fontFamily?: string;
  scale: number;
};

const createTextSprite = (text: string, options: TextSpriteOptions) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  }
  const {
    fontSize,
    fontWeight,
    padding,
    textColor,
    backgroundColor,
    fontFamily = '"JetBrains Mono", monospace',
    scale
  } = options;
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const textWidth = context.measureText(text).width;
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = Math.ceil(fontSize + padding * 2);
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  if (backgroundColor) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = textColor;
  context.textBaseline = 'middle';
  context.fillText(text, padding, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.userData.labelSize = {
    width: canvas.width * scale,
    height: canvas.height * scale
  };
  return sprite;
};

const createLabelSprite = (text: string) => {
  const sprite = createTextSprite(text, {
    fontSize: 32,
    fontWeight: 600,
    padding: 12,
    textColor: '#e2e8f0',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    scale: 0.18
  });
  sprite.position.set(0, 12, 0);
  return sprite;
};

const createHeaderSprite = (text: string) => createTextSprite(text.toUpperCase(), {
  fontSize: 22,
  fontWeight: 700,
  padding: 8,
  textColor: '#94a3b8',
  backgroundColor: 'rgba(15, 23, 42, 0.65)',
  fontFamily: '"Inter", sans-serif',
  scale: 0.16
});

const createModuleLabelSprite = (text: string) => createTextSprite(text, {
  fontSize: 20,
  fontWeight: 600,
  padding: 8,
  textColor: '#94a3b8',
  backgroundColor: 'rgba(15, 23, 42, 0.7)',
  fontFamily: '"Inter", sans-serif',
  scale: 0.15
});

const createClusterLabelSprite = (text: string, focused: boolean) => createTextSprite(text, {
  fontSize: 32,
  fontWeight: 700,
  padding: 12,
  textColor: focused ? '#e0f2fe' : '#f3e8ff',
  backgroundColor: focused ? 'rgba(14, 165, 233, 0.75)' : 'rgba(88, 28, 135, 0.75)',
  fontFamily: '"Inter", sans-serif',
  scale: 0.36
});

const createLodPlaneLabelSprite = (text: string, color: string) => createTextSprite(text, {
  fontSize: 28,
  fontWeight: 700,
  padding: 10,
  textColor: '#ccfbf1',
  backgroundColor: 'rgba(17, 94, 89, 0.85)',
  fontFamily: '"Inter", sans-serif',
  scale: 0.32
});

const getGlyphIntensity = (node: Node) => {
  if (node.hotness !== undefined) {
    return Math.max(0.2, Math.min(1, node.hotness / 100));
  }
  if (node.size !== undefined) {
    return Math.max(0.2, Math.min(1, Math.log1p(node.size) / 6));
  }
  if (node.totalDegree !== undefined) {
    return Math.max(0.2, Math.min(1, Math.log1p(node.totalDegree) / 4));
  }
  return 0.35;
};

const createClusterGlyphSprite = (node: Node) => {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const intensity = getGlyphIntensity(node);
  const outer = 18 + (intensity * 6);
  const inner = 10 + (intensity * 3);
  const gradient = context.createRadialGradient(size / 2, size / 2, inner, size / 2, size / 2, outer);
  gradient.addColorStop(0, `rgba(248, 113, 113, ${0.7 * intensity})`);
  gradient.addColorStop(1, `rgba(56, 189, 248, ${0.35 * (1 - intensity)})`);
  context.strokeStyle = gradient;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(size / 2, size / 2, outer, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = `rgba(148, 163, 184, ${0.6 + (0.2 * intensity)})`;
  context.beginPath();
  context.arc(size / 2, size / 2, inner * 0.35, 0, Math.PI * 2);
  context.fill();

  const plusSize = 10 + (intensity * 2);
  context.strokeStyle = 'rgba(226, 232, 240, 0.9)';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(size / 2 - plusSize / 2, size / 2);
  context.lineTo(size / 2 + plusSize / 2, size / 2);
  context.moveTo(size / 2, size / 2 - plusSize / 2);
  context.lineTo(size / 2, size / 2 + plusSize / 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const scale = 0.22 + (intensity * 0.08);
  sprite.scale.set(size * scale, size * scale, 1);
  sprite.position.set(0, -8, 0);
  sprite.renderOrder = 1;
  return sprite;
};

const MULTI_MEMBERSHIP_RING_COLOR = '#e2e8f0';
const MAX_MULTI_MEMBERSHIP_RINGS = 3;
const EXPANDED_HALO_COLOR = '#facc15';

const createMultiMembershipRingSprite = (radius: number, baseOpacity: number) => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const center = size / 2;
  const ringRadius = size * 0.35;
  context.strokeStyle = MULTI_MEMBERSHIP_RING_COLOR;
  context.lineWidth = 6;
  context.beginPath();
  context.arc(center, center, ringRadius, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  material.opacity = baseOpacity;
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(radius * 2, radius * 2, 1);
  sprite.renderOrder = 1;
  sprite.userData.baseOpacity = baseOpacity;
  sprite.userData.hoverOpacity = Math.min(1, baseOpacity + 0.35);
  return sprite;
};

const createExpandedHaloSprite = (radius: number) => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const center = size / 2;
  const ringRadius = size * 0.38;
  context.strokeStyle = EXPANDED_HALO_COLOR;
  context.lineWidth = 8;
  context.beginPath();
  context.arc(center, center, ringRadius, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  material.opacity = 0.7;
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(radius * 2.6, radius * 2.6, 1);
  sprite.renderOrder = 0;
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
      node.z = 0;
    });
  });
};

const STRUCTURED_HEADERS = ['Routes', 'Pages', 'Components', 'Hooks', 'API', 'Services', 'Data'];

type ExportRenderState = {
  pass: ExportPass;
  showNodes: boolean;
  showLinks: boolean;
  showLabels: boolean;
  highlightOnly: boolean;
  nodeOpacity: number;
  linkOpacity: number;
  colorMode?: string | null;
  transparentBackground: boolean;
};

type LayoutSnapshot = {
  x?: number;
  y?: number;
  z?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  vx?: number;
  vy?: number;
  vz?: number;
};

type CameraPresetConfig = {
  direction: [number, number, number];
  up?: [number, number, number];
  distanceMultiplier?: number;
};

const CAMERA_PRESETS: Record<CameraPresetId, CameraPresetConfig> = {
  default: { direction: [1, 1, 1], up: [0, 1, 0], distanceMultiplier: 1.2 },
  architecture: { direction: [0.4, 0.9, 0.7], up: [0, 1, 0], distanceMultiplier: 1.25 },
  backbone: { direction: [1, 0.6, 0.8], up: [0, 1, 0], distanceMultiplier: 1.2 },
  hotspots: { direction: [-0.6, 1, 0.8], up: [0, 1, 0], distanceMultiplier: 1.25 },
  risk: { direction: [0.8, 0.4, 1], up: [0, 1, 0], distanceMultiplier: 1.2 },
  isometric: { direction: [1, 1, 1], up: [0, 1, 0], distanceMultiplier: 1.2 },
  top: { direction: [0, 1, 0.01], up: [0, 0, -1], distanceMultiplier: 1.1 }
};

export const GraphCanvasWebGL: React.FC<GraphRendererProps> = ({ data, viewState, handlers }) => {
  const {
    selectedNode,
    focusMode,
    focusHopCount,
    focusClusterIds,
    drilldownContext,
    expandedClusterIds,
    viewMode,
    activeColorMode,
    activeGroupingMode,
    groupingData,
    gitMetadata,
    dimDrilldownLabels,
    showMultiMembership,
    layeredLodEnabled,
    layerSpacing,
    showLodPlanes,
    enableMotionOptimizations,
    enablePerformanceMode,
    zoomSpeed,
    panSpeed,
    rotateSpeed,
    zoomLevel,
    exportRequest,
    cameraPresetRequest,
    cameraJumpRequest,
    layoutCacheKey
  } = viewState;
  const {
    onNodeSelect,
    onNodeExpand,
    onNodeHover,
    onBackgroundClick,
    onZoomChange,
    onExportStatus,
    onExportRequestHandled,
    onEscape
  } = handlers;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const nodePositions = useRef<Map<string, LayoutCachePoint>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [reduceDetail, setReduceDetail] = useState(false);
  const nodeObjectCache = useRef<Map<string, THREE.Object3D>>(new Map());
  const labelCache = useRef<Map<string, THREE.Sprite>>(new Map());
  const glyphCache = useRef<Map<string, THREE.Sprite>>(new Map());
  const expandedHaloCache = useRef<Map<string, THREE.Sprite>>(new Map());
  const multiMembershipRingCache = useRef<Map<string, THREE.Sprite[]>>(new Map());
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const lodPlaneOverlayRef = useRef<THREE.Group | null>(null);
  const clusterOverlayRef = useRef<THREE.Group | null>(null);
  const moduleOverlayRef = useRef<THREE.Group | null>(null);
  const headerOverlayRef = useRef<THREE.Group | null>(null);
  const lodPlaneOverlayCache = useRef<Map<number, { plane: THREE.Mesh; label: THREE.Sprite }>>(new Map());
  const clusterOverlayCache = useRef<Map<string, { box: THREE.LineSegments; label: THREE.Sprite; focused: boolean }>>(new Map());
  const moduleOverlayCache = useRef<Map<string, { box: THREE.LineLoop; label: THREE.Sprite }>>(new Map());
  const headerLabelCache = useRef<THREE.Sprite[]>([]);
  const lodPlaneTickRef = useRef<number>(0);
  const clusterOverlayTickRef = useRef<number>(0);
  const overlayTickRef = useRef<number>(0);
  const interactionTimeoutRef = useRef<number | null>(null);
  const clickTimeoutRef = useRef<number | null>(null);
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  const lastCameraRef = useRef<{ x: number; y: number; z: number; time: number } | null>(null);
  const labelUpdateFrameRef = useRef<number | null>(null);
  const labelUpdateTimeoutRef = useRef<number | null>(null);
  const labelTickRef = useRef<number>(0);
  const positionTickRef = useRef<number>(0);
  const lastLabelUpdateRef = useRef<number>(0);
  const labelUpdateIntervalRef = useRef<number>(250);
  const labelVisibilityModeRef = useRef<'hidden' | 'frustum'>('frustum');
  const graphDataRef = useRef<{ nodes: Node[]; links: Edge[] } | null>(null);
  const graphReadyRef = useRef(false);
  const animationPausedRef = useRef(false);
  const pendingReheatRef = useRef(false);
  const zoomBaselineRef = useRef<number | null>(null);
  const lastZoomLevelRef = useRef<number | null>(null);
  const frustumRef = useRef(new THREE.Frustum());
  const projScreenMatrixRef = useRef(new THREE.Matrix4());
  const tempVectorRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const tempVectorBRef = useRef(new THREE.Vector3());
  const tempVectorCRef = useRef(new THREE.Vector3());
  const [exportRenderState, setExportRenderState] = useState<ExportRenderState | null>(null);
  const exportRenderStateRef = useRef<ExportRenderState | null>(null);
  const exportInProgressRef = useRef(false);
  const exportOrthographicRef = useRef(false);
  const [labelBucket, setLabelBucket] = useState(() => getLabelBucketForZoom(zoomLevel));
  const labelBucketRef = useRef(labelBucket);
  const [hoveredEdge, setHoveredEdge] = useState<Edge | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const previousHoveredNodeIdRef = useRef<string | null>(null);
  const [pointerPosition, setPointerPosition] = useState({ x: 0, y: 0 });
  const [layoutCacheVersion, setLayoutCacheVersion] = useState(0);
  const lastLayoutCacheKeyRef = useRef<string | null>(null);
  const lastCacheWriteRef = useRef<number>(0);
  const CLICK_DELAY = 280;
  const DOUBLE_CLICK_WINDOW = 380;

  const updateReduceDetail = useCallback((speed: number) => {
    if (!enableMotionOptimizations) return;
    const hideThreshold = 1.0;
    const showThreshold = 0.2;
    setReduceDetail(prev => {
      let next = prev;
      if (speed > hideThreshold) next = true;
      else if (speed < showThreshold) next = false;
      return next === prev ? prev : next;
    });
  }, [enableMotionOptimizations]);

  const handlePointerMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPointerPosition({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });
  }, []);

  const handleNodeHover = useCallback((node: Node | null) => {
    setHoveredNodeId(node?.id ?? null);
    onNodeHover(node);
  }, [onNodeHover]);

  useEffect(() => {
    exportRenderStateRef.current = exportRenderState;
  }, [exportRenderState]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        window.clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const next = getNextLabelBucket(zoomLevel, labelBucketRef.current);
    if (next !== labelBucketRef.current) {
      labelBucketRef.current = next;
      setLabelBucket(next);
    }
  }, [zoomLevel]);

  const resumeAnimation = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !animationPausedRef.current) return;
    animationPausedRef.current = false;
    graph.resumeAnimation();
  }, []);

  const pauseAnimation = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || animationPausedRef.current) return;
    animationPausedRef.current = true;
    graph.pauseAnimation();
  }, []);

  const registerInteraction = useCallback((speed?: number) => {
    resumeAnimation();
    if (!enableMotionOptimizations) return;
    if (typeof speed === 'number') {
      updateReduceDetail(speed);
    }
    if (interactionTimeoutRef.current) {
      window.clearTimeout(interactionTimeoutRef.current);
    }
    interactionTimeoutRef.current = window.setTimeout(() => {
      setReduceDetail(false);
      interactionTimeoutRef.current = null;
    }, 220);
  }, [enableMotionOptimizations, resumeAnimation, updateReduceDetail]);

  const requestReheat = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    resumeAnimation();
    if (graphReadyRef.current) {
      graph.d3ReheatSimulation();
    } else {
      pendingReheatRef.current = true;
    }
  }, [resumeAnimation]);

  const updateCameraState = useCallback(() => {
    const camera = graphRef.current?.camera() as THREE.Camera | undefined;
    if (!camera) return;
    const now = performance.now();
    const last = lastCameraRef.current;
    let speed = 0;
    if (last) {
      const dx = camera.position.x - last.x;
      const dy = camera.position.y - last.y;
      const dz = camera.position.z - last.z;
      const delta = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      const dt = Math.max(16, now - last.time);
      speed = delta / dt;
    }
    lastCameraRef.current = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      time: now
    };
    if (onZoomChange) {
      const controls = graphRef.current?.controls() as any;
      const target = controls?.target || new THREE.Vector3();
      const distance = camera.position.distanceTo(target);
      if (!zoomBaselineRef.current) {
        zoomBaselineRef.current = distance || 1;
      }
      const baseline = zoomBaselineRef.current || 1;
      const zoom = baseline / Math.max(distance, 1);
      const lastZoom = lastZoomLevelRef.current;
      if (lastZoom === null || Math.abs(zoom - lastZoom) > 0.002) {
        lastZoomLevelRef.current = zoom;
        onZoomChange(zoom);
      }
    }
    if (!enableMotionOptimizations) return;
    registerInteraction(speed);
  }, [enableMotionOptimizations, onZoomChange, registerInteraction]);

  const getHeatmapColorMode = useCallback(() => {
    if (gitMetadata) return 'churn';
    return 'type';
  }, [gitMetadata]);

  const getGraphBounds = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return null;
    const bbox = graph.getGraphBbox();
    if (!bbox) return null;
    const min = new THREE.Vector3(bbox.x[0], bbox.y[0], bbox.z[0]);
    const max = new THREE.Vector3(bbox.x[1], bbox.y[1], bbox.z[1]);
    const size = new THREE.Vector3(max.x - min.x, max.y - min.y, max.z - min.z);
    const center = new THREE.Vector3(
      (min.x + max.x) / 2,
      (min.y + max.y) / 2,
      (min.z + max.z) / 2
    );
    const radius = Math.max(1, Math.max(size.x, size.y, size.z) * 0.6);
    return { min, max, size, center, radius };
  }, []);

  const computeCameraPose = useCallback((presetId: CameraPresetId, aspectRatio: number) => {
    const bounds = getGraphBounds();
    if (!bounds) return null;
    const preset = CAMERA_PRESETS[presetId] || CAMERA_PRESETS.default;
    const direction = new THREE.Vector3(...preset.direction).normalize();
    const camera = graphRef.current?.camera() as THREE.PerspectiveCamera | undefined;
    const fov = camera?.fov ? THREE.MathUtils.degToRad(camera.fov) : THREE.MathUtils.degToRad(60);
    const baseDistance = bounds.radius / Math.tan(fov / 2);
    const distance = Math.max(120, baseDistance * (preset.distanceMultiplier || 1.2));
    const position = bounds.center.clone().add(direction.multiplyScalar(distance));
    const up = preset.up ? new THREE.Vector3(...preset.up) : new THREE.Vector3(0, 1, 0);
    return {
      position,
      target: bounds.center,
      up,
      radius: bounds.radius,
      aspectRatio
    };
  }, [getGraphBounds]);

  const applyCameraPreset = useCallback((presetId: CameraPresetId, transitionMs = 0) => {
    const graph = graphRef.current;
    if (!graph) return;
    const aspectRatio = Math.max(1, dimensions.width) / Math.max(1, dimensions.height);
    const pose = computeCameraPose(presetId, aspectRatio);
    if (!pose) return;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    camera.up.copy(pose.up);
    graph.cameraPosition({
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z
    }, {
      x: pose.target.x,
      y: pose.target.y,
      z: pose.target.z
    }, transitionMs);
    const controls = graph.controls() as any;
    if (controls?.target) {
      controls.target.copy(pose.target);
      if (controls.update) controls.update();
    }
  }, [computeCameraPose, dimensions.height, dimensions.width]);

  const flyToNode = useCallback((node: Node, transitionMs = 850) => {
    const graph = graphRef.current;
    if (!graph) return;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    const controls = graph.controls() as any;
    const target = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
    const currentPos = camera.position.clone();
    const offset = currentPos.sub(target);
    const nextTarget = new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    const nextPos = nextTarget.clone().add(offset);
    graph.cameraPosition({
      x: nextPos.x,
      y: nextPos.y,
      z: nextPos.z
    }, {
      x: nextTarget.x,
      y: nextTarget.y,
      z: nextTarget.z
    }, transitionMs);
    if (controls?.target) {
      controls.target.copy(nextTarget);
      if (controls.update) controls.update();
    }
  }, []);

  const createOrthographicCamera = useCallback((presetId: CameraPresetId, width: number, height: number) => {
    const aspectRatio = width / Math.max(1, height);
    const pose = computeCameraPose(presetId, aspectRatio);
    if (!pose) return null;
    const halfHeight = Math.max(1, pose.radius * 1.1);
    const halfWidth = halfHeight * aspectRatio;
    const camera = new THREE.OrthographicCamera(
      -halfWidth,
      halfWidth,
      halfHeight,
      -halfHeight,
      -10000,
      10000
    );
    camera.up.copy(pose.up);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return { camera, pose };
  }, [computeCameraPose]);

  const applySeededLayout = useCallback((seed: string) => {
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return null;
    const bounds = getGraphBounds();
    const baseRadius = Math.max(160, bounds?.radius ? bounds.radius * 1.1 : 240);
    const snapshot = new Map<string, LayoutSnapshot>();
    dataSnapshot.nodes.forEach(node => {
      snapshot.set(node.id, {
        x: node.x,
        y: node.y,
        z: node.z,
        fx: node.fx,
        fy: node.fy,
        fz: node.fz,
        vx: node.vx,
        vy: node.vy,
        vz: node.vz
      });
      // Respect pre-computed layout if available
      if (node.fx != null && node.fy != null) {
        // Using fx/fy locks the node in D3 force.
        // If we want it to just START there but be movable, we set x/y only.
        // But for "fast static" views, we prefer locking.
        // Use node.fx/node.fy directly from data if present.
      } else {
        // Fallback to seeded random
        const dir = getStableDirection(`${seed}|${node.id}`);
        const scalar = 0.55 + (hashString(`${node.id}|${seed}`) / MAX_UINT32) * 0.45;
        const radius = baseRadius * scalar;
        node.x = dir.x * radius;
        node.y = dir.y * radius;
        node.z = viewMode === 'hierarchical' ? 0 : dir.z * radius;

        if (viewMode === 'force') {
          // Only lock if we want totally static. For now let D3 settle it unless pre-computed.
          node.fx = undefined;
          node.fy = undefined;
          node.fz = undefined;
        }
      }

      // Zero out velocity
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    });
    dataSnapshot.nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      nodePositions.current.set(node.id, {
        x: node.x,
        y: node.y,
        z: node.z ?? 0,
        vx: node.vx,
        vy: node.vy,
        vz: node.vz
      });
    });
    return snapshot;
  }, [getGraphBounds, viewMode]);

  const restoreSeededLayout = useCallback((snapshot: Map<string, LayoutSnapshot> | null) => {
    if (!snapshot) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;
    dataSnapshot.nodes.forEach(node => {
      const prev = snapshot.get(node.id);
      if (!prev) return;
      node.x = prev.x;
      node.y = prev.y;
      node.z = prev.z;
      node.fx = prev.fx ?? null;
      node.fy = prev.fy ?? null;
      node.fz = prev.fz ?? null;
      node.vx = prev.vx;
      node.vy = prev.vy;
      node.vz = prev.vz;
    });
    dataSnapshot.nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      nodePositions.current.set(node.id, {
        x: node.x,
        y: node.y,
        z: node.z ?? 0,
        vx: node.vx,
        vy: node.vy,
        vz: node.vz
      });
    });
  }, []);

  const waitForFrames = useCallback((frames = 2) => new Promise<void>((resolve) => {
    let count = 0;
    const step = () => {
      count += 1;
      if (count >= frames) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }), []);

  useEffect(() => {
    zoomBaselineRef.current = null;
    lastZoomLevelRef.current = null;
  }, [viewMode]);

  useEffect(() => {
    if (!layoutCacheKey) return;
    if (layoutCacheKey === lastLayoutCacheKeyRef.current) return;
    lastLayoutCacheKeyRef.current = layoutCacheKey;
    const cached = loadLayoutCache(layoutCacheKey);
    nodePositions.current.clear();
    if (cached) {
      cached.forEach((pos, id) => nodePositions.current.set(id, pos));
    }
    setLayoutCacheVersion(prev => prev + 1);
  }, [layoutCacheKey]);

  useEffect(() => {
    if (!cameraPresetRequest) return;
    let cancelled = false;
    const attemptApply = () => {
      if (cancelled) return;
      if (!graphRef.current || !dimensions.width || !dimensions.height) {
        requestAnimationFrame(attemptApply);
        return;
      }
      applyCameraPreset(cameraPresetRequest.id, 650);
    };
    attemptApply();
    return () => {
      cancelled = true;
    };
  }, [cameraPresetRequest?.runId, applyCameraPreset, dimensions.height, dimensions.width]);

  useEffect(() => {
    if (!cameraJumpRequest) return;
    let cancelled = false;
    const attemptJump = () => {
      if (cancelled) return;
      const graph = graphRef.current;
      if (!graph) {
        requestAnimationFrame(attemptJump);
        return;
      }
      const dataSnapshot = graphDataRef.current;
      if (!dataSnapshot) {
        requestAnimationFrame(attemptJump);
        return;
      }
      const node = dataSnapshot.nodes.find(item => item.id === cameraJumpRequest.nodeId);
      if (!node || node.x === undefined || node.y === undefined) {
        requestAnimationFrame(attemptJump);
        return;
      }
      flyToNode(node, 750);
    };
    attemptJump();
    return () => {
      cancelled = true;
    };
  }, [cameraJumpRequest?.runId, flyToNode]);

  const highlightMode = focusMode === 'off' ? 'flow' : focusMode;
  const highlightNodeIds = useMemo(() => {
    if (!selectedNode) return null;
    return getFocusNodeIds(highlightMode, selectedNode.id, data.edges, focusHopCount);
  }, [selectedNode?.id, data.edges, highlightMode, focusHopCount]);
  const focusActive = Boolean(selectedNode && focusMode !== 'off' && highlightNodeIds);
  const drilldownFocusNodeIds = useMemo(() => {
    return buildDrilldownFocusNodeIds(data.nodes, data.edges, focusClusterIds);
  }, [data.nodes, data.edges, focusClusterIds]);
  const layeringActive = layeredLodEnabled && viewMode !== 'structured';
  const effectiveLayerSpacing = clampLayerSpacing(layerSpacing);
  const isExpandedNode = useCallback((node: Node) => {
    return expandedClusterIds?.has(node.id) ?? false;
  }, [expandedClusterIds]);
  const multiMembershipData = useMemo(() => {
    if (!groupingData) {
      return { map: new Map<string, string[]>(), activeSet: null };
    }
    const activeSet = groupingData.group_sets?.find(set => set.id === activeGroupingMode) || null;
    if (!activeSet?.multi_membership) {
      return { map: new Map<string, string[]>(), activeSet };
    }
    const map = new Map<string, string[]>();
    groupingData.groups
      .filter(group => group.group_set === activeGroupingMode)
      .forEach(group => {
        group.nodes.forEach(nodeId => {
          const existing = map.get(nodeId);
          if (existing) {
            if (!existing.includes(group.label)) {
              existing.push(group.label);
            }
          } else {
            map.set(nodeId, [group.label]);
          }
        });
      });
    return { map, activeSet };
  }, [groupingData, activeGroupingMode]);
  const multiMembershipMap = multiMembershipData.map;
  const multiMembershipActive = Boolean(showMultiMembership && multiMembershipData.activeSet?.multi_membership);
  const multiMembershipLabel = multiMembershipData.activeSet?.label || 'Groups';

  const canUseLayoutCache = Boolean(layoutCacheKey) && !focusActive;
  const persistLayoutCache = useCallback((force = false) => {
    if (!layoutCacheKey || !canUseLayoutCache) return;
    const now = performance.now();
    if (!force && now - lastCacheWriteRef.current < 5000) return;
    lastCacheWriteRef.current = now;
    saveLayoutCache(layoutCacheKey, nodePositions.current);
  }, [layoutCacheKey, canUseLayoutCache]);

  const updateLabelVisibility = useCallback(() => {
    const graph = graphRef.current;
    const camera = graph?.camera() as THREE.Camera | undefined;
    if (!graph || !camera) return;
    const exportState = exportRenderStateRef.current;
    const exportLabels = Boolean(exportState?.showLabels);
    if (enablePerformanceMode && !exportLabels) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;
    const shouldShow = exportState ? exportState.showLabels : (!enableMotionOptimizations || !reduceDetail);
    const restrictToHighlight = Boolean(selectedNode && selectedNode.kind !== 'cluster' && focusMode === 'off' && highlightNodeIds);
    const dimClusterLabels = Boolean(drilldownFocusNodeIds && dimDrilldownLabels);
    if (!shouldShow && labelVisibilityModeRef.current === 'hidden') return;
    camera.updateMatrixWorld();
    const projScreenMatrix = projScreenMatrixRef.current;
    projScreenMatrix.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const frustum = frustumRef.current;
    frustum.setFromProjectionMatrix(projScreenMatrix);
    const tempVector = tempVectorRef.current;
    const tempVectorB = tempVectorBRef.current;
    const tempVectorC = tempVectorCRef.current;
    const rightVec = cameraRightRef.current;
    const upVec = cameraUpRef.current;
    rightVec.set(1, 0, 0).applyQuaternion(camera.quaternion);
    upVec.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const width = Math.max(1, dimensions.width);
    const height = Math.max(1, dimensions.height);

    const candidates: Node[] = [];
    let didChange = false;
    const setGlyphVisibility = (nodeId: string, visible: boolean) => {
      const glyph = glyphCache.current.get(nodeId);
      if (glyph && glyph.visible !== visible) {
        glyph.visible = visible;
        didChange = true;
      }
    };

    dataSnapshot.nodes.forEach(node => {
      const sprite = labelCache.current.get(node.id);
      if (!sprite) return;
      const allowLabel = shouldShow
        && (!restrictToHighlight || highlightNodeIds?.has(node.id));
      if (!allowLabel) {
        if (sprite.visible) {
          sprite.visible = false;
          didChange = true;
        }
        const showGlyph = exportState ? exportState.showNodes : false;
        setGlyphVisibility(node.id, showGlyph);
        return;
      }
      tempVector.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
      const inView = exportLabels && exportOrthographicRef.current
        ? true
        : frustum.containsPoint(tempVector);
      if (!inView) {
        if (sprite.visible) {
          sprite.visible = false;
          didChange = true;
        }
        const showGlyph = exportState ? exportState.showNodes : false;
        setGlyphVisibility(node.id, showGlyph);
        return;
      }
      candidates.push(node);
    });

    const activeLabelBucket = labelBucketRef.current;
    const labelBudgetBase = getLabelBudgetForBucket(activeLabelBucket, dataSnapshot.nodes.length);
    const labelBudget = exportLabels
      ? Math.min(dataSnapshot.nodes.length, Math.max(140, labelBudgetBase * 2))
      : labelBudgetBase;
    const ranked = candidates
      .map(node => ({
        node,
        rank: getLabelRank(node, selectedNode?.id, highlightNodeIds || undefined, activeLabelBucket)
      }))
      .sort((a, b) => compareLabelRank(a.rank, b.rank));

    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let shown = 0;

    const projectToScreen = (vector: THREE.Vector3) => {
      vector.project(camera);
      return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (-vector.y * 0.5 + 0.5) * height
      };
    };

    const collides = (bounds: { x1: number; y1: number; x2: number; y2: number }) => {
      return placed.some(other =>
        !(bounds.x2 < other.x1 || bounds.x1 > other.x2 || bounds.y2 < other.y1 || bounds.y1 > other.y2)
      );
    };

    ranked.forEach(entry => {
      const node = entry.node;
      const sprite = labelCache.current.get(node.id);
      if (!sprite) return;
      const force = shouldForceLabel(node, selectedNode?.id, activeLabelBucket);
      if (!force && shown >= labelBudget) {
        if (sprite.visible) {
          sprite.visible = false;
          didChange = true;
        }
        setGlyphVisibility(node.id, false);
        return;
      }
      const labelSize = sprite.userData.labelSize || { width: 12, height: 6 };
      const halfW = labelSize.width / 2;
      const halfH = labelSize.height / 2;
      const center = tempVectorB.set(node.x ?? 0, node.y ?? 0, node.z ?? 0).add(sprite.position);

      tempVectorC.copy(center).addScaledVector(rightVec, halfW).addScaledVector(upVec, halfH);
      const corner1 = projectToScreen(tempVectorC);
      tempVector.copy(center).addScaledVector(rightVec, -halfW).addScaledVector(upVec, -halfH);
      const corner2 = projectToScreen(tempVector);

      const padding = 2;
      const bounds = {
        x1: Math.min(corner1.x, corner2.x) - padding,
        y1: Math.min(corner1.y, corner2.y) - padding,
        x2: Math.max(corner1.x, corner2.x) + padding,
        y2: Math.max(corner1.y, corner2.y) + padding
      };

      if (!force && collides(bounds)) {
        if (sprite.visible) {
          sprite.visible = false;
          didChange = true;
        }
        setGlyphVisibility(node.id, false);
        return;
      }
      if (!sprite.visible) {
        sprite.visible = true;
        didChange = true;
      }
      const material = sprite.material as THREE.SpriteMaterial;
      const targetOpacity = dimClusterLabels && drilldownFocusNodeIds && !drilldownFocusNodeIds.has(node.id) ? 0.12 : 1;
      if (material.opacity !== targetOpacity) {
        material.opacity = targetOpacity;
        material.needsUpdate = true;
        didChange = true;
      }
      const showGlyph = exportState ? exportState.showNodes : true;
      setGlyphVisibility(node.id, showGlyph);
      placed.push(bounds);
      shown += 1;
    });

    labelVisibilityModeRef.current = shouldShow ? 'frustum' : 'hidden';
    if (didChange) {
      graph.refresh();
    }
  }, [enableMotionOptimizations, enablePerformanceMode, reduceDetail, selectedNode, focusMode, highlightNodeIds, drilldownFocusNodeIds, dimDrilldownLabels, zoomLevel, dimensions.width, dimensions.height, labelBucket]);

  const scheduleLabelVisibilityUpdate = useCallback(() => {
    const exportLabels = exportRenderStateRef.current?.showLabels;
    if (enablePerformanceMode && !exportLabels) return;
    if (exportLabels) {
      updateLabelVisibility();
      return;
    }
    const now = performance.now();
    const elapsed = now - lastLabelUpdateRef.current;
    const interval = labelUpdateIntervalRef.current;
    if (elapsed < interval) {
      if (labelUpdateTimeoutRef.current !== null) return;
      labelUpdateTimeoutRef.current = window.setTimeout(() => {
        labelUpdateTimeoutRef.current = null;
        scheduleLabelVisibilityUpdate();
      }, interval - elapsed);
      return;
    }
    if (labelUpdateFrameRef.current !== null) return;
    labelUpdateFrameRef.current = window.requestAnimationFrame(() => {
      labelUpdateFrameRef.current = null;
      lastLabelUpdateRef.current = performance.now();
      updateLabelVisibility();
    });
  }, [enablePerformanceMode, updateLabelVisibility]);

  const runExportPipeline = useCallback(async (request: ExportRequest) => {
    if (exportInProgressRef.current) {
      onExportStatus?.({ state: 'error', requestId: request.id, message: 'Export already in progress.' });
      onExportRequestHandled?.(request.id);
      return;
    }
    const graph = graphRef.current;
    if (!graph) {
      onExportStatus?.({ state: 'error', requestId: request.id, message: 'Graph is not ready yet.' });
      onExportRequestHandled?.(request.id);
      return;
    }
    exportInProgressRef.current = true;
    onExportStatus?.({ state: 'running', requestId: request.id, message: 'Preparing export...' });

    const renderer = graph.renderer();
    const scene = graph.scene();
    const controls = graph.controls() as any;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevPixelRatio = renderer.getPixelRatio();
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const prevCameraPosition = camera.position.clone();
    const prevTarget = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
    const prevAspect = camera.aspect;
    const overlayGroup = overlayGroupRef.current;
    const overlayWasVisible = overlayGroup?.visible ?? true;

    const wasPaused = animationPausedRef.current;
    pauseAnimation();

    if (overlayGroup) overlayGroup.visible = false;

    const options = request.options;
    const exportWidth = Math.max(1, Math.floor(options.width));
    const exportHeight = Math.max(1, Math.floor(options.height));
    exportOrthographicRef.current = options.orthographic;

    let layoutSnapshot: Map<string, LayoutSnapshot> | null = null;
    if (options.useSeededLayout && viewMode === 'force') {
      layoutSnapshot = applySeededLayout(options.seed);
      graph.refresh();
    }

    renderer.setPixelRatio(1);
    renderer.setSize(exportWidth, exportHeight, false);
    camera.aspect = exportWidth / exportHeight;
    camera.updateProjectionMatrix();

    if (options.transparentBackground) {
      renderer.setClearColor(0x000000, 0);
    }

    let exportCamera: THREE.Camera = camera;
    let exportPoseTarget = prevTarget;
    const exportPose = computeCameraPose(options.preset, exportWidth / exportHeight);
    if (exportPose) {
      camera.up.copy(exportPose.up);
      graph.cameraPosition({
        x: exportPose.position.x,
        y: exportPose.position.y,
        z: exportPose.position.z
      }, {
        x: exportPose.target.x,
        y: exportPose.target.y,
        z: exportPose.target.z
      }, 0);
      exportPoseTarget = exportPose.target;
    }

    if (options.orthographic) {
      const ortho = createOrthographicCamera(options.preset, exportWidth, exportHeight);
      if (ortho?.camera) {
        exportCamera = ortho.camera;
        exportPoseTarget = ortho.pose.target;
      }
    }

    if (controls?.target) {
      controls.target.copy(exportPoseTarget);
      if (controls.update) controls.update();
    }

    const baseName = `codebase-${options.preset}-${options.orthographic ? 'ortho' : 'persp'}-${exportWidth}x${exportHeight}`;
    const passOrder: ExportPass[] = ['nodes', 'edges', 'labels', 'highlights', 'heatmap'];
    const selectedPasses = passOrder.filter(pass => options.passes.includes(pass));
    const skipped: string[] = [];

    const passes = selectedPasses.filter(pass => {
      if (pass === 'highlights' && !selectedNode) {
        skipped.push('highlights');
        return false;
      }
      return true;
    });

    const downloadDataUrl = (dataUrl: string, filename: string) => {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      link.click();
    };

    try {
      for (const pass of passes) {
        const colorMode = pass === 'heatmap' ? getHeatmapColorMode() : null;
        const nextState: ExportRenderState = {
          pass,
          showNodes: pass !== 'edges' && pass !== 'labels',
          showLinks: pass === 'edges' || pass === 'highlights',
          showLabels: pass === 'labels',
          highlightOnly: pass === 'highlights',
          nodeOpacity: pass === 'edges' || pass === 'labels' ? 0 : 1,
          linkOpacity: pass === 'nodes' || pass === 'labels' || pass === 'heatmap' ? 0 : 1,
          colorMode,
          transparentBackground: options.transparentBackground
        };
        setExportRenderState(nextState);
        await waitForFrames(2);
        scheduleLabelVisibilityUpdate();
        graph.refresh();
        await waitForFrames(2);

        renderer.render(scene, exportCamera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        downloadDataUrl(dataUrl, `${baseName}-${pass}.png`);
      }

      onExportStatus?.({
        state: 'done',
        requestId: request.id,
        message: `Exported ${passes.length} pass(es).${skipped.length ? ' Skipped: ' + skipped.join(', ') : ''}`
      });
    } catch (err) {
      console.error('Export failed', err);
      onExportStatus?.({
        state: 'error',
        requestId: request.id,
        message: err instanceof Error ? err.message : 'Export failed.'
      });
    } finally {
      exportOrthographicRef.current = false;
      setExportRenderState(null);
      await waitForFrames(1);
      scheduleLabelVisibilityUpdate();
      if (overlayGroup) overlayGroup.visible = overlayWasVisible;
      if (layoutSnapshot) {
        restoreSeededLayout(layoutSnapshot);
        graph.refresh();
      }
      renderer.setPixelRatio(prevPixelRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      graph.cameraPosition({
        x: prevCameraPosition.x,
        y: prevCameraPosition.y,
        z: prevCameraPosition.z
      }, {
        x: prevTarget.x,
        y: prevTarget.y,
        z: prevTarget.z
      }, 0);
      if (controls?.target) {
        controls.target.copy(prevTarget);
        if (controls.update) controls.update();
      }
      if (!wasPaused) {
        resumeAnimation();
      }
      exportInProgressRef.current = false;
      onExportRequestHandled?.(request.id);
    }
  }, [
    applySeededLayout,
    computeCameraPose,
    createOrthographicCamera,
    getHeatmapColorMode,
    onExportRequestHandled,
    onExportStatus,
    restoreSeededLayout,
    scheduleLabelVisibilityUpdate,
    selectedNode,
    viewMode,
    waitForFrames,
    pauseAnimation,
    resumeAnimation
  ]);

  useEffect(() => {
    if (!exportRequest) return;
    runExportPipeline(exportRequest);
  }, [exportRequest?.id, runExportPipeline]);

  const ensureOverlayGroups = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return null;
    if (overlayGroupRef.current) {
      if (!lodPlaneOverlayRef.current) {
        const lodPlaneGroup = new THREE.Group();
        lodPlaneGroup.name = 'lod-plane-overlays';
        overlayGroupRef.current.add(lodPlaneGroup);
        lodPlaneOverlayRef.current = lodPlaneGroup;
      }
      return overlayGroupRef.current;
    }
    const scene = graph.scene();
    const overlayGroup = new THREE.Group();
    overlayGroup.name = 'graph-overlays';
    const lodPlaneGroup = new THREE.Group();
    lodPlaneGroup.name = 'lod-plane-overlays';
    const clusterGroup = new THREE.Group();
    clusterGroup.name = 'cluster-overlays';
    const moduleGroup = new THREE.Group();
    moduleGroup.name = 'module-overlays';
    const headerGroup = new THREE.Group();
    headerGroup.name = 'header-overlays';
    overlayGroup.add(lodPlaneGroup);
    overlayGroup.add(clusterGroup);
    overlayGroup.add(moduleGroup);
    overlayGroup.add(headerGroup);
    scene.add(overlayGroup);
    overlayGroupRef.current = overlayGroup;
    lodPlaneOverlayRef.current = lodPlaneGroup;
    clusterOverlayRef.current = clusterGroup;
    moduleOverlayRef.current = moduleGroup;
    headerOverlayRef.current = headerGroup;
    return overlayGroup;
  }, []);

  const disposeSprite = (sprite: THREE.Sprite) => {
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map) material.map.dispose();
    material.dispose();
  };

  const disposeLine = (line: THREE.Line) => {
    line.geometry.dispose();
    const material = line.material;
    if (Array.isArray(material)) {
      material.forEach(item => item.dispose());
    } else {
      material.dispose();
    }
  };

  const disposeMesh = (mesh: THREE.Mesh) => {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach(item => item.dispose());
    } else {
      material.dispose();
    }
  };

  const updateStructuredHeaders = useCallback(() => {
    ensureOverlayGroups();
    const headerGroup = headerOverlayRef.current;
    if (!headerGroup) return;
    const isStructured = viewMode === 'structured';
    headerGroup.visible = isStructured;
    if (!isStructured) return;
    if (!dimensions.width || !dimensions.height) return;
    if (headerLabelCache.current.length !== STRUCTURED_HEADERS.length) {
      headerLabelCache.current.forEach(sprite => {
        headerGroup.remove(sprite);
        disposeSprite(sprite);
      });
      headerLabelCache.current = STRUCTURED_HEADERS.map(label => {
        const sprite = createHeaderSprite(label);
        headerGroup.add(sprite);
        return sprite;
      });
    }
    const colWidth = dimensions.width / (STRUCTURED_HEADERS.length + 1);
    const startX = colWidth * 0.8;
    headerLabelCache.current.forEach((sprite, idx) => {
      sprite.position.set(startX + (idx * colWidth), 30, 0);
    });
    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, [dimensions.width, dimensions.height, ensureOverlayGroups, viewMode]);

  const updateLodPlanes = useCallback(() => {
    ensureOverlayGroups();
    const planeGroup = lodPlaneOverlayRef.current;
    if (!planeGroup) return;
    const shouldShow = layeringActive && showLodPlanes;
    planeGroup.visible = shouldShow;
    if (!shouldShow) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;

    const depthSet = new Set<number>();
    dataSnapshot.nodes.forEach(node => {
      depthSet.add(getNodeLodDepth(node));
    });
    const depths = Array.from(depthSet).sort((a, b) => a - b);
    if (!depths.length) {
      planeGroup.visible = false;
      return;
    }

    const bounds = getGraphBounds();
    if (!bounds) return;
    const padding = Math.max(140, Math.min(bounds.size.x, bounds.size.y) * 0.25);
    const width = Math.max(200, bounds.size.x + padding);
    const height = Math.max(200, bounds.size.y + padding);

    const activeDepths = new Set(depths);
    lodPlaneOverlayCache.current.forEach((entry, depth) => {
      if (activeDepths.has(depth)) return;
      planeGroup.remove(entry.plane);
      planeGroup.remove(entry.label);
      disposeMesh(entry.plane);
      disposeSprite(entry.label);
      lodPlaneOverlayCache.current.delete(depth);
    });

    depths.forEach(depth => {
      const planeColor = getLodPlaneColor(depth);
      const labelText = `LOD${depth}`;
      let entry = lodPlaneOverlayCache.current.get(depth);
      if (!entry) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(planeColor),
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.renderOrder = -1;
        const label = createLodPlaneLabelSprite(labelText, planeColor);
        label.renderOrder = 2;
        label.userData.text = labelText;
        label.userData.color = planeColor;
        planeGroup.add(plane);
        planeGroup.add(label);
        entry = { plane, label };
        lodPlaneOverlayCache.current.set(depth, entry);
      } else if (entry.label.userData.text !== labelText || entry.label.userData.color !== planeColor) {
        planeGroup.remove(entry.label);
        disposeSprite(entry.label);
        const label = createLodPlaneLabelSprite(labelText, planeColor);
        label.renderOrder = 2;
        label.userData.text = labelText;
        label.userData.color = planeColor;
        planeGroup.add(label);
        entry.label = label;
      }

      const material = entry.plane.material as THREE.MeshBasicMaterial;
      material.color.set(planeColor);
      material.opacity = 0.08;

      const planeZ = -depth * effectiveLayerSpacing;
      entry.plane.position.set(bounds.center.x, bounds.center.y, planeZ);
      entry.plane.scale.set(width, height, 1);
      const labelOffsetX = -(width * 0.5) + 24;
      const labelOffsetY = (height * 0.5) - 24;
      entry.label.position.set(bounds.center.x + labelOffsetX, bounds.center.y + labelOffsetY, planeZ + 8);
      entry.label.material.opacity = 0.9;
    });

    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, [ensureOverlayGroups, effectiveLayerSpacing, getGraphBounds, layeringActive, showLodPlanes]);

  const updateClusterOverlays = useCallback(() => {
    ensureOverlayGroups();
    const clusterGroup = clusterOverlayRef.current;
    if (!clusterGroup) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;

    const clusterNodes = dataSnapshot.nodes.filter(node => node.kind === 'cluster');
    if (!clusterNodes.length) {
      clusterGroup.visible = false;
      return;
    }
    clusterGroup.visible = true;

    const clusterIds = new Set<string>(clusterNodes.map(node => node.cluster_id || node.id));
    const clusterNodeMap = new Map<string, Node>(clusterNodes.map(node => [node.cluster_id || node.id, node]));
    const membersByCluster = new Map<string, Node[]>();
    clusterIds.forEach(id => membersByCluster.set(id, []));

    dataSnapshot.nodes.forEach(node => {
      if (!node.cluster_path) return;
      node.cluster_path.forEach(clusterId => {
        const bucket = membersByCluster.get(clusterId);
        if (bucket) bucket.push(node);
      });
    });

    const dimmed = Boolean(selectedNode && focusMode === 'off');
    const focusActive = focusClusterIds !== null && focusClusterIds.size > 0;

    clusterOverlayCache.current.forEach((entry, key) => {
      if (clusterIds.has(key)) return;
      clusterGroup.remove(entry.box);
      clusterGroup.remove(entry.label);
      disposeLine(entry.box);
      disposeSprite(entry.label);
      clusterOverlayCache.current.delete(key);
    });

    clusterIds.forEach(clusterId => {
      const clusterNode = clusterNodeMap.get(clusterId);
      const members = membersByCluster.get(clusterId) || [];
      if (members.length === 0) {
        const existing = clusterOverlayCache.current.get(clusterId);
        if (existing) {
          clusterGroup.remove(existing.box);
          clusterGroup.remove(existing.label);
          disposeLine(existing.box);
          disposeSprite(existing.label);
          clusterOverlayCache.current.delete(clusterId);
        }
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      members.forEach(node => {
        if (node.x === undefined || node.y === undefined) return;
        const z = node.z ?? 0;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, node.x);
        maxY = Math.max(maxY, node.y);
        maxZ = Math.max(maxZ, z);
      });

      const memberCount = (clusterNode?.member_count ?? members.length) || 1;
      const pad = 48 + Math.min(240, Math.log1p(memberCount) * 28);
      const padZ = Math.max(36, Math.min(160, pad * 1.2));

      if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
        if (clusterNode?.x === undefined || clusterNode?.y === undefined) return;
        const fallbackZ = clusterNode.z ?? 0;
        minX = clusterNode.x - pad;
        maxX = clusterNode.x + pad;
        minY = clusterNode.y - pad;
        maxY = clusterNode.y + pad;
        minZ = fallbackZ - padZ;
        maxZ = fallbackZ + padZ;
      } else {
        minX -= pad;
        minY -= pad;
        maxX += pad;
        maxY += pad;
        minZ -= padZ;
        maxZ += padZ;
      }

      const focused = focusClusterIds?.has(clusterId) ?? false;
      const lineOpacity = focusActive
        ? (focused ? (dimmed ? 0.2 : 0.55) : (dimmed ? 0.06 : 0.18))
        : (dimmed ? 0.1 : 0.3);
      const labelOpacity = focusActive
        ? (focused ? (dimmed ? 0.45 : 0.9) : (dimmed ? 0.15 : 0.55))
        : (dimmed ? 0.25 : 0.75);
      const strokeColor = focused ? 0x38bdf8 : 0x1e293b;
      const labelText = clusterNode?.label_short || clusterNode?.label || clusterId;

      let entry = clusterOverlayCache.current.get(clusterId);
      if (!entry) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(72);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: strokeColor,
          transparent: true,
          opacity: lineOpacity,
          depthWrite: false
        });
        const box = new THREE.LineSegments(geometry, material);
        box.renderOrder = 1;
        const label = createClusterLabelSprite(labelText, focused);
        label.renderOrder = 3;
        label.userData.text = labelText;
        clusterGroup.add(box);
        clusterGroup.add(label);
        entry = { box, label, focused };
        clusterOverlayCache.current.set(clusterId, entry);
      } else {
        if (entry.focused !== focused || entry.label.userData.text !== labelText) {
          clusterGroup.remove(entry.label);
          disposeSprite(entry.label);
          const label = createClusterLabelSprite(labelText, focused);
          label.renderOrder = 2;
          label.userData.text = labelText;
          clusterGroup.add(label);
          entry.label = label;
          entry.focused = focused;
        }
        const material = entry.box.material as THREE.LineBasicMaterial;
        material.color.setHex(strokeColor);
        material.opacity = lineOpacity;
      }

      const geometry = entry.box.geometry as THREE.BufferGeometry;
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      array.set([
        minX, minY, minZ, maxX, minY, minZ,
        maxX, minY, minZ, maxX, maxY, minZ,
        maxX, maxY, minZ, minX, maxY, minZ,
        minX, maxY, minZ, minX, minY, minZ,
        minX, minY, maxZ, maxX, minY, maxZ,
        maxX, minY, maxZ, maxX, maxY, maxZ,
        maxX, maxY, maxZ, minX, maxY, maxZ,
        minX, maxY, maxZ, minX, minY, maxZ,
        minX, minY, minZ, minX, minY, maxZ,
        maxX, minY, minZ, maxX, minY, maxZ,
        maxX, maxY, minZ, maxX, maxY, maxZ,
        minX, maxY, minZ, minX, maxY, maxZ
      ]);
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();

      entry.label.material.opacity = labelOpacity;
      entry.label.position.set(minX + 12, maxY + 16, maxZ + 10);
    });

    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, [ensureOverlayGroups, focusClusterIds, focusMode, selectedNode]);

  const updateModuleOverlays = useCallback(() => {
    if (viewMode !== 'hierarchical') {
      if (moduleOverlayRef.current) moduleOverlayRef.current.visible = false;
      return;
    }
    ensureOverlayGroups();
    const moduleGroup = moduleOverlayRef.current;
    if (!moduleGroup) return;
    moduleGroup.visible = true;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;

    const boundsMap = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    dataSnapshot.nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      const key = node.module || 'Other';
      const entry = boundsMap.get(key) || {
        minX: node.x,
        minY: node.y,
        maxX: node.x,
        maxY: node.y
      };
      entry.minX = Math.min(entry.minX, node.x);
      entry.minY = Math.min(entry.minY, node.y);
      entry.maxX = Math.max(entry.maxX, node.x);
      entry.maxY = Math.max(entry.maxY, node.y);
      boundsMap.set(key, entry);
    });

    const dimmed = Boolean(selectedNode && focusMode === 'off');
    const boxOpacity = dimmed ? 0.1 : 0.5;
    const labelOpacity = dimmed ? 0.2 : 0.8;

    moduleOverlayCache.current.forEach((entry, key) => {
      if (boundsMap.has(key)) return;
      moduleGroup.remove(entry.box);
      moduleGroup.remove(entry.label);
      disposeLine(entry.box);
      disposeSprite(entry.label);
      moduleOverlayCache.current.delete(key);
    });

    boundsMap.forEach((bounds, key) => {
      let entry = moduleOverlayCache.current.get(key);
      if (!entry) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(15);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: 0x334155,
          transparent: true,
          opacity: boxOpacity
        });
        const box = new THREE.LineLoop(geometry, material);
        box.renderOrder = 1;
        const label = createModuleLabelSprite(key);
        label.renderOrder = 2;
        moduleGroup.add(box);
        moduleGroup.add(label);
        entry = { box, label };
        moduleOverlayCache.current.set(key, entry);
      }

      const pad = 25;
      const boxX = bounds.minX - pad;
      const boxY = bounds.minY - pad - 10;
      const boxW = Math.max(50, (bounds.maxX - bounds.minX) + (pad * 2));
      const boxH = Math.max(50, (bounds.maxY - bounds.minY) + (pad * 2) + 10);
      const x1 = boxX;
      const y1 = boxY;
      const x2 = boxX + boxW;
      const y2 = boxY + boxH;

      const geometry = entry.box.geometry as THREE.BufferGeometry;
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      array[0] = x1; array[1] = y1; array[2] = 0;
      array[3] = x2; array[4] = y1; array[5] = 0;
      array[6] = x2; array[7] = y2; array[8] = 0;
      array[9] = x1; array[10] = y2; array[11] = 0;
      array[12] = x1; array[13] = y1; array[14] = 0;
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();

      const material = entry.box.material as THREE.LineBasicMaterial;
      material.opacity = boxOpacity;
      entry.label.material.opacity = labelOpacity;
      entry.label.position.set(boxX + 10, boxY + 15, 0);
    });
    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, [ensureOverlayGroups, focusMode, selectedNode, viewMode]);

  const handleEngineTick = useCallback(() => {
    if (!graphReadyRef.current) {
      graphReadyRef.current = true;
    }
    if (pendingReheatRef.current) {
      const graph = graphRef.current;
      if (graph) {
        pendingReheatRef.current = false;
        graph.d3ReheatSimulation();
      }
    }
    const now = performance.now();
    if (now - labelTickRef.current > 300) {
      labelTickRef.current = now;
      scheduleLabelVisibilityUpdate();
    }
    if (now - lodPlaneTickRef.current > 480) {
      lodPlaneTickRef.current = now;
      updateLodPlanes();
    }
    if (now - clusterOverlayTickRef.current > 240) {
      clusterOverlayTickRef.current = now;
      updateClusterOverlays();
    }
    if (viewMode === 'hierarchical' && now - overlayTickRef.current > 220) {
      overlayTickRef.current = now;
      updateModuleOverlays();
    }
    if (now - positionTickRef.current > 800) {
      positionTickRef.current = now;
      const dataSnapshot = graphDataRef.current;
      if (!dataSnapshot) return;
      dataSnapshot.nodes.forEach(node => {
        if (node.x === undefined || node.y === undefined) return;
        nodePositions.current.set(node.id, {
          x: node.x,
          y: node.y,
          z: node.z ?? 0,
          vx: node.vx,
          vy: node.vy,
          vz: node.vz
        });
      });
      persistLayoutCache();
    }
  }, [persistLayoutCache, scheduleLabelVisibilityUpdate, updateClusterOverlays, updateLodPlanes, updateModuleOverlays, viewMode]);

  const handleEngineStop = useCallback(() => {
    scheduleLabelVisibilityUpdate();
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;
    dataSnapshot.nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      nodePositions.current.set(node.id, {
        x: node.x,
        y: node.y,
        z: node.z ?? 0,
        vx: node.vx,
        vy: node.vy,
        vz: node.vz
      });
    });
    persistLayoutCache(true);
    if (viewMode === 'hierarchical') {
      updateModuleOverlays();
    }
    updateLodPlanes();
    updateClusterOverlays();
    pauseAnimation();
  }, [pauseAnimation, persistLayoutCache, scheduleLabelVisibilityUpdate, updateClusterOverlays, updateLodPlanes, updateModuleOverlays, viewMode]);

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

  useEffect(() => {
    return () => {
      if (interactionTimeoutRef.current) {
        window.clearTimeout(interactionTimeoutRef.current);
      }
      if (labelUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(labelUpdateFrameRef.current);
      }
      if (labelUpdateTimeoutRef.current !== null) {
        window.clearTimeout(labelUpdateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      const graph = graphRef.current;
      if (!graph) return;
      try {
        graph.pauseAnimation();
      } catch {
        // Ignore teardown errors on hot reload.
      }
      const controls = graph.controls() as any;
      if (controls?.dispose) controls.dispose();
      if (overlayGroupRef.current) {
        graph.scene().remove(overlayGroupRef.current);
      }
      lodPlaneOverlayCache.current.forEach(entry => {
        disposeMesh(entry.plane);
        disposeSprite(entry.label);
      });
      lodPlaneOverlayCache.current.clear();
      clusterOverlayCache.current.forEach(entry => {
        disposeLine(entry.box);
        disposeSprite(entry.label);
      });
      clusterOverlayCache.current.clear();
      moduleOverlayCache.current.forEach(entry => {
        disposeLine(entry.box);
        disposeSprite(entry.label);
      });
      moduleOverlayCache.current.clear();
      headerLabelCache.current.forEach(sprite => {
        disposeSprite(sprite);
      });
      headerLabelCache.current = [];
      overlayGroupRef.current = null;
      lodPlaneOverlayRef.current = null;
      clusterOverlayRef.current = null;
      moduleOverlayRef.current = null;
      headerOverlayRef.current = null;
      const renderer = graph.renderer();
      renderer.dispose();
      if ((renderer as any).forceContextLoss) {
        (renderer as any).forceContextLoss();
      }
      labelCache.current.forEach(sprite => disposeSprite(sprite));
      glyphCache.current.forEach(sprite => disposeSprite(sprite));
      expandedHaloCache.current.forEach(sprite => disposeSprite(sprite));
      multiMembershipRingCache.current.forEach(rings => {
        rings.forEach(sprite => disposeSprite(sprite));
      });
      labelCache.current.clear();
      glyphCache.current.clear();
      expandedHaloCache.current.clear();
      multiMembershipRingCache.current.clear();
      nodeObjectCache.current.clear();
      nodePositions.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!enableMotionOptimizations) {
      setReduceDetail(false);
    }
  }, [enableMotionOptimizations]);

  useEffect(() => {
    if (enablePerformanceMode && !exportRenderState?.showLabels) return;
    scheduleLabelVisibilityUpdate();
  }, [enableMotionOptimizations, enablePerformanceMode, reduceDetail, scheduleLabelVisibilityUpdate, exportRenderState]);

  useEffect(() => {
    scheduleLabelVisibilityUpdate();
  }, [dimensions.width, dimensions.height, scheduleLabelVisibilityUpdate]);

  useEffect(() => {
    scheduleLabelVisibilityUpdate();
  }, [selectedNode?.id, focusMode, focusClusterIds, highlightNodeIds, drilldownFocusNodeIds, dimDrilldownLabels, labelBucket, scheduleLabelVisibilityUpdate]);

  useEffect(() => {
    updateStructuredHeaders();
  }, [updateStructuredHeaders]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onEscape) {
          onEscape();
        } else {
          onNodeSelect(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, onNodeSelect]);

  const visibleData = useMemo(() => {
    let nodes = data.nodes.map(n => {
      const cached = nodePositions.current.get(n.id);
      const base = { ...n };
      if (cached) {
        base.x = cached.x;
        base.y = cached.y;
        base.z = cached.z;
        base.vx = cached.vx;
        base.vy = cached.vy;
        base.vz = cached.vz;
      }
      return base;
    });
    let edges = data.edges.map(e => ({ ...e }));

    const visibleDegreeMap = new Map<string, number>();
    edges.forEach(e => {
      visibleDegreeMap.set(e.from, (visibleDegreeMap.get(e.from) || 0) + 1);
      visibleDegreeMap.set(e.to, (visibleDegreeMap.get(e.to) || 0) + 1);
    });

    nodes.forEach(n => {
      n.degree = visibleDegreeMap.get(n.id) || 0;
    });

    if (focusActive && highlightNodeIds) {
      const nodeSet = new Set(nodes.filter(n => highlightNodeIds.has(n.id)).map(n => n.id));
      nodes = nodes.filter(n => nodeSet.has(n.id));
      edges = edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));
    }

    if (!focusActive) {
      const drilldownNodeIds = buildDrilldownContextNodeIds(nodes, focusClusterIds, drilldownContext);
      if (drilldownNodeIds) {
        nodes = nodes.filter(node => drilldownNodeIds.has(node.id));
        edges = edges.filter(edge => drilldownNodeIds.has(edge.from) && drilldownNodeIds.has(edge.to));
      }
    }

    return { nodes, edges };
  }, [data, focusMode, focusActive, selectedNode?.id, highlightNodeIds, layoutCacheVersion, focusClusterIds, drilldownContext]);

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

    if (viewMode === 'force' && dimensions.width && dimensions.height) {
      const maxRadius = Math.min(dimensions.width, dimensions.height) * 0.45;
      nodes.forEach(node => {
        if (node.x === undefined || node.y === undefined || node.z === undefined) {
          const dir = getStableDirection(node.id);
          const radius = getBalloonRadius(node, maxRadius);
          if (node.x === undefined) node.x = dir.x * radius;
          if (node.y === undefined) node.y = dir.y * radius;
          if (node.z === undefined) node.z = dir.z * radius;
        }
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

    if (layeringActive) {
      nodes.forEach(node => {
        const targetZ = -getNodeLodDepth(node) * effectiveLayerSpacing;
        node.fz = targetZ;
        if (node.z === undefined || Number.isNaN(node.z)) node.z = targetZ;
        node.vz = 0;
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
  }, [visibleData, viewMode, dimensions.width, dimensions.height, moduleCenters, layeringActive, effectiveLayerSpacing]);

  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  useEffect(() => {
    updateLodPlanes();
  }, [graphData.nodes.length, graphData.links.length, updateLodPlanes]);

  useEffect(() => {
    setHoveredEdge(null);
  }, [graphData.nodes.length, graphData.links.length]);

  const edgePreview = useMemo(() => {
    if (!hoveredEdge?.aggregated || !hoveredEdge.members?.length) return null;
    const dataSnapshot = graphDataRef.current;
    const nodeLabels = new Map<string, string>();
    if (dataSnapshot) {
      dataSnapshot.nodes.forEach(node => {
        nodeLabels.set(node.id, getCleanLabel(node));
      });
    }
    const items = hoveredEdge.members.slice(0, 8).map(member => {
      const fromLabel = nodeLabels.get(member.from) || member.from;
      const toLabel = nodeLabels.get(member.to) || member.to;
      return {
        from: fromLabel,
        to: toLabel,
        type: member.type || hoveredEdge.type
      };
    });
    return {
      count: hoveredEdge.memberCount || hoveredEdge.weight || hoveredEdge.members.length,
      items
    };
  }, [hoveredEdge, graphData.nodes.length]);

  const edgePreviewPosition = useMemo(() => {
    if (!edgePreview) return null;
    const width = 260;
    const height = Math.min(260, 70 + edgePreview.items.length * 18);
    const padding = 12;
    const x = Math.min(pointerPosition.x + 16, Math.max(padding, dimensions.width - width - padding));
    const y = Math.min(pointerPosition.y + 16, Math.max(padding, dimensions.height - height - padding));
    return { x, y };
  }, [edgePreview, pointerPosition.x, pointerPosition.y, dimensions.width, dimensions.height]);

  useEffect(() => {
    updateModuleOverlays();
  }, [graphData.nodes.length, graphData.links.length, viewMode, updateModuleOverlays, selectedNode?.id, focusMode]);

  useEffect(() => {
    updateClusterOverlays();
  }, [graphData.nodes.length, graphData.links.length, updateClusterOverlays, focusClusterIds, selectedNode?.id, focusMode]);

  useEffect(() => {
    graphReadyRef.current = false;
    pendingReheatRef.current = false;
  }, [graphData.nodes.length, graphData.links.length]);

  useEffect(() => {
    const nodeCount = graphData.nodes.length;
    if (enablePerformanceMode) {
      labelUpdateIntervalRef.current = 1200;
      return;
    }
    if (!enableMotionOptimizations) {
      labelUpdateIntervalRef.current = 250;
      return;
    }
    if (reduceDetail) {
      labelUpdateIntervalRef.current = 900;
      return;
    }
    if (nodeCount > 3000) {
      labelUpdateIntervalRef.current = 1200;
    } else if (nodeCount > 1500) {
      labelUpdateIntervalRef.current = 700;
    } else if (nodeCount > 800) {
      labelUpdateIntervalRef.current = 400;
    } else {
      labelUpdateIntervalRef.current = 250;
    }
  }, [graphData.nodes.length, reduceDetail, enableMotionOptimizations, enablePerformanceMode]);

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

      if (chargeForce?.strength) {
        chargeForce.strength((node: Node) => {
          if (viewMode === 'structured') return 0;
          return getChargeStrength(node, viewMode);
        });
      }

      if (linkForce?.distance) {
        linkForce.distance((link: any) => getLinkDistance(link, viewMode));
      }

      graph.d3Force('center', null);

      if (viewMode === 'structured') {
        graph.d3Force('collide', null);
      } else {
        graph.d3Force('collide', forceCollide<Node>()
          .radius((node: Node) => {
            if (viewMode === 'structured') return 0;
            const extra = Math.log1p(node.degree || 0) * 5;
            return getNodeRadius(node) + 6 + extra;
          })
          .iterations(2)
          .strength(0.8));
      }

      if (viewMode === 'hierarchical' && moduleCenters) {
        graph.d3Force('module', createModuleForce(moduleCenters, getModulePullStrength));
        graph.d3Force('balloon', null);
        graph.d3Force('x', null);
        graph.d3Force('y', null);
        if (layeringActive) {
          graph.d3Force('z', forceZ<Node>()
            .z((node: Node) => -getNodeLodDepth(node) * effectiveLayerSpacing)
            .strength(0.08));
        } else {
          graph.d3Force('z', forceZ<Node>().z(0).strength(0.05));
        }
      } else if (viewMode === 'force' && dimensions.width && dimensions.height) {
        graph.d3Force('module', null);
        const maxRadius = Math.min(dimensions.width, dimensions.height) * 0.45;
        graph.d3Force('balloon', createBalloonForce(maxRadius, 0.12));
        graph.d3Force('x', null);
        graph.d3Force('y', null);
        if (layeringActive) {
          graph.d3Force('z', forceZ<Node>()
            .z((node: Node) => -getNodeLodDepth(node) * effectiveLayerSpacing)
            .strength(0.06));
        } else {
          graph.d3Force('z', null);
        }
      } else {
        graph.d3Force('module', null);
        graph.d3Force('balloon', null);
        graph.d3Force('x', null);
        graph.d3Force('y', null);
        graph.d3Force('z', null);
      }

      requestReheat();
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
    graphData.links.length,
    layeringActive,
    effectiveLayerSpacing,
    requestReheat
  ]);

  useEffect(() => {
    let disposed = false;
    let controls: any;
    const handleControlsChange = () => {
      resumeAnimation();
      updateCameraState();
      scheduleLabelVisibilityUpdate();
    };

    const attachControls = () => {
      if (disposed) return;
      controls = graphRef.current?.controls() as any;
      if (!controls) {
        requestAnimationFrame(attachControls);
        return;
      }
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.zoomSpeed = zoomSpeed;
      controls.panSpeed = panSpeed;
      controls.rotateSpeed = rotateSpeed;
      controls.screenSpacePanning = true;

      // Allow closer zoom and more pan range
      controls.minDistance = 10;
      controls.maxDistance = 10000;

      // Lock rotation in hierarchical (Systems) view
      controls.enableRotate = viewMode !== 'hierarchical';

      controls.addEventListener('change', handleControlsChange);
      handleControlsChange();
    };

    attachControls();

    return () => {
      disposed = true;
      if (controls) controls.removeEventListener('change', handleControlsChange);
    };
  }, [dimensions.width, dimensions.height, panSpeed, resumeAnimation, rotateSpeed, scheduleLabelVisibilityUpdate, updateCameraState, zoomSpeed, viewMode]);

  useEffect(() => {
    const controls = graphRef.current?.controls() as any;
    if (!controls) return;
    controls.zoomSpeed = zoomSpeed;
    controls.panSpeed = panSpeed;
    controls.rotateSpeed = rotateSpeed;
  }, [zoomSpeed, panSpeed, rotateSpeed]);

  useEffect(() => {
    labelCache.current.forEach(sprite => disposeSprite(sprite));
    glyphCache.current.forEach(sprite => disposeSprite(sprite));
    expandedHaloCache.current.forEach(sprite => disposeSprite(sprite));
    multiMembershipRingCache.current.forEach(rings => {
      rings.forEach(sprite => disposeSprite(sprite));
    });
    labelCache.current.clear();
    glyphCache.current.clear();
    expandedHaloCache.current.clear();
    multiMembershipRingCache.current.clear();
    nodeObjectCache.current.clear();
    graphRef.current?.refresh();
    scheduleLabelVisibilityUpdate();
  }, [
    graphData.nodes.length,
    enablePerformanceMode,
    scheduleLabelVisibilityUpdate,
    activeGroupingMode,
    multiMembershipActive,
    groupingData?.groups?.length
  ]);

  const nodeVal = useCallback((node: Node) => {
    const base = getNodeRadius(node);
    return selectedNode?.id === node.id ? base + 3 : base;
  }, [selectedNode?.id]);

  const nodeDepthMap = useMemo(() => {
    const map = new Map<string, number>();
    graphData.nodes.forEach(node => {
      map.set(node.id, getNodeLodDepth(node));
    });
    return map;
  }, [graphData.nodes]);

  const isCrossLayerEdge = useCallback((link: Edge) => {
    if (!layeringActive) return false;
    const srcId = getLinkEndpointId(link.source) || link.from;
    const tgtId = getLinkEndpointId(link.target) || link.to;
    const srcDepth = nodeDepthMap.get(srcId || '') ?? 0;
    const tgtDepth = nodeDepthMap.get(tgtId || '') ?? 0;
    return srcDepth !== tgtDepth;
  }, [layeringActive, nodeDepthMap]);

  const nodeTooltip = useCallback((node: Node) => {
    const base = `Type: ${node.type}\nID: ${node.id}\nVisible Connections: ${node.degree || 0}\nTotal Connections: ${node.totalDegree || 0}`;
    const memberships = multiMembershipMap.get(node.id);
    if (memberships && memberships.length > 1) {
      return `${base}\n${multiMembershipLabel}: ${memberships.join(', ')}`;
    }
    return base;
  }, [multiMembershipLabel, multiMembershipMap]);

  const linkTooltip = useCallback((link: Edge) => {
    if (link.aggregated) {
      const count = link.memberCount || link.weight || link.members?.length || 0;
      return `${link.type} (${count} edges)`;
    }
    return link.type;
  }, []);

  const nodeColor = useCallback((node: Node) => {
    const colorMode = exportRenderState?.colorMode || activeColorMode;
    const base = getNodeColor(node, colorMode, groupingData, gitMetadata);
    let alphaOverride: number | null = null;
    if (selectedNode && focusMode === 'off' && selectedNode.kind !== 'cluster' && highlightNodeIds) {
      if (!highlightNodeIds.has(node.id)) {
        alphaOverride = 0.12;
      }
    }
    if (drilldownFocusNodeIds && !drilldownFocusNodeIds.has(node.id)) {
      alphaOverride = alphaOverride === null ? 0.12 : Math.min(alphaOverride, 0.12);
    }
    if (isExpandedNode(node) && (!selectedNode || selectedNode.id !== node.id)) {
      alphaOverride = alphaOverride === null ? 0.45 : Math.min(alphaOverride, 0.45);
    }
    return alphaOverride === null ? base : toRgba(base, alphaOverride);
  }, [activeColorMode, groupingData, gitMetadata, selectedNode, focusMode, highlightNodeIds, drilldownFocusNodeIds, exportRenderState, isExpandedNode]);

  const linkColor = useCallback((link: Edge) => {
    const base = EDGE_STYLES[link.type]?.stroke || EDGE_STYLES.default.stroke;
    let alpha = 0.4;
    if (exportRenderState?.showLinks && !exportRenderState.highlightOnly) {
      alpha = 0.75;
    } else if (!selectedNode) {
      alpha = 0.4;
    } else if (focusMode !== 'off') {
      alpha = 0.85;
    } else if (selectedNode.kind === 'cluster') {
      alpha = 0.4;
    } else {
      const srcId = getLinkEndpointId(link.source);
      const tgtId = getLinkEndpointId(link.target);
      if (highlightNodeIds?.has(srcId || '') && highlightNodeIds?.has(tgtId || '')) {
        alpha = 0.85;
      } else {
        alpha = 0.05;
      }
    }

    if (drilldownFocusNodeIds) {
      const srcId = getLinkEndpointId(link.source);
      const tgtId = getLinkEndpointId(link.target);
      const inCluster = drilldownFocusNodeIds.has(srcId || '') && drilldownFocusNodeIds.has(tgtId || '');
      if (!inCluster) {
        alpha = Math.min(alpha, 0.05);
      }
    }

    if (isCrossLayerEdge(link)) {
      alpha = Math.min(1, alpha + 0.2);
    }

    return toRgba(base, alpha);
  }, [selectedNode, focusMode, highlightNodeIds, drilldownFocusNodeIds, exportRenderState, isCrossLayerEdge]);

  const nodeThreeObject = useCallback((node: Node) => {
    const cached = nodeObjectCache.current.get(node.id);
    if (cached) {
      const labelSprite = labelCache.current.get(node.id);
      if (labelSprite) labelSprite.visible = true;
      const halo = expandedHaloCache.current.get(node.id);
      const isExpanded = isExpandedNode(node);
      if (halo) {
        halo.visible = isExpanded;
      } else if (isExpanded) {
        const radius = getNodeRadius(node) + 10;
        const haloSprite = createExpandedHaloSprite(radius);
        if (haloSprite) {
          haloSprite.visible = true;
          expandedHaloCache.current.set(node.id, haloSprite);
          (cached as THREE.Group).add(haloSprite);
        }
      }
      return cached;
    }
    const group = new THREE.Group();
    const labelSprite = createLabelSprite(getCleanLabel(node));
    labelSprite.visible = true;
    labelCache.current.set(node.id, labelSprite);
    group.add(labelSprite);

    if (isExpandedNode(node)) {
      const radius = getNodeRadius(node) + 10;
      const haloSprite = createExpandedHaloSprite(radius);
      if (haloSprite) {
        haloSprite.visible = true;
        expandedHaloCache.current.set(node.id, haloSprite);
        group.add(haloSprite);
      }
    }

    const showExpandGlyph = Boolean(node.canExpand ?? (node.kind && CLUSTER_KINDS.has(node.kind)));
    if (showExpandGlyph) {
      const glyphSprite = createClusterGlyphSprite(node);
      if (glyphSprite) {
        glyphSprite.visible = true;
        glyphCache.current.set(node.id, glyphSprite);
        group.add(glyphSprite);
      }
    }

    if (multiMembershipActive) {
      const memberships = multiMembershipMap.get(node.id);
      if (memberships && memberships.length > 1) {
        const ringCount = Math.min(MAX_MULTI_MEMBERSHIP_RINGS, memberships.length);
        const baseRadius = getNodeRadius(node);
        const ringStart = baseRadius + 6;
        const ringStep = 3.5;
        const rings: THREE.Sprite[] = [];
        for (let i = 0; i < ringCount; i += 1) {
          const radius = ringStart + (i * ringStep);
          const opacity = Math.max(0.12, 0.24 - (i * 0.04));
          const ringSprite = createMultiMembershipRingSprite(radius, opacity);
          if (!ringSprite) continue;
          rings.push(ringSprite);
          group.add(ringSprite);
        }
        if (rings.length) {
          multiMembershipRingCache.current.set(node.id, rings);
        }
      }
    }

    nodeObjectCache.current.set(node.id, group);
    return group;
  }, [multiMembershipActive, multiMembershipMap, isExpandedNode]);

  const updateMultiMembershipHover = useCallback((nodeId: string, hovered: boolean) => {
    const rings = multiMembershipRingCache.current.get(nodeId);
    if (!rings || !rings.length) return;
    rings.forEach(sprite => {
      const material = sprite.material as THREE.SpriteMaterial;
      const baseOpacity = sprite.userData.baseOpacity ?? material.opacity ?? 1;
      const hoverOpacity = sprite.userData.hoverOpacity ?? Math.min(1, baseOpacity + 0.35);
      material.opacity = hovered ? hoverOpacity : baseOpacity;
      material.needsUpdate = true;
    });
    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, []);

  useEffect(() => {
    if (!multiMembershipActive) {
      previousHoveredNodeIdRef.current = null;
      return;
    }
    const prev = previousHoveredNodeIdRef.current;
    if (prev && prev !== hoveredNodeId) {
      updateMultiMembershipHover(prev, false);
    }
    if (hoveredNodeId) {
      updateMultiMembershipHover(hoveredNodeId, true);
    }
    previousHoveredNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId, multiMembershipActive, updateMultiMembershipHover]);

  useEffect(() => {
    expandedHaloCache.current.forEach((sprite, nodeId) => {
      sprite.visible = expandedClusterIds?.has(nodeId) ?? false;
    });
    if (animationPausedRef.current) {
      graphRef.current?.refresh();
    }
  }, [expandedClusterIds]);

  const reducedDetail = enableMotionOptimizations && reduceDetail;
  const exporting = Boolean(exportRenderState);
  const aggressiveDetail = exporting ? false : enablePerformanceMode || reducedDetail;
  const labelAccessor = (enablePerformanceMode && !exportRenderState?.showLabels) ? undefined : nodeThreeObject;
  const linkWidthScale = aggressiveDetail ? 0.2 : reducedDetail ? 0.4 : 0.5;
  const nodeOpacity = exportRenderState ? exportRenderState.nodeOpacity : 1;
  const linkOpacity = exportRenderState ? exportRenderState.linkOpacity : 1;
  const nodeVisibility = useCallback((node: Node) => {
    if (!exportRenderState) return true;
    if (exportRenderState.highlightOnly && highlightNodeIds) {
      return highlightNodeIds.has(node.id);
    }
    return true;
  }, [exportRenderState, highlightNodeIds]);
  const linkVisibility = useCallback((link: Edge) => {
    if (!exportRenderState) return true;
    if (!exportRenderState.showLinks) return false;
    if (exportRenderState.highlightOnly && highlightNodeIds) {
      const srcId = getLinkEndpointId(link.source);
      const tgtId = getLinkEndpointId(link.target);
      return highlightNodeIds.has(srcId || '') && highlightNodeIds.has(tgtId || '');
    }
    return true;
  }, [exportRenderState, highlightNodeIds]);
  const linkWidth = useCallback((link: Edge) => {
    const base = EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width;
    const dashScale = isDashedLink(link) ? 0.6 : 1;
    const weight = link.weight || 1;
    const weightScale = Math.min(3, 1 + Math.log1p(weight) * 0.6);
    const crossLayerBoost = isCrossLayerEdge(link) ? 1.3 : 1;
    return base * linkWidthScale * dashScale * weightScale * crossLayerBoost;
  }, [linkWidthScale, isCrossLayerEdge]);
  const linkDirectionalParticles = useCallback((link: Edge) => {
    if (aggressiveDetail) return 0;
    if (!isDashedLink(link)) return 0;
    return reducedDetail ? 2 : 4;
  }, [aggressiveDetail, reducedDetail]);
  const linkParticleWidth = useCallback((link: Edge) => {
    if (aggressiveDetail) return 0;
    if (!isDashedLink(link)) return 0;
    const base = EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width;
    return Math.max(0.8, base * (reducedDetail ? 0.35 : 0.5));
  }, [aggressiveDetail, reducedDetail]);
  const arrowLength = aggressiveDetail ? 0 : reducedDetail ? 1.5 : 3;
  const isHierarchical = viewMode === 'hierarchical';
  const useTwoDimensional = viewMode === 'hierarchical' && !layeringActive;
  const cooldownTicks = isHierarchical ? 180 : enablePerformanceMode ? 140 : undefined;
  const cooldownTime = isHierarchical ? 8000 : enablePerformanceMode ? 6000 : undefined;
  const alphaDecay = isHierarchical ? 0.05 : enablePerformanceMode ? 0.035 : 0.0228;
  const velocityDecay = isHierarchical ? 0.6 : enablePerformanceMode ? 0.5 : 0.4;
  const alphaMin = isHierarchical ? 0.02 : enablePerformanceMode ? 0.004 : 0;
  const linkCurvature = useCallback((link: Edge) => {
    if (aggressiveDetail) return 0;
    const base = viewMode === 'hierarchical' ? 0.25 : 0;
    if (isCrossLayerEdge(link)) {
      return Math.min(0.45, base + 0.12);
    }
    return base;
  }, [aggressiveDetail, viewMode, isCrossLayerEdge]);

  const hasRenderableData = graphData.nodes.length > 0 || graphData.links.length > 0;

  return (
    <div ref={containerRef} className="h-full w-full relative" onMouseMove={handlePointerMove}>
      {dimensions.width > 0 && dimensions.height > 0 && hasRenderableData && (
        <ForceGraph3D<Node, Edge>
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0f172a"
          nodeRelSize={3}
          nodeVal={nodeVal}
          nodeLabel={nodeTooltip}
          nodeColor={nodeColor}
          nodeOpacity={nodeOpacity}
          nodeVisibility={nodeVisibility}
          nodeThreeObject={labelAccessor}
          nodeThreeObjectExtend={!enablePerformanceMode || exportRenderState?.showLabels}
          linkLabel={linkTooltip}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={linkOpacity}
          linkVisibility={linkVisibility}
          linkCurvature={linkCurvature}
          onLinkHover={link => setHoveredEdge((link as Edge) || null)}
          linkDirectionalArrowLength={arrowLength}
          linkDirectionalArrowRelPos={arrowLength > 0 ? 1 : 0}
          linkDirectionalArrowColor={arrowLength > 0 ? linkColor : undefined}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleSpeed={0}
          linkDirectionalParticleWidth={linkParticleWidth}
          linkDirectionalParticleColor={linkColor}
          d3AlphaDecay={alphaDecay}
          d3VelocityDecay={velocityDecay}
          d3AlphaMin={alphaMin}
          warmupTicks={isHierarchical ? 30 : 0}
          cooldownTicks={cooldownTicks}
          cooldownTime={cooldownTime}
          onEngineTick={handleEngineTick}
          onEngineStop={handleEngineStop}
          enableNodeDrag
          onNodeDrag={node => {
            const dragged = node as Node;
            dragged.fx = dragged.x;
            dragged.fy = dragged.y;
            dragged.fz = layeringActive ? -getNodeLodDepth(dragged) * effectiveLayerSpacing : (dragged.z ?? 0);
            requestReheat();
            registerInteraction(1.2);
          }}
          onNodeDragEnd={node => {
            const dragged = node as Node;
            dragged.fx = dragged.x;
            dragged.fy = dragged.y;
            dragged.fz = layeringActive ? -getNodeLodDepth(dragged) * effectiveLayerSpacing : (dragged.z ?? 0);
            requestReheat();
            registerInteraction(0.2);
          }}
          onNodeHover={node => handleNodeHover((node as Node) || null)}
          onNodeClick={(node) => {
            const clicked = node as Node;
            const now = performance.now();
            const lastClick = lastClickRef.current;
            const isDoubleClick = Boolean(lastClick && lastClick.id === clicked.id && (now - lastClick.time) < DOUBLE_CLICK_WINDOW);
            if (isDoubleClick) {
              if (clickTimeoutRef.current) {
                window.clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = null;
              }
              lastClickRef.current = null;
              if (onNodeExpand) {
                onNodeExpand(clicked);
              }
              onNodeSelect(clicked);
              return;
            }
            lastClickRef.current = { id: clicked.id, time: now };
            if (clickTimeoutRef.current) {
              window.clearTimeout(clickTimeoutRef.current);
            }
            clickTimeoutRef.current = window.setTimeout(() => {
              onNodeSelect(selectedNode?.id === clicked.id ? null : clicked);
              clickTimeoutRef.current = null;
            }, CLICK_DELAY);
          }}
          onBackgroundClick={() => {
            if (onBackgroundClick) onBackgroundClick();
            else onNodeSelect(null);
          }}
          numDimensions={useTwoDimensional ? 2 : 3}
        />
      )}
      {edgePreview && edgePreviewPosition && (
        <div
          className="absolute z-30 pointer-events-none bg-slate-950/90 border border-slate-700/70 rounded-md shadow-lg p-2 text-xs text-slate-200 w-[260px]"
          style={{ left: edgePreviewPosition.x, top: edgePreviewPosition.y }}
        >
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span className="font-semibold uppercase tracking-wide">{hoveredEdge?.type || 'Edge'}</span>
            <span>{edgePreview.count} edges</span>
          </div>
          <div className="space-y-1">
            {edgePreview.items.map((item, idx) => (
              <div key={`${item.from}-${item.to}-${idx}`} className="flex items-center gap-2 text-[11px]">
                <span className="truncate max-w-[110px] text-slate-200">{item.from}</span>
                <span className="text-slate-500">→</span>
                <span className="truncate max-w-[110px] text-slate-200">{item.to}</span>
              </div>
            ))}
            {hoveredEdge?.members && hoveredEdge.members.length > edgePreview.items.length && (
              <div className="text-[10px] text-slate-500">
                +{hoveredEdge.members.length - edgePreview.items.length} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
