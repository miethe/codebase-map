import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Node, Edge, NODE_SIZE_CONFIG, EDGE_STYLES, GraphRendererProps } from '../types';
import { getNodeColor } from '../utils/colorMapping';
import { computeClusterLayout } from '../utils/clusterLayout';

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

// Traversal for Flow Highlighting
const getFlowNodes = (startNodeId: string, edges: any[]) => {
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

    // Traverse Downstream
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

    // Traverse Upstream
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

export const GraphCanvas: React.FC<GraphRendererProps> = ({ data, viewState, handlers }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        selectedNode,
        focusMode,
        viewMode,
        groupingData,
        activeColorMode,
        gitMetadata,
        enableMotionOptimizations,
        zoomSpeed
    } = viewState;
    const {
        onNodeSelect,
        onNodeHover,
        onBackgroundClick
    } = handlers;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);
    const nodePositions = useRef<Map<string, { x: number, y: number, vx?: number, vy?: number }>>(new Map());
    // Store the zoom transform to prevent reset on data updates
    const zoomTransform = useRef<d3.ZoomTransform>(d3.zoomIdentity);
    // Track dragging state to prevent click events (which trigger view resets via re-render)
    const isDragging = useRef<boolean>(false);
    const [reduceDetail, setReduceDetail] = useState(false);
    const interactionTimeoutRef = useRef<number | null>(null);
    const lastZoomRef = useRef<{ x: number; y: number; k: number; time: number } | null>(null);

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
        if (enableMotionOptimizations) {
            registerInteraction(speed);
        }
    }, [enableMotionOptimizations, registerInteraction]);

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
        };
    }, []);

    useEffect(() => {
        if (!enableMotionOptimizations) {
            setReduceDetail(false);
        }
    }, [enableMotionOptimizations]);

    const flowNodeIds = useMemo(() => {
        if (!selectedNode) return null;
        return getFlowNodes(selectedNode.id, data.edges);
    }, [selectedNode, data.edges]);

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
        if (focusMode && selectedNode && flowNodeIds) {
            const nodeSet = new Set(nodes.filter(n => flowNodeIds.has(n.id)).map(n => n.id));
            nodes = nodes.filter(n => nodeSet.has(n.id));
            edges = edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));
        }

        return { visibleNodes: nodes, visibleEdges: edges };
    }, [data, focusMode, viewMode, focusMode ? selectedNode?.id : 'static']);

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
            svg.call(zoom).call(zoom.transform, zoomTransform.current);

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
                return style.width;
            })
            .attr("stroke-dasharray", (d) => {
                const style = EDGE_STYLES[d.type] || EDGE_STYLES.default;
                return style.dash || null;
            })
            .attr("stroke-opacity", 0.6);

        link.select("title").text(d => d.type);

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
            .attr("fill", (d) => getNodeColor(d, activeColorMode, groupingData, gitMetadata)); // Use latest color logic

        node.select("title")
            .text(d => `Type: ${d.type}\nID: ${d.id}\nVisible Connections: ${d.degree || 0}\nTotal Connections: ${d.totalDegree || 0}`);

        node.select(".node-label")
            .text((d) => getCleanLabel(d));

        // Event Listeners (Re-attach to ensure closure freshness if needed, though D3 usually handles this well. 
        // Safer to re-attach or use stable functions. Here we re-attach.)
        node.on("click", (event, d) => {
            event.stopPropagation();
            if (isDragging.current) {
                isDragging.current = false;
                return;
            }
            // Use ref for toggle check to ensure we have fresh state
            const currentSelected = selectedNodeRef.current;
            onNodeSelect(d.id === currentSelected?.id ? null : d);
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
        });

        // Restart simulation to wake it up
        simulation.alpha(1).restart();

        // Cleanup
        return () => {
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

    }, [visibleNodes, visibleEdges, viewMode, clusterPositions, activeColorMode, groupingData, gitMetadata, zoomSpeed, handleZoomInteraction, registerInteraction]);
    // ^ Added dependencies so colors update when mode changes

    // EFFECT: Reduced Detail Mode while Interacting
    useEffect(() => {
        const svg = d3.select(svgRef.current);
        if (svg.empty()) return;
        const shouldReduce = enableMotionOptimizations && reduceDetail;
        svg.selectAll<SVGTextElement, Node>(".node-label")
            .style("display", shouldReduce ? "none" : null);
    }, [enableMotionOptimizations, reduceDetail]);

    // EFFECT: Styling Updates (Selection / Dimming)
    // Runs on selection changes WITHOUT re-running simulation
    useEffect(() => {
        const svg = d3.select(svgRef.current);
        if (svg.empty()) return;

        // Update Node Opacity
        svg.selectAll<SVGGElement, Node>(".node-group")
            .transition().duration(200)
            .attr("opacity", (d) => {
                if (!selectedNode) return 1;
                if (focusMode) return 1;
                return flowNodeIds && flowNodeIds.has(d.id) ? 1 : 0.1;
            });

        // Update Label Visibility
        svg.selectAll<SVGTextElement, Node>(".node-label")
            .transition().duration(200)
            .style("opacity", (d) => {
                if (!selectedNode) return 1;
                if (focusMode) return 1;
                return flowNodeIds && flowNodeIds.has(d.id) ? 1 : 0;
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
                if (!selectedNode) return 0.6;
                if (focusMode) return 0.9;
                const srcId = d.source.id || d.source;
                const tgtId = d.target.id || d.target;
                return (flowNodeIds?.has(srcId) && flowNodeIds?.has(tgtId)) ? 0.9 : 0.05;
            });

        // Update Group Box Dimming
        svg.selectAll(".group-boxes rect")
            .transition().duration(200)
            .attr("opacity", selectedNode && !focusMode ? 0.1 : 0.5);

        svg.selectAll(".group-boxes text")
            .transition().duration(200)
            .attr("opacity", selectedNode && !focusMode ? 0.2 : 0.8);

    }, [selectedNode, flowNodeIds, focusMode]);

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
