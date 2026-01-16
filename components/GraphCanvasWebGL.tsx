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

  const updateLabelVisibility = useCallback(() => {
    const graph = graphRef.current;
    const camera = graph?.camera() as THREE.Camera | undefined;
    if (!graph || !camera) return;
    if (enablePerformanceMode) return;
    const dataSnapshot = graphDataRef.current;
    if (!dataSnapshot) return;
    const shouldShow = !enableMotionOptimizations || !reduceDetail;
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
      if (!shouldShow) {
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
  }, [enableMotionOptimizations, enablePerformanceMode, reduceDetail]);

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
  }, [scheduleLabelVisibilityUpdate]);

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
    pauseAnimation();
  }, [pauseAnimation, scheduleLabelVisibilityUpdate]);

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

  const flowNodeIds = useMemo(() => {
    if (!selectedNode) return null;
    return getFlowNodes(selectedNode.id, data.edges);
  }, [selectedNode?.id, data.edges]);

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
    graphDataRef.current = graphData;
  }, [graphData]);

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
      controls.addEventListener('change', handleControlsChange);
      handleControlsChange();
    };

    attachControls();

    return () => {
      disposed = true;
      if (controls) controls.removeEventListener('change', handleControlsChange);
    };
  }, [dimensions.width, dimensions.height, panSpeed, resumeAnimation, rotateSpeed, scheduleLabelVisibilityUpdate, updateCameraState, zoomSpeed]);

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
          nodeLabel={node => getCleanLabel(node)}
          nodeColor={nodeColor}
          nodeOpacity={1}
          nodeThreeObject={labelAccessor}
          nodeThreeObjectExtend={!enablePerformanceMode}
          linkColor={linkColor}
          linkWidth={link => (EDGE_STYLES[link.type]?.width || EDGE_STYLES.default.width) * linkWidthScale}
          linkOpacity={1}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={arrowLength}
          linkDirectionalArrowRelPos={arrowLength > 0 ? 1 : 0}
          linkDirectionalArrowColor={arrowLength > 0 ? linkColor : undefined}
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
        />
      )}
    </div>
  );
};
