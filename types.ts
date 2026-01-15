
export interface Node {
  id: string;
  type: string;
  label?: string; // Optional, inferred from ID if missing
  file?: string;
  // API Normalization fields
  method?: string;
  method_inferred?: boolean;
  operation_id?: string;
  path?: string;
  raw_method?: string;
  raw_path?: string;
  summary?: string;
  // D3 simulation properties (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
  index?: number;
  // Calculated properties
  degree?: number; // Number of VISIBLE connections (for physics/charge)
  totalDegree?: number; // Number of TOTAL connections in raw graph (for visual sizing)
  module?: string; // The architectural cluster this node belongs to
  modulePath?: string[]; // Hierarchical path for drill-down (e.g. ['Frontend', 'Features', 'Maketplace'])
}

export interface Edge {
  from: string;
  to: string;
  type: string;
  // D3 simulation properties (added at runtime)
  source?: Node | string;
  target?: Node | string;
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  generated_at?: string;
  schema_version?: string;
  source?: string;
  source_commit?: string;
}

export type ViewMode = 'force' | 'structured' | 'hierarchical';
export type GraphViewMode = 'unified' | 'frontend' | 'backend';

export interface NodeDetail {
  docstring?: string;
  doc_summary?: string;
  signature?: string;
  imports?: string[];
  params?: string[];
  returns?: string;
  decorators?: string[] | null;
}

export interface EdgeDetail {
  callsite?: {
    file: string;
    line: number;
  };
  notes?: string;
}

export interface DetailsData {
  nodes: Record<string, NodeDetail>;
  edges: Record<string, EdgeDetail>;
  generated_at?: string;
  source_commit?: string;
}

export interface GraphContextType {
  data: GraphData; // The filtered data shown on canvas
  details: DetailsData | null; // The rich details loaded asynchronously
  isDetailsLoading: boolean;
  totalNodeCounts: Record<string, number>; // Stats based on raw data (for sidebar)
  moduleCounts: Record<string, number>; // Stats for modules
  selectedNode: Node | null;
  setSelectedNode: (node: Node | null) => void;
  filters: Record<string, boolean>;
  setFilters: (filters: Record<string, boolean>) => void;
  hoveredNode: Node | null;
  setHoveredNode: (node: Node | null) => void;
  focusMode: boolean;
  setFocusMode: (focus: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  graphView: GraphViewMode;
  setGraphView: (mode: GraphViewMode) => void;
  activeModule: string | null;
  setActiveModule: (module: string | null) => void;
}

// Configuration for Node Sizing based on Total Degree
// Radius = base + (log(totalDegree + 1) * factor)
export const NODE_SIZE_CONFIG = {
  baseRadius: 5,
  scaleFactor: 2.8,
  maxRadius: 25,
};

export const NODE_COLORS: Record<string, string> = {
  route: '#a855f7', // purple-500
  page: '#3b82f6', // blue-500
  component: '#22d3ee', // cyan-400
  hook: '#10b981', // emerald-500
  api_endpoint: '#f97316', // orange-500
  endpoint: '#f97316', // orange-500 alias
  handler: '#ef4444', // red-500
  service: '#eab308', // yellow-500
  model: '#ec4899', // pink-500
  repository: '#6366f1', // indigo-500
  schema: '#8b5cf6', // violet-500
  migration: '#64748b', // slate-500
  router: '#d946ef', // fuchsia-500
  api_client: '#14b8a6', // teal-500
  type: '#94a3b8', // slate-400
  query_key: '#84cc16', // lime-500
};

export const EDGE_STYLES: Record<string, { stroke: string; width: number; dash?: string }> = {
  // Navigation
  route_to_page: { stroke: '#a855f7', width: 2, dash: '5,5' }, // Purple dashed
  router_exposes: { stroke: '#d946ef', width: 2 },

  // React
  uses_hook: { stroke: '#10b981', width: 1.5 },
  page_uses_component: { stroke: '#3b82f6', width: 1.5 },
  component_uses_component: { stroke: '#22d3ee', width: 1.5 },
  component_uses_hook: { stroke: '#10b981', width: 1.5 },

  // API
  calls_api: { stroke: '#f97316', width: 3 }, // Thick orange
  api_client_calls_endpoint: { stroke: '#14b8a6', width: 2 },
  hook_calls_api_client: { stroke: '#14b8a6', width: 1.5, dash: '3,3' },

  // Backend
  handled_by: { stroke: '#ef4444', width: 2.5 }, // Red
  handler_calls_service: { stroke: '#eab308', width: 2 },

  // Data
  service_uses_model: { stroke: '#ec4899', width: 2 },
  repository_uses_model: { stroke: '#6366f1', width: 2 },
  service_calls_repository: { stroke: '#8b5cf6', width: 2 },

  // Misc
  default: { stroke: '#475569', width: 1 }
};
