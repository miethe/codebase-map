
import React, { useEffect, useRef, useContext, useMemo } from 'react';
import * as d3 from 'd3';
import { GraphContext } from '../App';
import { NODE_COLORS, EDGE_STYLES, Node, NODE_SIZE_CONFIG } from '../types';

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

export const GraphCanvas: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, selectedNode, setSelectedNode, setHoveredNode, focusMode, viewMode } = useContext(GraphContext);
  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);
  const nodePositions = useRef<Map<string, { x: number, y: number, vx?: number, vy?: number }>>(new Map());
  // Store the zoom transform to prevent reset on data updates
  const zoomTransform = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  // Track dragging state to prevent click events (which trigger view resets via re-render)
  const isDragging = useRef<boolean>(false);

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

  // EFFECT 1: Initialization & Simulation (Structural)
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || visibleNodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous render

    const g = svg.append("g");
    
    // Group Layer (Bottom)
    const groupLayer = g.append("g").attr("class", "group-boxes");
    // Link Layer
    const linkLayer = g.append("g").attr("class", "links");
    // Node Layer (Top)
    const nodeLayer = g.append("g").attr("class", "nodes");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        zoomTransform.current = event.transform; // Save current zoom state
      });
    
    // Apply the preserved zoom transform immediately
    svg.call(zoom).call(zoom.transform, zoomTransform.current);

    // --- VIEW MODE CALCULATIONS ---
    const moduleCenters: Record<string, {x: number, y: number}> = {};
    const moduleNodes: Record<string, Node[]> = {};
    const modules = Array.from(new Set(visibleNodes.map(n => n.module || 'Other'))).sort() as string[];
    
    if (viewMode === 'hierarchical') {
        // Grid Layout for Systems View
        const cols = Math.ceil(Math.sqrt(modules.length * 1.5)); 
        const spacingX = 400; 
        const spacingY = 400;
        
        modules.forEach((mod, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            moduleCenters[mod] = {
                x: (col * spacingX) + (width * 0.2),
                y: (row * spacingY) + (height * 0.2)
            };
            moduleNodes[mod] = [];
        });
        
        visibleNodes.forEach(n => {
            if (moduleNodes[n.module || 'Other']) {
                moduleNodes[n.module || 'Other'].push(n);
            }
        });
    }

    // --- STRUCTURED VIEW PRE-CALCULATION ---
    if (viewMode === 'structured') {
        const GROUPS_COUNT = 7;
        const colWidth = width / (GROUPS_COUNT + 1);
        const startX = colWidth * 0.8;

        const groupedNodes: Record<number, Node[]> = {};
        for(let i=0; i<GROUPS_COUNT; i++) groupedNodes[i] = [];

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
        // Only clear fixed positions if NOT in hierarchical mode (where we might have dragged nodes)
        // AND if we are switching FROM structured mode. 
        // Actually, for now, re-calculating visibleNodes always resets d3 objects unless we persisted them carefully.
        // We persist x/y/vx/vy via nodePositions ref, but not fx/fy.
        // If we want to persist dragging in hierarchical mode, we'd need to save fx/fy too.
        // For now, simpler approach: Just clear fx/fy unless dragging is active. 
        visibleNodes.forEach(n => {
            // If the node was previously fixed (dragged) and we are just re-rendering, we might want to keep it?
            // But visibleNodes are fresh objects. 
            n.fx = null;
            n.fy = null;
        });
    }

    const simulation = d3.forceSimulation(visibleNodes)
      .alphaDecay(0.05) // Increase decay to stabilize faster
      .force("link", d3.forceLink(visibleEdges).id((d: any) => d.id).distance((d:any) => {
          if (viewMode === 'structured') return 0;
          if (viewMode === 'hierarchical') {
               // If intra-module, keep tight. If inter-module, looser.
               const srcMod = (d.source as Node).module;
               const tgtMod = (d.target as Node).module;
               return srcMod === tgtMod ? 30 : 100;
          }
          return 50;
      })) 
      .force("charge", d3.forceManyBody().strength((d: any) => {
          if (viewMode === 'structured') return 0;
          const degree = d.degree || 0;
          // In hierarchical, less repulsion to allow distinct clusters
          const base = viewMode === 'hierarchical' ? -80 : -120;
          return Math.max(-800, base - (degree * 30)); 
      }))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(viewMode === 'structured' ? 0 : 0.05));

    // Specific Forces for Views
    if (viewMode !== 'structured') {
        if (viewMode === 'hierarchical') {
            // Force nodes toward their module center
            simulation.force("x", d3.forceX((d: any) => {
                const center = moduleCenters[d.module || 'Other'];
                return center ? center.x : width / 2;
            }).strength(0.6));
            
            simulation.force("y", d3.forceY((d: any) => {
                const center = moduleCenters[d.module || 'Other'];
                return center ? center.y : height / 2;
            }).strength(0.6));
        } else {
            // Standard Map Flow
            simulation
                .force("x", d3.forceX((d: any) => {
                    const relativePos = ARCHITECTURE_FLOW[d.type] || 0.5;
                    return width * relativePos;
                }).strength(0.15))
                .force("y", d3.forceY(height / 2).strength(0.05));
        }
    }

    simulation.force("collide", d3.forceCollide().radius((d: any) => {
          if (viewMode === 'structured') return 0;
          return getNodeRadius(d) + 5; 
      }).iterations(2).strength(0.8));

    simulationRef.current = simulation;

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

    // Draw Links
    const link = linkLayer
      .selectAll("path")
      .data(visibleEdges)
      .enter().append("path")
      .attr("class", "edge-path") 
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
      .attr("marker-end", "url(#arrowhead)")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.6);
    
    link.append("title").text(d => d.type);

    // Draw Nodes
    const node = nodeLayer
      .selectAll("g")
      .data(visibleNodes)
      .enter().append("g")
      .attr("class", "node-group") 
      .call(d3.drag<any, any>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended));

    // Node Circles
    node.append("circle")
      .attr("class", "node-circle")
      .attr("r", (d) => getNodeRadius(d)) 
      .attr("fill", (d) => NODE_COLORS[d.type] || '#9ca3af')
      .attr("stroke", "none")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        // Prevent selection if we just finished dragging
        if (isDragging.current) {
            isDragging.current = false;
            return;
        }
        setSelectedNode(d.id === selectedNode?.id ? null : d);
      })
      .on("mouseover", (event, d) => setHoveredNode(d))
      .on("mouseout", () => setHoveredNode(null));
      
    node.append("title")
        .text(d => `Type: ${d.type}\nID: ${d.id}\nVisible Connections: ${d.degree || 0}\nTotal Connections: ${d.totalDegree || 0}`);

    // Node Labels
    node.append("text")
      .attr("class", "node-label")
      .text((d) => getCleanLabel(d))
      .attr("x", 12)
      .attr("y", 4)
      .style("font-size", "10px")
      .style("font-family", "JetBrains Mono, monospace")
      .style("fill", "#cbd5e1")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

    // Headers for Structured Mode
    if (viewMode === 'structured') {
        const labels = ['Routes', 'Pages', 'Components', 'Hooks', 'API', 'Services', 'Data'];
        const colWidth = width / (labels.length + 1);
        const startX = colWidth * 0.8;
        
        const headerGroup = g.append("g").attr("class", "headers");
        labels.forEach((label, i) => {
            headerGroup.append("text")
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

    // Boxes for Hierarchical Mode
    let groupRects: d3.Selection<SVGRectElement, string, SVGGElement, unknown>;
    let groupLabels: d3.Selection<SVGTextElement, string, SVGGElement, unknown>;

    if (viewMode === 'hierarchical') {
        groupRects = groupLayer
            .selectAll("rect")
            .data(modules)
            .enter().append("rect")
            .attr("rx", 8)
            .attr("ry", 8)
            .attr("fill", "#1e293b")
            .attr("stroke", "#334155")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4,4")
            .attr("opacity", 0.5);

        groupLabels = groupLayer
            .selectAll("text")
            .data(modules)
            .enter().append("text")
            .text(d => d)
            .attr("fill", "#94a3b8")
            .attr("font-size", "10px")
            .attr("font-family", "Inter, sans-serif")
            .attr("font-weight", "600")
            .attr("text-anchor", "start")
            .attr("opacity", 0.8);
    }

    simulation.on("tick", () => {
      
      // Update Links with Curves if Hierarchical
      link.attr("d", (d: any) => {
          if (viewMode === 'hierarchical') {
             const x1 = d.source.x, y1 = d.source.y;
             const x2 = d.target.x, y2 = d.target.y;
             return `M${x1},${y1}Q${(x1+x2)/2},${y1} ${x2},${y2}`;
          }
          return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
      });
      
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

      // Update Group Boxes (Hierarchical View)
      if (viewMode === 'hierarchical' && groupRects && groupLabels) {
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
              
              const rect = groupRects.filter((d: any) => d === mod);
              rect.attr("x", boxX).attr("y", boxY).attr("width", boxW).attr("height", boxH);

              const text = groupLabels.filter((d: any) => d === mod);
              text.attr("x", boxX + 10).attr("y", boxY + 15);
          });
      }
      
      // Update positions ref for persistence
      visibleNodes.forEach(n => {
          if (n.x !== undefined && n.y !== undefined) {
            nodePositions.current.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
          }
      });
    });

    function dragstarted(event: any, d: any) {
      isDragging.current = false;
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      // Small threshold to distinguish click from drag
      isDragging.current = true;
      if (viewMode !== 'structured') {
          simulation.alphaTarget(0.3).restart();
      }
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active && viewMode !== 'structured') simulation.alphaTarget(0);
      
      // Behavior Change: 
      // In 'force' view: Unfix (float back) to allow simulation to settle naturally.
      // In 'hierarchical' view: Keep FIXED (pin) so user can rearrange the grid manually.
      if (viewMode === 'force') {
        d.fx = null;
        d.fy = null;
      }
      // Note: In hierarchical, we leave d.fx/d.fy set, keeping the node pinned.
      
      // We don't reset isDragging here immediately to allow click handler to check it
      // Click event fires after dragended.
      setTimeout(() => { isDragging.current = false; }, 100);
    }

    svg.on("click", () => {
        setSelectedNode(null);
    });

    return () => {
      simulation.stop();
    };
  }, [visibleNodes, visibleEdges, viewMode]);

  // EFFECT 2: Styling Updates (Selection / Dimming)
  useEffect(() => {
      const svg = d3.select(svgRef.current);
      if (svg.empty()) return;

      // Update Node Opacity
      svg.selectAll(".node-group")
         .transition().duration(200)
         .attr("opacity", (d: any) => {
             if (!selectedNode) return 1;
             if (focusMode) return 1;
             return flowNodeIds && flowNodeIds.has(d.id) ? 1 : 0.1;
         });

      // Update Label Visibility
      svg.selectAll(".node-label")
         .transition().duration(200)
         .style("opacity", (d: any) => {
             if (!selectedNode) return 1;
             if (focusMode) return 1;
             return flowNodeIds && flowNodeIds.has(d.id) ? 1 : 0;
         })
         .style("fill", (d: any) => d.id === selectedNode?.id ? "#fff" : "#cbd5e1");

      // Update Node Circle Highlight
      svg.selectAll(".node-circle")
         .transition().duration(200)
         .attr("r", (d: any) => {
             const baseR = getNodeRadius(d);
             return d.id === selectedNode?.id ? baseR + 3 : baseR;
         })
         .attr("stroke", (d: any) => d.id === selectedNode?.id ? "#fff" : "none");

      // Update Edge Opacity
      svg.selectAll(".edge-path")
         .transition().duration(200)
         .attr("stroke-opacity", (d: any) => {
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

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950">
      <svg ref={svgRef} className="w-full h-full block" />
    </div>
  );
};
