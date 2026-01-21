import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Node, Edge, NODE_SIZE_CONFIG, EDGE_STYLES, GraphRendererProps, DrilldownContext, CLUSTER_KINDS } from '../types';
import { getNodeColor } from '../utils/colorMapping';
import { computeClusterLayout } from '../utils/clusterLayout';
import { getFocusNodeIds } from '../utils/focusModes';
import { getLabelBucketForZoom, getNextLabelBucket, getLabelBudgetForBucket, getLabelRank, compareLabelRank, shouldForceLabel } from '../utils/labeling';
import { loadLayoutCache, saveLayoutCache, LayoutCachePoint } from '../utils/layoutCache';

const GROUP_MAPPING: Record<string, number> = {
    'route': 0,
    'page': 1,
    'component': 2,
    'hook': 3,
    'api_endpoint': 4, 'endpoint': 4,
    'handler': 5, 'service': 5, 'router': 5, 'api_client': 5,
    'model': 6, 'repository': 6, 'schema': 6, 'type': 6, 'migration': 6, 'query_key': 6
};

// Define target horizontal positions (0.0 to 1.0) for architectural flow
const ARCHITECTURE_FLOW: Record<string, number> = {
    'route': 0.1,
    'page': 0.2,
    'component': 0.35,
    'hook': 0.35,
    'query_key': 0.45,
    'api_client': 0.5,
    'api_endpoint': 0.6,
    'router': 0.6,
    'handler': 0.7,
    'service': 0.75,
    'model': 0.9,
    'repository': 0.85,
    'schema': 0.9,
    'migration': 0.95,
    'type': 0.5 // Types can be everywhere, keep central
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

// Helper: Calculate Node Radius using Logarithmic Scale
const getNodeRadius = (node: Node) => {
    // formula: base + (log(totalDegree + 1) * factor)
    // +1 ensures log(0+1) = 0 for nodes with no connections
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

const getLinkTooltip = (edge: Edge) => {
    if (!edge.aggregated) return edge.type;
    const count = edge.memberCount || edge.weight || edge.members?.length || 0;
    const samples = edge.members?.slice(0, 6) || [];
    const preview = samples.map(sample => `${sample.from} → ${sample.to}`).join('\n');
    const suffix = edge.members && edge.members.length > samples.length
        ? `\n+${edge.members.length - samples.length} more`
        : '';
    return `${edge.type} (${count} edges)\n${preview}${suffix}`.trim();
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
    focusClusterId: string | null,
    mode: DrilldownContext
) => {
    if (!focusClusterId || mode === 'all') return null;
    const clusterNodeIds = new Set<string>();
    nodes.forEach(node => {
        if (isNodeInCluster(node, focusClusterId)) clusterNodeIds.add(node.id);
    });
    if (!clusterNodeIds.size) return null;
    if (mode === 'cluster-only') return clusterNodeIds;
    const focusDepth = getFocusClusterDepth(nodes, focusClusterId);
    if (focusDepth === null) return clusterNodeIds;
    nodes.forEach(node => {
        if (getNodeLodDepth(node) === focusDepth) clusterNodeIds.add(node.id);
    });
    return clusterNodeIds;
};

export const GraphCanvas: React.FC<GraphRendererProps> = ({ data, viewState, handlers }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        selectedNode,
        focusMode,
        focusHopCount,
        focusClusterId,
        drilldownContext,
        expandedClusterIds,
        viewMode,
        groupingData,
        activeColorMode,
        activeGroupingMode,
        gitMetadata,
        enableMotionOptimizations,
        zoomSpeed,
        zoomLevel,
        exportRequest,
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

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);
    const nodePositions = useRef<Map<string, LayoutCachePoint>>(new Map());
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    // Store the zoom transform to prevent reset on data updates
    const zoomTransform = useRef<d3.ZoomTransform>(d3.zoomIdentity);
    // Track dragging state to prevent click events (which trigger view resets via re-render)
    const isDragging = useRef<boolean>(false);
    const [reduceDetail, setReduceDetail] = useState(false);
    const [labelBucket, setLabelBucket] = useState(() => getLabelBucketForZoom(zoomLevel));
    const labelBucketRef = useRef(labelBucket);
    const interactionTimeoutRef = useRef<number | null>(null);
    const lastZoomRef = useRef<{ x: number; y: number; k: number; time: number } | null>(null);
    const clickTimeoutRef = useRef<number | null>(null);
    const lastClickRef = useRef<{ id: string; time: number } | null>(null);
    const [layoutCacheVersion, setLayoutCacheVersion] = useState(0);
    const lastLayoutCacheKeyRef = useRef<string | null>(null);
    const lastCacheWriteRef = useRef<number>(0);
    const CLICK_DELAY = 280;
    const DOUBLE_CLICK_WINDOW = 380;

    useEffect(() => {
        if (!exportRequest) return;
        onExportStatus?.({
            state: 'error',
            requestId: exportRequest.id,
            message: 'Image export is available only in WebGL mode.'
        });
        onExportRequestHandled?.(exportRequest.id);
    }, [exportRequest?.id, onExportRequestHandled, onExportStatus]);

    useEffect(() => {
        const next = getNextLabelBucket(zoomLevel, labelBucketRef.current);
        if (next !== labelBucketRef.current) {
            labelBucketRef.current = next;
            setLabelBucket(next);
        }
    }, [zoomLevel]);

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


    const updateReduceDetail = useCallback((speed: number) => {
        if (!enableMotionOptimizations) return;
        const hideThreshold = 1.0;
        const showThreshold = 0.25;
        setReduceDetail(prev => {
            let next = prev;
            if (speed > hideThreshold) next = true;
            else if (speed < showThreshold) next = false;
            return next === prev ? prev : next;
        });
    }, [enableMotionOptimizations]);

    const registerInteraction = useCallback((speed?: number) => {
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
    }, [enableMotionOptimizations, updateReduceDetail]);

    const handleZoomInteraction = useCallback((transform: d3.ZoomTransform) => {
        const now = performance.now();
        const last = lastZoomRef.current;
        let speed = 0;
        if (last) {
            const dx = transform.x - last.x;
            const dy = transform.y - last.y;
            const dk = transform.k - last.k;
            const delta = Math.hypot(dx, dy) + Math.abs(dk) * 260;
            const dt = Math.max(16, now - last.time);
            speed = delta / dt;
        }
        lastZoomRef.current = { x: transform.x, y: transform.y, k: transform.k, time: now };
        if (onZoomChange) {
            onZoomChange(transform.k);
        }
        if (enableMotionOptimizations) {
            registerInteraction(speed);
        }
    }, [enableMotionOptimizations, onZoomChange, registerInteraction]);

    // FIX: Use ref to access latest selectedNode inside D3 callbacks (which may be stale closures)
    const selectedNodeRef = useRef<Node | null>(selectedNode);
    useEffect(() => {
        selectedNodeRef.current = selectedNode;
    }, [selectedNode]);

    useEffect(() => {
        return () => {
            if (interactionTimeoutRef.current) {
                window.clearTimeout(interactionTimeoutRef.current);
            }
            if (clickTimeoutRef.current) {
                window.clearTimeout(clickTimeoutRef.current);
            }
        };
    }, []);

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

    useEffect(() => {
        if (!enableMotionOptimizations) {
            setReduceDetail(false);
        }
    }, [enableMotionOptimizations]);

    const highlightMode = focusMode === 'off' ? 'flow' : focusMode;
    const highlightNodeIds = useMemo(() => {
        if (!selectedNode) return null;
        return getFocusNodeIds(highlightMode, selectedNode.id, data.edges, focusHopCount);
    }, [selectedNode?.id, data.edges, highlightMode, focusHopCount]);
    const focusActive = Boolean(selectedNode && focusMode !== 'off' && highlightNodeIds);
    const multiMembershipData = useMemo(() => {
        if (!groupingData) {
            return { map: new Map<string, string[]>(), activeSet: null };
        }
        const activeSet = groupingData.group_sets?.find((set: any) => set.id === activeGroupingMode) || null;
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
    const multiMembershipLabel = multiMembershipData.activeSet?.label || 'Groups';

    const canUseLayoutCache = Boolean(layoutCacheKey) && !focusActive;
    const persistLayoutCache = useCallback((force = false) => {
        if (!layoutCacheKey || !canUseLayoutCache) return;
        const now = performance.now();
        if (!force && now - lastCacheWriteRef.current < 5000) return;
        lastCacheWriteRef.current = now;
        saveLayoutCache(layoutCacheKey, nodePositions.current);
    }, [layoutCacheKey, canUseLayoutCache]);

    // Stable data derivation with position persistence & Degree Calculation
    const { visibleNodes, visibleEdges } = useMemo(() => {
        // Need deep copies for D3
        let nodes = data.nodes.map(n => {
            const pos = nodePositions.current.get(n.id);
            const baseNode = { ...n };
            if (pos) {
                baseNode.x = pos.x;
                baseNode.y = pos.y;
                baseNode.vx = pos.vx;
                baseNode.vy = pos.vy;
            }
            return baseNode;
        });

        let edges = data.edges.map(e => ({ ...e, source: e.from, target: e.to }));

        // Calculate VISIBLE Degrees (Connectivity) for Physics/Charge
        const visibleDegreeMap = new Map<string, number>();
        edges.forEach(e => {
            visibleDegreeMap.set(e.from, (visibleDegreeMap.get(e.from) || 0) + 1);
            visibleDegreeMap.set(e.to, (visibleDegreeMap.get(e.to) || 0) + 1);
        });

        nodes.forEach(n => {
            n.degree = visibleDegreeMap.get(n.id) || 0;
        });

        // Apply Focus Mode Filtering
        if (focusActive && highlightNodeIds) {
            const nodeSet = new Set(nodes.filter(n => highlightNodeIds.has(n.id)).map(n => n.id));
            nodes = nodes.filter(n => nodeSet.has(n.id));
            edges = edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));
        }

        if (!focusActive) {
            const drilldownNodeIds = buildDrilldownContextNodeIds(nodes, focusClusterId, drilldownContext);
            if (drilldownNodeIds) {
                nodes = nodes.filter(node => drilldownNodeIds.has(node.id));
                edges = edges.filter(edge => drilldownNodeIds.has(edge.from) && drilldownNodeIds.has(edge.to));
            }
        }

        return { visibleNodes: nodes, visibleEdges: edges };
    }, [data, focusMode, focusActive, viewMode, selectedNode?.id, highlightNodeIds, layoutCacheVersion, focusClusterId, drilldownContext]);

    const labelVisibleIds = useMemo(() => {
        if (!visibleNodes.length) return new Set<string>();
        const bucket = labelBucket;
        const budget = getLabelBudgetForBucket(bucket, visibleNodes.length);
        const ranked = visibleNodes
            .map(node => ({
                node,
                rank: getLabelRank(node, selectedNode?.id, highlightNodeIds || undefined, bucket)
            }))
            .sort((a, b) => compareLabelRank(a.rank, b.rank));
        const ids = new Set<string>();
        ranked.forEach(entry => {
            const force = shouldForceLabel(entry.node, selectedNode?.id, bucket);
            if (force || ids.size < budget) {
                ids.add(entry.node.id);
            }
        });
        return ids;
    }, [visibleNodes, labelBucket, selectedNode?.id, highlightNodeIds]);

    useEffect(() => {
        if (!cameraJumpRequest) return;
        let cancelled = false;
        const attemptJump = () => {
            if (cancelled) return;
            const svg = svgRef.current;
            const zoom = zoomBehaviorRef.current;
            const container = containerRef.current;
            if (!svg || !zoom || !container) {
                requestAnimationFrame(attemptJump);
                return;
            }
            const pos = nodePositions.current.get(cameraJumpRequest.nodeId);
            if (!pos) {
                requestAnimationFrame(attemptJump);
                return;
            }
            const { width, height } = container.getBoundingClientRect();
            const k = zoomTransform.current.k || 1;
            const x = width / 2 - (pos.x || 0) * k;
            const y = height / 2 - (pos.y || 0) * k;
            const nextTransform = d3.zoomIdentity.translate(x, y).scale(k);
            d3.select(svg).transition().duration(650).call(zoom.transform, nextTransform);
            zoomTransform.current = nextTransform;
        };
        attemptJump();
        return () => {
            cancelled = true;
        };
    }, [cameraJumpRequest?.runId]);

    // Pre-calculate Cluster Layout if in Hierarchical Mode
    const clusterPositions = useMemo(() => {
        if (viewMode !== 'hierarchical' || !containerRef.current) return {};
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        return computeClusterLayout(visibleNodes, visibleEdges, width, height);
    }, [viewMode, visibleNodes, visibleEdges]);

    // EFFECT: Main D3 Render Logic
    useEffect(() => {
        if (!svgRef.current || !containerRef.current) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const svg = d3.select(svgRef.current);

        // Setup container group if it doesn't exist
        let g = svg.select<SVGGElement>("g.main-group");
        if (g.empty()) {
            g = svg.append("g").attr("class", "main-group");

            // Create layers in order
            g.append("g").attr("class", "group-boxes");
            g.append("g").attr("class", "links");
            g.append("g").attr("class", "nodes");

            // Markers
            const defs = svg.append("defs");
            defs.append("marker")
                .attr("id", "arrowhead")
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 22)
                .attr("refY", 0)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M0,-5L10,0L0,5")
                .attr("fill", "#64748b");

            // Initializes Zoom
            const zoom = d3.zoom<SVGSVGElement, unknown>()
                .scaleExtent([0.1, 8])
                .wheelDelta((event: WheelEvent) => {
                    const base = -event.deltaY * 0.002;
                    return base * Math.max(0.1, zoomSpeed);
                })
                .on("zoom", (event) => {
                    g.attr("transform", event.transform);
                    zoomTransform.current = event.transform;
                    handleZoomInteraction(event.transform);
                });
            zoomBehaviorRef.current = zoom;
            svg.call(zoom).call(zoom.transform, zoomTransform.current);
            svg.on("dblclick.zoom", null);

            // Background Click Handler to Clear Selection
            svg.on("click", (event) => {
                if (event.target === svgRef.current) {
                    if (onBackgroundClick) onBackgroundClick();
                    else onNodeSelect(null);
                }
            });
        }

        const groupLayer = g.select<SVGGElement>(".group-boxes");
        const linkLayer = g.select<SVGGElement>(".links");
        const nodeLayer = g.select<SVGGElement>(".nodes");

        // --- PREPARE DATA ---
        const moduleCenters: Record<string, { x: number, y: number }> = {};
        const moduleNodes: Record<string, Node[]> = {};
        const modules = Array.from(new Set(visibleNodes.map(n => n.module || 'Other'))).sort() as string[];

        if (viewMode === 'hierarchical') {
            modules.forEach(mod => {
                if (clusterPositions[mod]) {
                    moduleCenters[mod] = clusterPositions[mod];
                } else {
                    moduleCenters[mod] = { x: width / 2, y: height / 2 };
                }
                moduleNodes[mod] = [];
            });

            visibleNodes.forEach(n => {
                if (moduleNodes[n.module || 'Other']) {
                    moduleNodes[n.module || 'Other'].push(n);
                }
            });
        }

        if (viewMode === 'structured') {
            const GROUPS_COUNT = 7;
            const colWidth = width / (GROUPS_COUNT + 1);
            const startX = colWidth * 0.8;

            const groupedNodes: Record<number, Node[]> = {};
            for (let i = 0; i < GROUPS_COUNT; i++) groupedNodes[i] = [];

            visibleNodes.forEach(n => {
                const groupIdx = GROUP_MAPPING[n.type] ?? 2;
                groupedNodes[groupIdx].push(n);
            });

            Object.entries(groupedNodes).forEach(([gIdxStr, gNodes]) => {
                const gIdx = parseInt(gIdxStr);
                gNodes.sort((a, b) => a.id.localeCompare(b.id));

                const totalInCol = gNodes.length;
                const virtualHeight = Math.max(height * 0.8, totalInCol * 40);
                const startY = (height - virtualHeight) / 2 + 50;

                gNodes.forEach((n, idx) => {
                    n.fx = startX + (gIdx * colWidth);
                    n.fy = startY + (idx * (virtualHeight / (totalInCol || 1)));
                });
            });
        } else {
            visibleNodes.forEach(n => {
                if (!isDragging.current) {
                    n.fx = null;
                    n.fy = null;
                }
            });
        }

        // --- D3 SIMULATION SETUP ---
        // Reuse existing simulation if possible, or create new one
        let simulation = simulationRef.current;
        if (!simulation) {
            simulation = d3.forceSimulation<Node, undefined>()
                .force("link", d3.forceLink().id((d: any) => d.id))
                .force("charge", d3.forceManyBody())
                .force("center", d3.forceCenter(width / 2, height / 2))
                .force("x", d3.forceX())
                .force("y", d3.forceY())
                .force("collide", d3.forceCollide());

            simulationRef.current = simulation;
        }

        // Configure Simulation Parameters safely
        simulation.nodes(visibleNodes);
        simulation.alphaDecay(0.02).velocityDecay(0.6);

        // Configure Forces
        const linkForce = simulation.force<d3.ForceLink<Node, any>>("link");
        if (linkForce) {
            linkForce.links(visibleEdges).distance((d: any) => getLinkDistance(d, viewMode));
        }

        const chargeForce = simulation.force<d3.ForceManyBody<Node>>("charge");
        if (chargeForce) {
            chargeForce.strength((d: any) => {
                if (viewMode === 'structured') return 0;
                return getChargeStrength(d, viewMode);
            });
        }

        const centerForce = simulation.force<d3.ForceCenter<Node>>("center");
        if (centerForce) centerForce.strength(0); // We use custom forces instead usually

        // Specific View Forces
        const forceX = simulation.force<d3.ForceX<Node>>("x");
        const forceY = simulation.force<d3.ForceY<Node>>("y");

        if (viewMode === 'structured') {
            if (forceX) forceX.strength(0);
            if (forceY) forceY.strength(0);
        } else if (viewMode === 'hierarchical') {
            if (forceX) {
                forceX.x((d: any) => {
                    const center = moduleCenters[d.module || 'Other'];
                    return center ? center.x : width / 2;
                }).strength((d: any) => getModulePullStrength(d));
            }
            if (forceY) {
                forceY.y((d: any) => {
                    const center = moduleCenters[d.module || 'Other'];
                    return center ? center.y : height / 2;
                }).strength((d: any) => getModulePullStrength(d));
            }
        } else {
            // Standard Map Flow
            if (forceX) {
                forceX.x((d: any) => {
                    const relativePos = ARCHITECTURE_FLOW[d.type] || 0.5;
                    return width * relativePos;
                }).strength(0.15);
            }
            if (forceY) {
                forceY.y(height / 2).strength(0.05);
            }
        }

        const collideForce = simulation.force<d3.ForceCollide<Node>>("collide");
        if (collideForce) {
            collideForce.radius((d: any) => {
                if (viewMode === 'structured') return 0;
                const extra = Math.log1p(d.degree || 0) * 5;
                return getNodeRadius(d) + 6 + extra;
            }).iterations(2).strength(0.8);
        }

        // --- RENDERING WITH JOIN PATTERN ---

        // 1. Group Boxes (Hierarchical)
        // We only render these if in hierarchical mode
        const groupData = viewMode === 'hierarchical' ? modules : [];

        // Group Rects
        const groupRects = groupLayer
            .selectAll<SVGRectElement, string>("rect")
            .data(groupData, (d) => d)
            .join(
                enter => enter.append("rect")
                    .attr("rx", 8)
                    .attr("ry", 8)
                    .attr("fill", "#1e293b")
                    .attr("stroke", "#334155")
                    .attr("stroke-width", 1)
                    .attr("stroke-dasharray", "4,4")
                    .attr("opacity", 0.5),
                update => update,
                exit => exit.remove()
            );

        // Group Labels
        const groupLabels = groupLayer
            .selectAll<SVGTextElement, string>("text")
            .data(groupData, (d) => d)
            .join(
                enter => enter.append("text")
                    .text(d => d)
                    .attr("fill", "#94a3b8")
                    .attr("font-size", "10px")
                    .attr("font-family", "Inter, sans-serif")
                    .attr("font-weight", "600")
                    .attr("text-anchor", "start")
                    .attr("opacity", 0.8),
                update => update,
                exit => exit.remove()
            );

        // 2. Links
        const link = linkLayer
            .selectAll<SVGPathElement, Edge>("path")
            .data(visibleEdges, (d) => d.id)
            .join(
                enter => {
                    const path = enter.append("path")
                        .attr("class", "edge-path")
                        .attr("fill", "none")
                        .attr("marker-end", "url(#arrowhead)");
                    path.append("title");
                    return path;
                },
                update => update,
                exit => exit.remove()
            )
            .attr("stroke", (d) => {
                const style = EDGE_STYLES[d.type] || EDGE_STYLES.default;
                return style.stroke;
            })
            .attr("stroke-width", (d) => {
                const style = EDGE_STYLES[d.type] || EDGE_STYLES.default;
                const weight = d.weight || 1;
                const weightScale = Math.min(3, 1 + Math.log1p(weight) * 0.6);
                return style.width * weightScale;
            })
            .attr("stroke-dasharray", (d) => {
                const style = EDGE_STYLES[d.type] || EDGE_STYLES.default;
                return style.dash || null;
            })
            .attr("stroke-opacity", 0.6);

        link.select("title").text(d => getLinkTooltip(d as Edge));

        // 3. Nodes
        const node = nodeLayer
            .selectAll<SVGGElement, Node>("g.node-group")
            .data(visibleNodes, (d) => d.id)
            .join(
                enter => {
                    const g = enter.append("g")
                        .attr("class", "node-group")
                        .style("cursor", "pointer");

                    g.append("circle")
                        .attr("class", "node-circle")
                        .attr("stroke", "none")
                        .attr("stroke-width", 2);

                    g.append("title");

                    g.append("text")
                        .attr("class", "cluster-glyph")
                        .attr("text-anchor", "middle")
                        .attr("dy", "0.35em")
                        .style("font-size", "11px")
                        .style("font-weight", "600")
                        .style("fill", "#e2e8f0")
                        .style("opacity", 0.85)
                        .style("pointer-events", "none");

                    g.append("text")
                        .attr("class", "node-label")
                        .attr("x", 12)
                        .attr("y", 4)
                        .style("font-size", "10px")
                        .style("fill", "#cbd5e1")
                        .style("font-family", "JetBrains Mono, monospace")
                        .style("pointer-events", "none")
                        .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

                    return g;
                },
                update => update,
                exit => exit.remove()
            )
            .call(d3.drag<any, any>()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        // Update Node Attributes (for both new and existing)
        node.select(".node-circle")
            .attr("r", (d) => getNodeRadius(d))
            .attr("fill", (d) => getNodeColor(d, activeColorMode, groupingData, gitMetadata)) // Use latest color logic
            .attr("fill-opacity", (d) => expandedClusterIds?.has(d.id) ? 0.45 : 1)
            .attr("stroke", (d) => {
                if (expandedClusterIds?.has(d.id)) return '#facc15';
                return d.kind === 'cluster' ? '#cbd5e1' : 'none';
            })
            .attr("stroke-width", (d) => expandedClusterIds?.has(d.id) ? 2.5 : (d.kind === 'cluster' ? 1.5 : 0))
            .attr("stroke-opacity", (d) => expandedClusterIds?.has(d.id) ? 0.8 : 1);

        node.select(".cluster-glyph")
            .text((d) => {
                const showExpandGlyph = Boolean(d.canExpand ?? (d.kind && CLUSTER_KINDS.has(d.kind)));
                return showExpandGlyph ? '+' : '';
            })
            .style("display", (d) => {
                const showExpandGlyph = Boolean(d.canExpand ?? (d.kind && CLUSTER_KINDS.has(d.kind)));
                return showExpandGlyph ? null : 'none';
            });

        node.select("title")
            .text(d => {
                const base = `Type: ${d.type}\nID: ${d.id}\nVisible Connections: ${d.degree || 0}\nTotal Connections: ${d.totalDegree || 0}`;
                const memberships = multiMembershipMap.get(d.id);
                if (memberships && memberships.length > 1) {
                    return `${base}\n${multiMembershipLabel}: ${memberships.join(', ')}`;
                }
                return base;
            });

        node.select(".node-label")
            .text((d) => labelVisibleIds.has(d.id) ? getCleanLabel(d) : '')
            .style("display", (d) => labelVisibleIds.has(d.id) ? null : "none");

        // Event Listeners (Re-attach to ensure closure freshness if needed, though D3 usually handles this well. 
        // Safer to re-attach or use stable functions. Here we re-attach.)
        node.on("click", (event, d) => {
            event.stopPropagation();
            if (isDragging.current) {
                isDragging.current = false;
                return;
            }
            const now = performance.now();
            const lastClick = lastClickRef.current;
            const isDoubleClick = Boolean(lastClick && lastClick.id === d.id && (now - lastClick.time) < DOUBLE_CLICK_WINDOW);
            if (isDoubleClick) {
                if (clickTimeoutRef.current) {
                    window.clearTimeout(clickTimeoutRef.current);
                    clickTimeoutRef.current = null;
                }
                lastClickRef.current = null;
                if (onNodeExpand) {
                    onNodeExpand(d);
                }
                onNodeSelect(d);
                return;
            }
            lastClickRef.current = { id: d.id, time: now };
            if (clickTimeoutRef.current) {
                window.clearTimeout(clickTimeoutRef.current);
            }
            clickTimeoutRef.current = window.setTimeout(() => {
                // Use ref for toggle check to ensure we have fresh state
                const currentSelected = selectedNodeRef.current;
                onNodeSelect(d.id === currentSelected?.id ? null : d);
                clickTimeoutRef.current = null;
            }, CLICK_DELAY);
        })
            .on("mouseover", (event, d) => onNodeHover(d))
            .on("mouseout", () => onNodeHover(null));

        // 4. Structured Headers (Conditional)
        const headerGroup = g.select<SVGGElement>(".headers"); // Note: headers logic was in 'enter' only previously
        // Ideally we manage headers with data join too if they change.
        // For simplicity, we can clear/redraw headers since they are static count (7).
        if (!headerGroup.empty()) headerGroup.remove();

        if (viewMode === 'structured') {
            const labels = ['Routes', 'Pages', 'Components', 'Hooks', 'API', 'Services', 'Data'];
            const colWidth = width / (labels.length + 1);
            const startX = colWidth * 0.8;

            const hg = g.insert("g", ".group-boxes").attr("class", "headers"); // Insert before boxes/links
            labels.forEach((label, i) => {
                hg.append("text")
                    .attr("x", startX + (i * colWidth))
                    .attr("y", 30)
                    .attr("text-anchor", "middle")
                    .attr("fill", "#64748b")
                    .style("font-size", "12px")
                    .style("font-weight", "bold")
                    .style("text-transform", "uppercase")
                    .style("letter-spacing", "1px")
                    .text(label);
            });
        }

        // --- TICK FUNCTION ---
        simulation.on("tick", () => {
            // Update positions
            link.attr("d", (d: any) => {
                if (viewMode === 'hierarchical') {
                    const x1 = d.source.x, y1 = d.source.y;
                    const x2 = d.target.x, y2 = d.target.y;
                    return `M${x1},${y1}Q${(x1 + x2) / 2},${y1} ${x2},${y2}`;
                }
                return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
            });

            node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

            // Update Groups (Hierarchical)
            if (viewMode === 'hierarchical') {
                modules.forEach(mod => {
                    const nodesInMod = moduleNodes[mod];
                    if (!nodesInMod || nodesInMod.length === 0) return;

                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    nodesInMod.forEach(n => {
                        if (n.x === undefined || n.y === undefined) return;
                        if (n.x < minX) minX = n.x;
                        if (n.x > maxX) maxX = n.x;
                        if (n.y < minY) minY = n.y;
                        if (n.y > maxY) maxY = n.y;
                    });

                    const pad = 25;
                    const boxX = minX - pad;
                    const boxY = minY - pad - 10;
                    const boxW = Math.max(50, (maxX - minX) + (pad * 2));
                    const boxH = Math.max(50, (maxY - minY) + (pad * 2) + 10);

                    // Efficient update via selection filter
                    // (This is O(Modules), which is small)
                    groupRects.filter((d) => d === mod)
                        .attr("x", boxX).attr("y", boxY).attr("width", boxW).attr("height", boxH);

                    groupLabels.filter((d) => d === mod)
                        .attr("x", boxX + 10).attr("y", boxY + 15);
                });
            }

            // Persist positions
            visibleNodes.forEach(n => {
                if (n.x !== undefined && n.y !== undefined) {
                    nodePositions.current.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
                }
            });
            persistLayoutCache();
        });

        // Restart simulation to wake it up
        simulation.alpha(1).restart();

        // Cleanup
        return () => {
            persistLayoutCache(true);
            simulation.stop();
        };

        // --- DRAG HANDLERS ---
        function dragstarted(event: any, d: any) {
            d.fx = d.x;
            d.fy = d.y;
            registerInteraction(1.2);
        }

        function dragged(event: any, d: any) {
            isDragging.current = true;
            if (viewMode !== 'structured') {
                simulation.alphaTarget(0.3).restart();
            }
            d.fx = event.x;
            d.fy = event.y;
            registerInteraction(1.2);
        }

        function dragended(event: any, d: any) {
            if (!event.active && viewMode !== 'structured') simulation.alphaTarget(0);
            setTimeout(() => { isDragging.current = false; }, 100);
            registerInteraction(0.2);
        }

    }, [
        visibleNodes,
        visibleEdges,
        labelVisibleIds,
        viewMode,
        clusterPositions,
        activeColorMode,
        groupingData,
        gitMetadata,
        zoomSpeed,
        handleZoomInteraction,
        registerInteraction,
        persistLayoutCache,
        multiMembershipMap,
        multiMembershipLabel,
        expandedClusterIds
    ]);
    // ^ Added dependencies so colors update when mode changes

    // EFFECT: Reduced Detail Mode while Interacting
    useEffect(() => {
        const svg = d3.select(svgRef.current);
        if (svg.empty()) return;
        const shouldReduce = enableMotionOptimizations && reduceDetail;
        svg.selectAll<SVGTextElement, Node>(".node-label")
            .style("display", (d) => {
                if (shouldReduce) return "none";
                return labelVisibleIds.has(d.id) ? null : "none";
            });
    }, [enableMotionOptimizations, reduceDetail, labelVisibleIds]);

    // EFFECT: Styling Updates (Selection / Dimming)
    // Runs on selection changes WITHOUT re-running simulation
    useEffect(() => {
        const svg = d3.select(svgRef.current);
        if (svg.empty()) return;

        // Update Node Opacity
        const shouldDimForSelection = Boolean(selectedNode && selectedNode.kind !== 'cluster' && focusMode === 'off');

        svg.selectAll<SVGGElement, Node>(".node-group")
            .transition().duration(200)
            .attr("opacity", (d) => {
                if (!shouldDimForSelection) return 1;
                return highlightNodeIds && highlightNodeIds.has(d.id) ? 1 : 0.1;
            });

        // Update Label Visibility
        svg.selectAll<SVGTextElement, Node>(".node-label")
            .transition().duration(200)
            .style("opacity", (d) => {
                if (!shouldDimForSelection) return 1;
                return highlightNodeIds && highlightNodeIds.has(d.id) ? 1 : 0;
            })
            .style("fill", (d) => d.id === selectedNode?.id ? "#fff" : "#cbd5e1");

        // Update Node Circle Highlight
        svg.selectAll<SVGCircleElement, Node>(".node-circle")
            .transition().duration(200)
            .attr("r", (d) => {
                const baseR = getNodeRadius(d);
                return d.id === selectedNode?.id ? baseR + 3 : baseR;
            })
            .attr("stroke", (d) => d.id === selectedNode?.id ? "#fff" : "none");

        // Update Edge Opacity
        svg.selectAll<SVGPathElement, any>(".edge-path")
            .transition().duration(200)
            .attr("stroke-opacity", (d) => {
                if (!shouldDimForSelection) return 0.6;
                const srcId = d.source.id || d.source;
                const tgtId = d.target.id || d.target;
                return (highlightNodeIds?.has(srcId) && highlightNodeIds?.has(tgtId)) ? 0.9 : 0.05;
            });

        // Update Group Box Dimming
        svg.selectAll(".group-boxes rect")
            .transition().duration(200)
            .attr("opacity", shouldDimForSelection ? 0.1 : 0.5);

        svg.selectAll(".group-boxes text")
            .transition().duration(200)
            .attr("opacity", shouldDimForSelection ? 0.2 : 0.8);

    }, [selectedNode, highlightNodeIds, focusMode]);

    // EFFECT: Global Key Helpers (ESC to clear)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onNodeSelect(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onNodeSelect]);

    return (
        <div ref={containerRef} className="w-full h-full bg-slate-950">
            <svg ref={svgRef} className="w-full h-full block" />
        </div>
    );
};
