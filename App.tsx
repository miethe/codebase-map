
import React, { useState, useMemo, useEffect } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import { GraphCanvasWebGL } from './components/GraphCanvasWebGL';
import { Sidebar } from './components/Sidebar';
import { GraphData, Node, GraphContextType, ViewMode, GraphViewMode, EDGE_STYLES, DetailsData, GitMetadata, DependencyGraph } from './types';
import { Layout, Loader2, AlertCircle, ChevronDown, ChevronUp, GitBranch } from 'lucide-react';

import { deriveModulePath, getDisplayModule, buildNodePathMap } from './utils/moduleGrouping';
import { getNodeLegendItems } from './utils/colorMapping';

const FRONTEND_TYPES = new Set(['route', 'page', 'component', 'hook', 'api_client', 'query_key']);
const BACKEND_TYPES = new Set(['api_endpoint', 'endpoint', 'handler', 'service', 'model', 'repository', 'schema', 'migration', 'router', 'type']);


export const GraphContext = React.createContext<GraphContextType>({
  data: { nodes: [], edges: [] },
  totalNodeCounts: {},
  moduleCounts: {},
  selectedNode: null,
  setSelectedNode: () => { },
  filters: {},
  setFilters: () => { },
  hoveredNode: null,
  setHoveredNode: () => { },
  focusMode: false,
  setFocusMode: () => { },
  viewMode: 'force',
  setViewMode: () => { },
  graphView: 'unified',
  setGraphView: () => { },
  activeModule: null,
  setActiveModule: () => { },
  groupingData: null,
  activeGroupingMode: 'structure',
  setActiveGroupingMode: () => { },
  activeColorMode: 'type',
  setActiveColorMode: () => { },
});

