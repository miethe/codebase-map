
import React, { useContext, useMemo, useState } from 'react';
import { GraphContext } from '../App';
import { NODE_COLORS, EDGE_STYLES, Node, Edge } from '../types';
import {
    Search, Filter, Layers, Zap, Database, Globe, Box, Info,
    GitGraph, Grid, Server, Terminal, FileCode, GitBranch,
    ChevronDown, ChevronRight, ArrowRight, Activity, Laptop, LayoutGrid, Focus, Check, Minus, Workflow, ChevronLeft, Home, Download
} from 'lucide-react';
import { computeClusterMetrics } from '../utils/graphAnalytics';
import { generateCursorRules } from '../utils/rulesGenerator';

// --- Helper Components ---

interface CollapsibleSectionProps {
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    count?: number;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, icon, children, defaultOpen = true, count }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-slate-800 last:border-0 flex-shrink-0">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-900/50 transition-colors group"
            >
                <div className="flex items-center gap-2 font-medium text-slate-300 group-hover:text-slate-200">
                    {icon && <span className="text-slate-500 group-hover:text-indigo-400 transition-colors">{icon}</span>}
                    <span className="text-sm">{title}</span>
                    {count !== undefined && (
                        <span className="text-xs bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full ml-2">
                            {count}
                        </span>
                    )}
                </div>
                {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
            </button>
            {isOpen && (
                <div className="px-4 pb-4 animate-in slide-in-from-top-1 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
};

// --- Logic Helpers ---

const getMethodColor = (method?: string) => {
    switch (method?.toUpperCase()) {
        case 'GET': return 'bg-blue-600/20 text-blue-400 border-blue-600/30';
        case 'POST': return 'bg-green-600/20 text-green-400 border-green-600/30';
        case 'PUT': return 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30';
        case 'DELETE': return 'bg-red-600/20 text-red-400 border-red-600/30';
        case 'PATCH': return 'bg-purple-600/20 text-purple-400 border-purple-600/30';
        default: return 'bg-slate-600/20 text-slate-400 border-slate-600/30';
    }
};

const getIconForType = (type: string) => {
    switch (type) {
        case 'route': return <Globe size={14} />;
        case 'api_endpoint': return <Zap size={14} />;
        case 'model': return <Database size={14} />;
        case 'component': return <Box size={14} />;
        case 'service': return <Server size={14} />;
        case 'hook': return <Terminal size={14} />;
        case 'file': return <FileCode size={14} />;
        default: return <Layers size={14} />;
    }
};

const formatNodeLabel = (node: Node) => {
    if (node.label) return node.label;
    let label = node.id.split(':').pop() || node.id;
    return label.replace(/^skillmeat\/(web|api|core|cache)\//, '').replace(/^app\//, '');
};

// BFS to find all downstream nodes
const getDownstreamNodes = (startNodeId: string, allEdges: Edge[], allNodes: Node[]) => {
    const visited = new Set<string>();
    const result: Node[] = [];
    const queue = [startNodeId];

    // Create adjacency map for faster lookup
    const adj = new Map<string, string[]>();
    allEdges.forEach(e => {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
    });

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const neighbors = adj.get(currentId) || [];

        for (const nextId of neighbors) {
            if (!visited.has(nextId)) {
                visited.add(nextId);
                const nodeObj = allNodes.find(n => n.id === nextId);
                if (nodeObj) {
                    result.push(nodeObj);
                    queue.push(nextId);
                }
            }
        }
    }
    return result;
};

// --- Main Component ---

export const Sidebar: React.FC = () => {
    const {
        data,
        details,
        isDetailsLoading,
        totalNodeCounts,
        moduleCounts,
        selectedNode,
        setSelectedNode,
        filters,
        setFilters,
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
        setActiveColorMode
    } = useContext(GraphContext);
    const [searchTerm, setSearchTerm] = useState("");

    const toggleFilter = (type: string) => {
        setFilters({ ...filters, [type]: !filters[type] });
    };

    // Logic for Toggle All / Indeterminate Checkbox
    const allTypes = useMemo(() => Object.keys(totalNodeCounts), [totalNodeCounts]);
    const activeTypeCount = allTypes.filter(t => filters[t]).length;
    const isAllChecked = activeTypeCount === allTypes.length && allTypes.length > 0;
    const isIndeterminate = activeTypeCount > 0 && !isAllChecked;

    const handleToggleAll = () => {
        const targetState = !isAllChecked; // If all are checked, uncheck all. Otherwise, check all.
        const newFilters = { ...filters };
        allTypes.forEach(t => {
            newFilters[t] = targetState;
        });
        setFilters(newFilters);
    };

    const immediateEdges = useMemo(() => {
        if (!selectedNode) return [];
        return data.edges.filter(e => e.from === selectedNode.id).map(e => {
            const targetNode = data.nodes.find(n => n.id === e.to);
            return { edge: e, targetNode };
        }).filter(item => item.targetNode);
    }, [selectedNode, data]);

    const downstreamNodes = useMemo(() => {
        if (!selectedNode) return [];
        return getDownstreamNodes(selectedNode.id, data.edges, data.nodes);
    }, [selectedNode, data]);

    // Compute Metrics for Active Module
    const activeModuleMetrics = useMemo(() => {
        if (!activeModule) return null;
        // Filter nodes belonging to active module
        // We use startsWith because we want the subtree
        const clusterNodes = data.nodes.filter(n => n.modulePath && n.modulePath.join('/').startsWith(activeModule));
        return computeClusterMetrics(clusterNodes, data.edges);
    }, [activeModule, data.nodes, data.edges]);

    const handleExportRules = () => {
        const rules = generateCursorRules(data, activeModule);
        const blob = new Blob([rules], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '.cursorrules';
        a.click();
        URL.revokeObjectURL(url);
    };

    // Merge basic node properties with rich details properties
    const additionalDetails = useMemo(() => {
        if (!selectedNode) return [];
        const ignoredKeys = new Set(['id', 'type', 'label', 'file', 'x', 'y', 'fx', 'fy', 'vx', 'vy', 'index', 'method', 'path', 'raw_method', 'raw_path', 'summary', 'degree', 'totalDegree', 'module']);

        const basicProps = Object.entries(selectedNode)
            .filter(([key]) => !ignoredKeys.has(key))
            .map(([key, value]) => ({ key, value }));

        if (details?.nodes?.[selectedNode.id]) {
            const detailNode = details.nodes[selectedNode.id];
            // Add specific rich fields if they exist and aren't already covered
            if (detailNode.returns) basicProps.push({ key: 'returns', value: detailNode.returns });
            // We'll handle docstring/signature/imports via specialized UI blocks, not generic Key/Value
        }

        return basicProps;
    }, [selectedNode, details]);

    return (
        <div className="flex flex-col h-full overflow-hidden text-sm select-none">
            {/* Search Header */}
            <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900/50 flex-shrink-0">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search nodes..."
                        className="w-full bg-slate-800 text-slate-200 pl-9 pr-4 py-2 rounded-md border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs placeholder:text-slate-600"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Layout Modes */}
                <div className="flex bg-slate-800 p-1 rounded-md border border-slate-700">
                    <button
                        onClick={() => setViewMode('force')}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded text-xs font-medium transition-colors ${viewMode === 'force' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        title="Force Directed Layout"
                    >
                        <GitGraph size={14} />
                        Map
                    </button>
                    <button
                        onClick={() => setViewMode('hierarchical')}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded text-xs font-medium transition-colors ${viewMode === 'hierarchical' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        title="Architectural Systems View"
                    >
                        <Workflow size={14} />
                        Systems
                    </button>
                    <button
                        onClick={() => setViewMode('structured')}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-2 rounded text-xs font-medium transition-colors ${viewMode === 'structured' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        title="Structured Columns Layout"
                    >
                        <Grid size={14} />
                        Stacked
                    </button>
                </div>

                {/* Graph Scope Views */}
                <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500 ml-1">Domain Scope</span>
                    <div className="flex bg-slate-800 p-1 rounded-md border border-slate-700">
                        <button
                            onClick={() => setGraphView('frontend')}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors ${graphView === 'frontend' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        >
                            <Laptop size={12} />
                            Front
                        </button>
                        <button
                            onClick={() => setGraphView('backend')}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors ${graphView === 'backend' ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        >
                            <Server size={12} />
                            Back
                        </button>
                        <button
                            onClick={() => setGraphView('unified')}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors ${graphView === 'unified' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                        >
                            <LayoutGrid size={12} />
                            All
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">

                {/* Node Selection State */}
                {selectedNode ? (
                    <>
                        {/* --- Node Details Section --- */}
                        <CollapsibleSection title="Node Details" icon={<Info size={14} />} defaultOpen={true}>
                            <div className="space-y-4">
                                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                            style={{
                                                backgroundColor: NODE_COLORS[selectedNode.type] || '#ccc',
                                                boxShadow: `0 0 10px ${NODE_COLORS[selectedNode.type]}40`
                                            }}
                                        />
                                        <span className="uppercase text-[10px] font-bold text-slate-400 tracking-wider">
                                            {selectedNode.type.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <h2 className="text-lg font-semibold text-white break-words leading-tight">
                                        {formatNodeLabel(selectedNode)}
                                    </h2>
                                </div>

                                <div className="grid gap-2">
                                    {selectedNode.type === 'api_endpoint' && (
                                        <div className="p-3 bg-slate-900 rounded border border-slate-800 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-500">Method</span>
                                                {selectedNode.method && (
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getMethodColor(selectedNode.method)}`}>
                                                        {selectedNode.method}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-xs text-slate-500 block">Path</span>
                                                <code className="text-xs text-slate-300 break-all block bg-slate-950 p-1.5 rounded border border-slate-800/50">
                                                    {selectedNode.path || selectedNode.raw_path}
                                                </code>
                                            </div>
                                            {selectedNode.summary && (
                                                <div className="text-xs text-slate-400 italic border-l-2 border-slate-700 pl-2 mt-2">
                                                    {selectedNode.summary}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {selectedNode.file && (
                                        <div className="space-y-1">
                                            <span className="text-[10px] uppercase font-bold text-slate-500">Source File</span>
                                            <div className="p-2 bg-slate-900 rounded border border-slate-800 font-mono text-xs text-slate-400 break-all flex items-start gap-2 group cursor-help" title={selectedNode.file}>
                                                <FileCode size={12} className="mt-0.5 flex-shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors" />
                                                {selectedNode.file}
                                            </div>
                                        </div>
                                    )}

                                    {selectedNode.module && (
                                        <div className="space-y-1">
                                            <span className="text-[10px] uppercase font-bold text-slate-500">Cluster</span>
                                            <div className="p-1.5 bg-slate-900 rounded border border-slate-800 text-xs text-emerald-400 flex items-center gap-2">
                                                <Focus size={12} />
                                                {selectedNode.module}
                                            </div>
                                        </div>
                                    )}

                                    {additionalDetails.length > 0 && (
                                        <div className="space-y-1 pt-2">
                                            <span className="text-[10px] uppercase font-bold text-slate-500">Properties</span>
                                            <div className="bg-slate-900 rounded border border-slate-800 divide-y divide-slate-800/50">
                                                {additionalDetails.map(({ key, value }) => (
                                                    <div key={key} className="flex justify-between p-2 text-xs">
                                                        <span className="text-slate-500 font-mono">{key}</span>
                                                        <span className="text-slate-300 font-mono text-right truncate max-w-[150px]" title={String(value)}>
                                                            {String(value)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-2">
                                        <span className="text-[10px] uppercase font-bold text-slate-600">ID</span>
                                        <div className="text-[10px] text-slate-700 font-mono break-all select-all mt-0.5">
                                            {selectedNode.id}
                                        </div>
                                    </div>

                                    {/* Rich Detail Blocks */}
                                    {details && details.nodes && details.nodes[selectedNode.id] && (
                                        <div className="space-y-4 pt-2 border-t border-slate-800/50 animate-in fade-in duration-500">
                                            {/* Signature */}
                                            {details.nodes[selectedNode.id].signature && (
                                                <div className="space-y-1">
                                                    <span className="text-[10px] uppercase font-bold text-slate-500">Signature</span>
                                                    <pre className="p-2 bg-slate-950 rounded border border-slate-800 text-[10px] text-indigo-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                                        {details.nodes[selectedNode.id].signature}
                                                    </pre>
                                                </div>
                                            )}

                                            {/* Docstring */}
                                            {(details.nodes[selectedNode.id].docstring || details.nodes[selectedNode.id].doc_summary) && (
                                                <div className="space-y-1">
                                                    <span className="text-[10px] uppercase font-bold text-slate-500">Documentation</span>
                                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-800 text-xs text-slate-300 font-sans whitespace-pre-line leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                                                        {details.nodes[selectedNode.id].docstring || details.nodes[selectedNode.id].doc_summary}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Imports */}
                                            {details.nodes[selectedNode.id].imports && (details.nodes[selectedNode.id].imports?.length ?? 0) > 0 && (
                                                <div className="space-y-1">
                                                    <span className="text-[10px] uppercase font-bold text-slate-500">Imports</span>
                                                    <div className="flex flex-wrap gap-1">
                                                        {details.nodes[selectedNode.id].imports!.slice(0, 10).map((imp) => (
                                                            <span key={imp} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-400 font-mono">
                                                                {imp}
                                                            </span>
                                                        ))}
                                                        {(details.nodes[selectedNode.id].imports!.length > 10) && (
                                                            <span className="px-1.5 py-0.5 bg-slate-800/50 rounded text-[10px] text-slate-500">
                                                                +{details.nodes[selectedNode.id].imports!.length - 10} more
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {isDetailsLoading && !details && (
                                        <div className="p-2 text-center text-xs text-slate-500 animate-pulse">
                                            Loading extended details...
                                        </div>
                                    )}
                                </div>

                                <div className="pt-2">
                                    <button
                                        onClick={() => setFocusMode(!focusMode)}
                                        className={`w-full text-xs py-2 rounded flex items-center justify-center gap-2 transition-all ${focusMode
                                            ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-200'}`}
                                    >
                                        <Activity size={14} />
                                        {focusMode ? 'Disable Focus Mode' : 'Focus Downstream Flow'}
                                    </button>
                                </div>
                            </div>
                        </CollapsibleSection>

                        {/* --- Outgoing Connections (Edges) --- */}
                        <CollapsibleSection
                            title="Outgoing Edges"
                            icon={<GitBranch size={14} />}
                            count={immediateEdges.length}
                            defaultOpen={true}
                        >
                            {immediateEdges.length > 0 ? (
                                <div className="space-y-2">
                                    {immediateEdges.map((item, idx) => {
                                        const edgeKey = `${item.edge.from}->${item.edge.to}:${item.edge.type}`;
                                        const edgeDetail = details?.edges?.[edgeKey];

                                        return (
                                            <div
                                                key={item.edge.from + item.edge.to + idx}
                                                className="flex flex-col gap-1 p-2 rounded bg-slate-800/30 border border-slate-800 hover:bg-slate-800 hover:border-slate-600 transition-all cursor-pointer group"
                                                onClick={() => item.targetNode && setSelectedNode(item.targetNode)}
                                                title={`Type: ${item.edge.type}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[10px] uppercase text-slate-500 mb-0.5 font-bold flex items-center gap-1">
                                                            <div
                                                                className="h-px w-3"
                                                                style={{ backgroundColor: EDGE_STYLES[item.edge.type]?.stroke || '#64748b' }}
                                                            />
                                                            {item.edge.type.replace(/_/g, ' ')}
                                                        </div>
                                                        <div className="text-xs text-slate-300 truncate font-mono group-hover:text-indigo-300 transition-colors">
                                                            {formatNodeLabel(item.targetNode!)}
                                                        </div>
                                                    </div>
                                                    <ArrowRight size={12} className="text-slate-600 group-hover:text-indigo-400 transform group-hover:translate-x-0.5 transition-all" />
                                                </div>

                                                {edgeDetail?.callsite && (
                                                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono mt-0.5 pt-1 border-t border-slate-700/30">
                                                        <FileCode size={8} />
                                                        <span className="truncate">
                                                            {edgeDetail.callsite.file?.split('/').pop()}:{edgeDetail.callsite.line}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-500 italic p-2 text-center">No outgoing connections.</p>
                            )}
                        </CollapsibleSection>
                    </>
                ) : (
                    <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center opacity-60">
                        <Info className="w-12 h-12 mb-4 opacity-30" />
                        <p className="text-sm font-medium">No Node Selected</p>
                        <p className="text-xs mt-2 max-w-[200px]">Click on any node in the graph to view its details, connections, and dependencies.</p>
                    </div>
                )}

                <div className="border-t border-slate-800 my-2"></div>

                {/* --- Global Controls Sections (Always Visible) --- */}

                <CollapsibleSection title="Display Settings" icon={<Layers size={14} />} defaultOpen={true}>
                    <div className="space-y-4">
                        {/* Grouping Strategy */}
                        {groupingData && (
                            <div className="space-y-1.5">
                                <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Grouping Strategy</label>
                                <div className="relative">
                                    <select
                                        value={activeGroupingMode}
                                        onChange={(e) => setActiveGroupingMode(e.target.value)}
                                        className="w-full bg-slate-800 text-slate-300 text-xs rounded border border-slate-700 py-1.5 pl-2 pr-8 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 appearance-none transition-colors cursor-pointer hover:bg-slate-700"
                                    >
                                        {groupingData.group_sets.map((set: any) => (
                                            <option key={set.id} value={set.id}>{set.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={12} className="absolute right-2.5 top-2.5 text-slate-500 pointer-events-none" />
                                </div>
                            </div>
                        )}

                        {/* Color By Strategy */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Color Nodes By</label>
                            <div className="relative">
                                <select
                                    value={activeColorMode}
                                    onChange={(e) => setActiveColorMode(e.target.value)}
                                    className="w-full bg-slate-800 text-slate-300 text-xs rounded border border-slate-700 py-1.5 pl-2 pr-8 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 appearance-none transition-colors cursor-pointer hover:bg-slate-700"
                                >
                                    <option value="type">Node Type (Default)</option>
                                    <option value="module">Top-Level Module</option>
                                    {groupingData?.group_sets.map((set: any) => (
                                        <option key={`color-${set.id}`} value={set.id}>Group: {set.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={12} className="absolute right-2.5 top-2.5 text-slate-500 pointer-events-none" />
                            </div>
                        </div>
                    </div>
                </CollapsibleSection>

                {/* Module / Cluster Focus */}
                <CollapsibleSection title="Focus Cluster" icon={<Focus size={14} />} defaultOpen={true}>
                    <div className="space-y-2">

                        {/* Breadcrumb / Back Navigation */}
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                            {activeModule ? (
                                <button
                                    onClick={() => {
                                        const parts = activeModule.split('/');
                                        if (parts.length > 1) {
                                            parts.pop();
                                            setActiveModule(parts.join('/'));
                                        } else {
                                            setActiveModule(null);
                                        }
                                    }}
                                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    <ChevronLeft size={12} />
                                    Back
                                </button>
                            ) : (
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                    <Home size={10} /> Root
                                </span>
                            )}
                            <div className="h-3 w-px bg-slate-700 mx-1"></div>
                            <span className="text-xs font-mono text-slate-300 truncate">
                                {activeModule ? activeModule.replace(/\//g, ' > ') : 'All Modules'}
                            </span>
                        </div>

                        {/* List of Child Modules (Drill Down Options) */}
                        <div className="space-y-1">
                            {Object.entries(moduleCounts).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).map(([moduleName, count]) => {
                                // If we are drilling down, we append the selected child to the current path
                                const nextPath = activeModule ? `${activeModule}/${moduleName}` : moduleName;
                                return (
                                    <button
                                        key={moduleName}
                                        onClick={() => setActiveModule(nextPath)}
                                        className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors text-slate-400 hover:bg-slate-800 hover:text-slate-200 group`}
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <span className="truncate">{moduleName}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] opacity-60 bg-slate-900 px-1 rounded text-slate-500">{count}</span>
                                            <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500" />
                                        </div>
                                    </button>
                                );
                            })}

                            {Object.keys(moduleCounts).length === 0 && (
                                <div className="text-xs text-slate-600 italic px-2 py-1">
                                    No further sub-modules.
                                </div>
                            )}
                        </div>

                        {activeModule && (
                            <button
                                onClick={() => setActiveModule(null)}
                                className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors flex items-center justify-center gap-1 border-t border-slate-800/50 pt-2"
                            >
                                <Home size={10} /> Return to Root
                            </button>
                        )}
                    </div>
                </CollapsibleSection>

                {/* Cluster Metrics (Phase 5) */}
                {activeModule && activeModuleMetrics && (
                    <CollapsibleSection title="Cluster Health" icon={<Activity size={14} />} defaultOpen={true}>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-800">
                                <div className="text-[10px] text-slate-500 uppercase">Cohesion</div>
                                <div className={`text-lg font-mono ${activeModuleMetrics.cohesion > 0.5 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                    {(activeModuleMetrics.cohesion * 100).toFixed(0)}%
                                </div>
                            </div>
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-800">
                                <div className="text-[10px] text-slate-500 uppercase">Coupling</div>
                                <div className={`text-lg font-mono ${activeModuleMetrics.coupling > 0.3 ? 'text-orange-400' : 'text-slate-300'}`}>
                                    {(activeModuleMetrics.coupling * 100).toFixed(0)}%
                                </div>
                            </div>
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-800">
                                <div className="text-[10px] text-slate-500 uppercase">Instability</div>
                                <div className="text-lg font-mono text-slate-300">
                                    {activeModuleMetrics.instability.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-800 flex flex-col justify-center items-center cursor-pointer hover:bg-slate-800 transition-colors" onClick={handleExportRules}>
                                <Download size={16} className="text-indigo-400 mb-1" />
                                <div className="text-[10px] text-indigo-300 font-medium">Export Rules</div>
                            </div>
                        </div>
                    </CollapsibleSection>
                )}

                {/* Node Filters */}
                <CollapsibleSection title="Node Types" icon={<Filter size={14} />} defaultOpen={false}>
                    <div className="space-y-1">
                        {/* Toggle All Master Switch */}
                        <div
                            className="flex items-center justify-between p-2 mb-2 rounded bg-slate-800/50 hover:bg-slate-800 cursor-pointer border border-slate-700/50 transition-colors"
                            onClick={handleToggleAll}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isAllChecked || isIndeterminate
                                        ? 'bg-indigo-600 border-indigo-600'
                                        : 'bg-slate-700 border-slate-600'
                                        }`}
                                >
                                    {isAllChecked && <Check size={10} className="text-white" />}
                                    {isIndeterminate && <Minus size={10} className="text-white" />}
                                </div>
                                <span className="text-xs font-medium text-slate-300">Toggle All Types</span>
                            </div>
                        </div>

                        {Object.entries(totalNodeCounts).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).map(([type, count]) => (
                            <label
                                key={type}
                                className="flex items-center justify-between p-2 rounded hover:bg-slate-800 cursor-pointer group transition-colors"
                                title={`Toggle visibility for ${type} nodes`}
                            >
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={!!filters[type]}
                                        onChange={() => toggleFilter(type)}
                                        className="rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-offset-slate-900 accent-indigo-500"
                                    />
                                    <div className="flex items-center gap-2 text-slate-300 group-hover:text-white transition-colors">
                                        <span style={{ color: NODE_COLORS[type] }}>{getIconForType(type)}</span>
                                        <span className="capitalize text-xs">{type.replace('_', ' ')}</span>
                                    </div>
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                    {count}
                                </span>
                            </label>
                        ))}
                    </div>
                </CollapsibleSection>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-900 text-[10px] text-center text-slate-600 font-mono flex-shrink-0">
                {data.generated_at ? `Generated: ${new Date(data.generated_at!).toLocaleDateString()}` : 'Skillmeat Architecture v1.0'}
            </div>
        </div>
    );
};
