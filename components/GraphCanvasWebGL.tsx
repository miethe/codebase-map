import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import { forceCollide, forceZ } from 'd3-force-3d';
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
  const minRadius = maxRadius * 0.2;
  return minRadius + (maxRadius - minRadius) * layer;
};

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
  if (!context) return new THREE.Object3D();
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

export const GraphCanvasWebGL: React.FC<GraphRendererProps> = ({ data, viewState, handlers }) => {
  const {
    selectedNode,
    focusMode,
    viewMode,
    activeColorMode,
    groupingData,
    gitMetadata,
    enableMotionOptimizations,
    enablePerformanceMode,
    zoomSpeed,
    panSpeed,
    rotateSpeed
  } = viewState;
  const {
    onNodeSelect,
    onNodeHover,
    onBackgroundClick
  } = handlers;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const nodePositions = useRef<Map<string, { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [reduceDetail, setReduceDetail] = useState(false);
  const labelCache = useRef<Map<string, THREE.Object3D>>(new Map());
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const moduleOverlayRef = useRef<THREE.Group | null>(null);
  const headerOverlayRef = useRef<THREE.Group | null>(null);
  const moduleOverlayCache = useRef<Map<string, { box: THREE.LineLoop; label: THREE.Sprite }>>(new Map());
  const headerLabelCache = useRef<THREE.Sprite[]>([]);
  const overlayTickRef = useRef<number>(0);
  const interactionTimeoutRef = useRef<number | null>(null);
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
  const frustumRef = useRef(new THREE.Frustum());
  const projScreenMatrixRef = useRef(new THREE.Matrix4());
  const tempVectorRef = useRef(new THREE.Vector3());

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
    if (!enableMotionOptimizations) return;
    registerInteraction(speed);
  }, [enableMotionOptimizations, registerInteraction]);

  const flowNodeIds = useMemo(() => {
    if (!selectedNode) return null;
    return getFlowNodes(selectedNode.id, data.edges);
  }, [selectedNode?.id, data.edges]);

  const updateLabelVisibility = useCallback(() => {
    const graph = graphRef.current;
    const camera = graph?.camera() as THREE.Camera | undefined;
    if (!graph || !camera) return;
    if (enablePerformanceMode) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;
    const shouldShow = !enableMotionOptimizations || !reduceDetail;
    const restrictToFlow = Boolean(selectedNode && !focusMode && flowNodeIds);
    if (!shouldShow && labelVisibilityModeRef.current === 'hidden') return;
    camera.updateMatrixWorld();
    const projScreenMatrix = projScreenMatrixRef.current;
    projScreenMatrix.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const frustum = frustumRef.current;
    frustum.setFromProjectionMatrix(projScreenMatrix);
    const tempVector = tempVectorRef.current;
    let didChange = false;
    dataSnapshot.nodes.forEach(node => {
      const sprite = labelCache.current.get(node.id);
      if (!sprite) return;
      const allowLabel = shouldShow && (!restrictToFlow || flowNodeIds?.has(node.id));
      if (!allowLabel) {
        if (sprite.visible) {
          sprite.visible = false;
          didChange = true;
        }
        return;
      }
      if (labelVisibilityModeRef.current === 'hidden') {
        sprite.visible = true;
        didChange = true;
      }
      tempVector.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
      const inView = frustum.containsPoint(tempVector);
      if (sprite.visible !== inView) {
        sprite.visible = inView;
        didChange = true;
      }
    });
    labelVisibilityModeRef.current = shouldShow ? 'frustum' : 'hidden';
    if (didChange) {
      graph.refresh();
    }
  }, [enableMotionOptimizations, enablePerformanceMode, reduceDetail, selectedNode, focusMode, flowNodeIds]);

  const scheduleLabelVisibilityUpdate = useCallback(() => {
    if (enablePerformanceMode) return;
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

  const ensureOverlayGroups = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return null;
    if (overlayGroupRef.current) return overlayGroupRef.current;
    const scene = graph.scene();
    const overlayGroup = new THREE.Group();
    overlayGroup.name = 'graph-overlays';
    const moduleGroup = new THREE.Group();
    moduleGroup.name = 'module-overlays';
    const headerGroup = new THREE.Group();
    headerGroup.name = 'header-overlays';
    overlayGroup.add(moduleGroup);
    overlayGroup.add(headerGroup);
    scene.add(overlayGroup);
    overlayGroupRef.current = overlayGroup;
    moduleOverlayRef.current = moduleGroup;
    headerOverlayRef.current = headerGroup;
    return overlayGroup;
  }, []);

  const disposeSprite = (sprite: THREE.Sprite) => {
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map) material.map.dispose();
    material.dispose();
  };

  const disposeLine = (line: THREE.LineLoop) => {
    line.geometry.dispose();
    const material = line.material as THREE.Material;
    material.dispose();
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

    const dimmed = Boolean(selectedNode && !focusMode);
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
    }
  }, [scheduleLabelVisibilityUpdate, updateModuleOverlays, viewMode]);

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
    if (viewMode === 'hierarchical') {
      updateModuleOverlays();
    }
    pauseAnimation();
  }, [pauseAnimation, scheduleLabelVisibilityUpdate, updateModuleOverlays, viewMode]);

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
      moduleOverlayRef.current = null;
      headerOverlayRef.current = null;
      const renderer = graph.renderer();
      renderer.dispose();
      if ((renderer as any).forceContextLoss) {
        (renderer as any).forceContextLoss();
      }
      labelCache.current.clear();
      nodePositions.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!enableMotionOptimizations) {
      setReduceDetail(false);
    }
  }, [enableMotionOptimizations]);

  useEffect(() => {
    if (enablePerformanceMode) return;
    scheduleLabelVisibilityUpdate();
  }, [enableMotionOptimizations, enablePerformanceMode, reduceDetail, scheduleLabelVisibilityUpdate]);

  useEffect(() => {
    scheduleLabelVisibilityUpdate();
  }, [dimensions.width, dimensions.height, scheduleLabelVisibilityUpdate]);

  useEffect(() => {
    scheduleLabelVisibilityUpdate();
  }, [selectedNode?.id, focusMode, flowNodeIds, scheduleLabelVisibilityUpdate]);

  useEffect(() => {
    updateStructuredHeaders();
  }, [updateStructuredHeaders]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onNodeSelect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNodeSelect]);

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
    graphDataRef.current = graphData;
  }, [graphData]);

  useEffect(() => {
    updateModuleOverlays();
  }, [graphData.nodes.length, graphData.links.length, viewMode, updateModuleOverlays, selectedNode?.id, focusMode]);

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
        graph.d3Force('z', forceZ<Node>().z(0).strength(0.05));
      } else if (viewMode === 'force' && dimensions.width && dimensions.height) {
        graph.d3Force('module', null);
        const maxRadius = Math.min(dimensions.width, dimensions.height) * 0.45;
        graph.d3Force('balloon', createBalloonForce(maxRadius, 0.12));
        graph.d3Force('x', null);
        graph.d3Force('y', null);
        graph.d3Force('z', null);
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
    labelCache.current.clear();
    graphRef.current?.refresh();
    scheduleLabelVisibilityUpdate();
  }, [graphData.nodes.length, enablePerformanceMode, scheduleLabelVisibilityUpdate]);

  const nodeVal = useCallback((node: Node) => {
    const base = getNodeRadius(node);
    return selectedNode?.id === node.id ? base + 3 : base;
  }, [selectedNode?.id]);

  const nodeTooltip = useCallback((node: Node) => (
    `Type: ${node.type}\nID: ${node.id}\nVisible Connections: ${node.degree || 0}\nTotal Connections: ${node.totalDegree || 0}`
  ), []);

  const linkTooltip = useCallback((link: Edge) => link.type, []);

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
      cached.visible = true;
      return cached;
    }
    const sprite = createLabelSprite(getCleanLabel(node));
    sprite.visible = true;
    labelCache.current.set(node.id, sprite);
    return sprite;
  }, []);

  const reducedDetail = enableMotionOptimizations && reduceDetail;
  const aggressiveDetail = enablePerformanceMode || reducedDetail;
  const labelAccessor = enablePerformanceMode ? undefined : nodeThreeObject;
  const linkWidthScale = aggressiveDetail ? 0.2 : reducedDetail ? 0.4 : 0.5;
  const linkWidth = useCallback((link: Edge) => {
    const base = EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width;
    const dashScale = isDashedLink(link) ? 0.6 : 1;
    return base * linkWidthScale * dashScale;
  }, [linkWidthScale]);
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
  const cooldownTicks = isHierarchical ? 180 : enablePerformanceMode ? 140 : undefined;
  const cooldownTime = isHierarchical ? 8000 : enablePerformanceMode ? 6000 : undefined;
  const alphaDecay = isHierarchical ? 0.05 : enablePerformanceMode ? 0.035 : 0.0228;
  const velocityDecay = isHierarchical ? 0.6 : enablePerformanceMode ? 0.5 : 0.4;
  const alphaMin = isHierarchical ? 0.02 : enablePerformanceMode ? 0.004 : 0;
  const linkCurvature = aggressiveDetail ? 0 : viewMode === 'hierarchical' ? 0.25 : 0;

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
          nodeLabel={nodeTooltip}
          nodeColor={nodeColor}
          nodeOpacity={1}
          nodeThreeObject={labelAccessor}
          nodeThreeObjectExtend={!enablePerformanceMode}
          linkLabel={linkTooltip}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkCurvature={linkCurvature}
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
            dragged.fz = dragged.z ?? 0;
            requestReheat();
            registerInteraction(1.2);
          }}
          onNodeDragEnd={node => {
            const dragged = node as Node;
            dragged.fx = dragged.x;
            dragged.fy = dragged.y;
            dragged.fz = dragged.z ?? 0;
            requestReheat();
            registerInteraction(0.2);
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
          numDimensions={viewMode === 'hierarchical' ? 2 : 3}
        />
      )}
    </div>
  );
};