const App: React.FC = () => {
  const useWebglRenderer = import.meta.env.VITE_GRAPH_RENDERER === 'webgl';

  const [rawData, setRawData] = useState<GraphData>({ nodes: [], edges: [] });
  const [groupingData, setGroupingData] = useState<any | null>(null);
  const [activeGroupingMode, setActiveGroupingMode] = useState<string>('structure');
  const [activeColorMode, setActiveColorMode] = useState<string>('type');

  const [gitMetadata, setGitMetadata] = useState<GitMetadata | null>(null);
  const [dependencyData, setDependencyData] = useState<DependencyGraph | null>(null);

  const [details, setDetails] = useState<DetailsData | null>(null); // DetailsData loaded lazily
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('force');
  const [graphView, setGraphView] = useState<GraphViewMode>('unified');
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [isNodeLegendOpen, setIsNodeLegendOpen] = useState(true); // Open by default


  // Fetch data on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('./codebase-graph.unified.json');
        if (!response.ok) {
          throw new Error(`Failed to load graph data: ${response.statusText}`);
        }
        const data = await response.json();

        // Enrich nodes with Modules immediately upon load
        const enrichedNodes = data.nodes.map((n: Node) => {
          const modulePath = deriveModulePath(n);
          // Initial module for flat view (Level 1 group) or just use getDisplayModule(null)
          return {
            ...n,
            modulePath,
            module: getDisplayModule(modulePath, null)
          };
        });

        setRawData({ ...data, nodes: enrichedNodes });

        // Load Groupings
        try {
          const groupRes = await fetch('./codebase-graph.groupings.json');
          if (groupRes.ok) {
            const groupJson = await groupRes.json();
            setGroupingData(groupJson);
          }
        } catch (e) {
          console.warn("Failed to load groupings", e);
        }

        // Load Git Metadata
        try {
          const gitRes = await fetch('./codebase-graph.git-metadata.json');
          if (gitRes.ok) {
            const gitJson = await gitRes.json();
            setGitMetadata(gitJson);
          }
        } catch (e) { console.warn("Failed to load git metadata", e); }

        // Load Dependencies
        try {
          const depRes = await fetch('./codebase-graph.dependencies.json');
          if (depRes.ok) {
            const depJson = await depRes.json();
            setDependencyData(depJson);
            // Merge dependencies into rawData nodes
            if (depJson.nodes && depJson.nodes.length > 0) {
              setRawData(prev => ({
                ...prev,
                nodes: [...prev.nodes, ...depJson.nodes]
              }));
            }
          }
        } catch (e) { console.warn("Failed to load dependencies", e); }

        // Kick off details fetch immediately after main graph is loaded
        setIsDetailsLoading(true);
        fetch('./codebase-graph.details.json')
          .then(res => {
            if (!res.ok) throw new Error('Failed to load details');
            return res.json();
          })
          .then(details => {
            setDetails(details);
          })
          .catch(err => {
            console.warn("Failed to load details file:", err);
            // Non-critical error, so we don't set the global 'error' state
          })
          .finally(() => {
            setIsDetailsLoading(false);
          });

      } catch (err) {
        console.error("Error fetching graph data:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Re-run grouping logic when Mode or Data changes
  useEffect(() => {
    if (!rawData.nodes.length) return;

    const nodePathMap = groupingData ? buildNodePathMap(groupingData, activeGroupingMode) : null;
    const shouldUseLegacy = activeGroupingMode === 'structure' && (!nodePathMap || nodePathMap.size === 0);

    setRawData(prev => {
      // Avoid infinite loop if nothing changed? 
      // We can't easily check deep equality here. 
      // But this effect runs on [groupingData, activeGroupingMode].
      // Ensure we don't depend on rawData in the array, but use functional update.

      const reEnrichedNodes = prev.nodes.map(n => {
        let modulePath: string[] = [];

        if (shouldUseLegacy) {
          modulePath = deriveModulePath(n);
        } else if (nodePathMap && nodePathMap.has(n.id)) {
          modulePath = nodePathMap.get(n.id)!;
        } else if (n.type === 'external_dependency' && n.modulePath) {
          modulePath = n.modulePath;
        } else {
          modulePath = ['Other'];
        }

        return {
          ...n,
          modulePath,
          module: getDisplayModule(modulePath, activeModule)
        };
      });
      return { ...prev, nodes: reEnrichedNodes };
    });

    // Reset active module when switching modes to avoid invalid states
    if (activeModule) setActiveModule(null);

  }, [groupingData, activeGroupingMode]);

  // Calculate Total Counts & Module Counts (based on Raw Data)
  const { totalNodeCounts, moduleCounts } = useMemo(() => {
    const tCounts: Record<string, number> = {};
    const mCounts: Record<string, number> = {};

    rawData.nodes.forEach(n => {
      tCounts[n.type] = (tCounts[n.type] || 0) + 1;
      // Calculate available modules based on CURRENT active module
      if (n.modulePath) {
        // Determine what group this node belongs to in the current view context
        const displayGroup = getDisplayModule(n.modulePath, activeModule);
        if (displayGroup !== 'External') {
          mCounts[displayGroup] = (mCounts[displayGroup] || 0) + 1;
        }
      }
    });

    return { totalNodeCounts: tCounts, moduleCounts: mCounts };
  }, [rawData, activeModule]);

  const nodeLegendItems = useMemo(() => {
    // Collect unique modules from the current view for the 'module' mode
    const uniqueModules = Object.keys(moduleCounts);
    return getNodeLegendItems(activeColorMode, groupingData, uniqueModules);
  }, [activeColorMode, groupingData, moduleCounts]);

  // Initial active filters (all true by default)
  const initialFilters = useMemo(() => {
    const filters: Record<string, boolean> = {};
    if (rawData.nodes) {
      rawData.nodes.forEach(n => {
        filters[n.type] = true;
      });
    }
    return filters;
  }, [rawData]);

  const [filters, setFilters] = useState<Record<string, boolean>>({});

  // Sync initial filters when data loads
  useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      setFilters(initialFilters);
    }
  }, [initialFilters]);

  // --- Filtering Engine ---
  const filteredData = useMemo(() => {
    if (!rawData.nodes || !rawData.edges) return { nodes: [], edges: [] };

    // 0. Pre-calculate Total Degrees from Raw Data (for visual sizing)
    const totalDegreeMap = new Map<string, number>();
    rawData.edges.forEach(e => {
      totalDegreeMap.set(e.from, (totalDegreeMap.get(e.from) || 0) + 1);
      totalDegreeMap.set(e.to, (totalDegreeMap.get(e.to) || 0) + 1);
    });

    // 1. Identify Context Nodes (Progressive Expansion)
    // If a node is selected, we want to force it and its neighbors to be visible
    const contextNodeIds = new Set<string>();

    // 2. Identify Module Nodes (If Active Module)
    const moduleNodeIds = new Set<string>();
    if (activeModule) {
      // Split active module string into path parts for matching
      // e.g. "Frontend/Features" -> ["Frontend", "Features"]
      const activeParts = activeModule.split('/');

      rawData.nodes.forEach(n => {
        // Check if node is essentially "inside" the active module hierarchy
        // It should match the prefix
        if (n.modulePath && n.modulePath.length >= activeParts.length) {
          const isMatch = activeParts.every((part, i) => n.modulePath![i] === part);
          if (isMatch) {
            moduleNodeIds.add(n.id);
          }
        }
      });

      // Add 1-hop neighbors for context
      // This makes the "Cluster" view useful by showing inputs/outputs
      rawData.edges.forEach(e => {
        if (moduleNodeIds.has(e.from)) moduleNodeIds.add(e.to);
        if (moduleNodeIds.has(e.to)) moduleNodeIds.add(e.from);
      });
    }

    if (selectedNode) {
      contextNodeIds.add(selectedNode.id);
      rawData.edges.forEach(e => {
        if (e.from === selectedNode.id) contextNodeIds.add(e.to);
        if (e.to === selectedNode.id) contextNodeIds.add(e.from);
      });
    }

    // 3. Filter Nodes & Attach Total Degree
    const visibleNodes = rawData.nodes.filter(n => {
      // A. Filter by Module (High Priority Filter)
      // If a module is active, we ONLY show nodes in that module scope (+neighbors)
      // Unless it's also the specifically selected node context
      if (activeModule && !moduleNodeIds.has(n.id)) {
        return false;
      }

      // B. Filter by Explicit Type Toggle (Sidebar)
      if (filters[n.type] === false) return false;

      // C. Check Selection Context
      // If a node is selected, it should be visible even if view mode would hide it
      if (contextNodeIds.has(n.id)) return true;

      // D. Filter by View Mode (Frontend vs Backend)
      if (graphView === 'frontend') {
        return FRONTEND_TYPES.has(n.type);
      }
      if (graphView === 'backend') {
        return BACKEND_TYPES.has(n.type);
      }

      // Unified view shows everything
      return true;
    }).map(n => ({
      ...n,
      // DYNAMIC MODULE ASSIGNMENT:
      // Update the 'module' property used by GraphCanvas to reflect the *current* grouping level
      module: getDisplayModule(n.modulePath || [], activeModule),
      totalDegree: totalDegreeMap.get(n.id) || 0
    }));

    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

    // 4. Filter Edges
    const visibleEdges = rawData.edges.filter(e =>
      visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to)
    );

    return {
      nodes: visibleNodes,
      edges: visibleEdges
    };
  }, [rawData, filters, graphView, selectedNode, activeModule]);

  // Derived context value
  const contextValue: GraphContextType = {
    data: filteredData,
    details,
    isDetailsLoading,
    totalNodeCounts,
    moduleCounts,
    selectedNode,
    setSelectedNode,
    filters,
    setFilters,
    hoveredNode,
    setHoveredNode,
    focusMode,
    setFocusMode,
    viewMode,
    setViewMode,
    graphView,
    setGraphView,
    activeModule,
    setActiveModule,
    groupingData,
    activeGroupingMode,
    setActiveGroupingMode,
    activeColorMode,
    setActiveColorMode,
    gitMetadata,
    dependencyData
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="font-mono text-sm">Loading architecture data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen bg-slate-950 items-center justify-center text-red-400">
        <div className="flex flex-col items-center gap-4 p-6 border border-red-900/50 bg-red-900/10 rounded-lg max-w-md text-center">
          <AlertCircle className="w-10 h-10" />
          <h2 className="text-lg font-bold">Error Loading Graph</h2>
          <p className="font-mono text-xs">{error}</p>
          <p className="text-xs text-slate-500 mt-2">Ensure 'codebase-graph.json' is in the root directory.</p>
        </div>
      </div>
    );
  }

  return (
    <GraphContext.Provider value={contextValue}>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-200">
        {/* Main Canvas Area */}
        <main className="flex-1 relative h-full w-full">
          {useWebglRenderer ? <GraphCanvasWebGL /> : <GraphCanvas />}

          {/* Overlay Info / Legend Box */}
          <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
            <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-lg border border-slate-700/50 shadow-xl pointer-events-auto w-64">
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Layout className="w-5 h-5 text-indigo-400" />
                Skillmeat Architecture
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {filteredData.nodes.length} visible nodes • {filteredData.edges.length} edges
              </p>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded ${graphView === 'unified' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800'}`}>
                  {graphView.toUpperCase()} VIEW
                </span>
                {activeModule && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {activeModule}
                  </span>
                )}
              </div>

              {/* Expandable Node Legend Toggle */}
              <button
                onClick={() => setIsNodeLegendOpen(!isNodeLegendOpen)}
                className="w-full mt-3 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1 border-t border-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-500/50" />
                  <span className="font-medium">Node Color: {activeColorMode.charAt(0).toUpperCase() + activeColorMode.slice(1)}</span>
                </div>
                {isNodeLegendOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {/* Node Legend Content */}
              {isNodeLegendOpen && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 animate-in slide-in-from-top-1 fade-in duration-200 max-h-48 overflow-y-auto custom-scrollbar pr-1 mb-2">
                  {nodeLegendItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 p-1 rounded hover:bg-slate-800/50 transition-colors">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color, boxShadow: `0 0 4px ${item.color}40` }} />
                      <span className="text-[10px] text-slate-400 capitalize truncate leading-tight">{item.label}</span>
                    </div>
                  ))}
                  {nodeLegendItems.length === 0 && (
                    <p className="text-[10px] text-slate-600 italic px-1">No specific legend for this mode</p>
                  )}
                </div>
              )}

              {/* Expandable Edge Legend Toggle */}
              <button
                onClick={() => setIsLegendOpen(!isLegendOpen)}
                className="w-full mt-1 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1 border-t border-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <GitBranch size={12} />
                  <span className="font-medium">Edge Legend</span>
                </div>
                {isLegendOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {/* Edge Legend Content */}
              {isLegendOpen && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 animate-in slide-in-from-top-1 fade-in duration-200 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {Object.entries(EDGE_STYLES).filter(([key]) => key !== 'default').map(([key, style]) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 p-1 rounded hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="w-6 flex items-center justify-center flex-shrink-0">
                        <div
                          className="w-full"
                          style={{
                            height: `${style.width}px`,
                            backgroundColor: style.stroke,
                            borderBottom: style.dash ? `1px dashed ${style.stroke}` : 'none',
                            background: style.dash ? 'none' : style.stroke,
                            borderTop: style.dash ? `2px dashed ${style.stroke}` : 'none',
                          }}
                        ></div>
                      </div>
                      <span className="text-[10px] text-slate-400 capitalize truncate leading-tight">{key.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Sidebar Controls */}
        <aside className="w-96 h-full border-l border-slate-800 bg-slate-900/95 backdrop-blur-sm shadow-2xl z-20 flex flex-col transition-all duration-300">
          <Sidebar />
        </aside>
      </div>
    </GraphContext.Provider>
  );
};

export default App;
