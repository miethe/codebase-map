
export type NodeKind = 'repo' | 'package' | 'module' | 'folder' | 'file' | 'symbol' | 'cluster';
export type NodeLayer = 'ui' | 'api' | 'domain' | 'data' | 'infra' | 'tests' | 'shared' | 'external';
export type NodeExternality = 'internal' | 'vendor' | 'third_party';
export type EdgeDistanceClass = 'local' | 'cross-folder' | 'cross-module' | 'cross-package' | 'cross-service';
export type EdgeConfidence = 'static' | 'heuristic' | 'dynamic';
export type FocusMode = 'off' | 'flow' | 'upstream' | 'downstream' | 'k-hop';
export type LodMode = 'auto' | 'manual';

export const CLUSTER_KINDS = new Set(['cluster', 'package', 'module', 'folder']);

export interface Node {
  id: string;
  type: string;
  kind?: NodeKind;
  layer?: NodeLayer;
  cluster_id?: string;
  cluster_path?: string[];
  importance?: number;
  size?: number;
  hotness?: number;
  bus_factor?: number;
  entrypoint?: boolean;
  member_count?: number;
  externality?: NodeExternality;
  generated?: boolean;
  label_short?: string;
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
  metrics?: {
    pagerank?: number;
    degree_centrality?: number;
    community?: number;
  };
  // D3 simulation properties (added at runtime or pre-computed)
  x?: number;
  y?: number;
  z?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  vx?: number;
  vy?: number;
  vz?: number;
  index?: number;
  // Calculated properties
  degree?: number; // Number of VISIBLE connections (for physics/charge)
  totalDegree?: number; // Number of TOTAL connections in raw graph (for visual sizing)
  module?: string; // The architectural cluster this node belongs to
  modulePath?: string[]; // Hierarchical path for drill-down (e.g. ['Frontend', 'Features', 'Maketplace'])
  details?: { // For external dependencies
    version?: string;
    deptype?: string;
  };
}

export interface Edge {
  from: string;
  to: string;
  type: string;
  weight?: number;
  distance_class?: EdgeDistanceClass;
  confidence?: EdgeConfidence;
  bidirectional?: boolean;
  aggregated?: boolean;
  memberCount?: number;
  members?: Array<{ from: string; to: string; type?: string }>;
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

export interface GraphLODData {
  lod0?: GraphData;
  lod1?: GraphData;
  lod2?: GraphData;
  lod3?: GraphData;
  lod4?: GraphData;
}

export type CameraPresetId = 'default' | 'architecture' | 'backbone' | 'hotspots' | 'risk' | 'isometric' | 'top';
export type ExportPass = 'nodes' | 'edges' | 'labels' | 'highlights' | 'heatmap';

export interface ExportOptions {
  width: number;
  height: number;
  preset: CameraPresetId;
  orthographic: boolean;
  transparentBackground: boolean;
  useSeededLayout: boolean;
  passes: ExportPass[];
  seed: string;
}

export interface ExportRequest {
  id: string;
  options: ExportOptions;
}

export interface ExportStatus {
  state: 'idle' | 'running' | 'error' | 'done';
  message?: string;
  requestId?: string;
}

export interface CameraPresetRequest {
  id: CameraPresetId;
  runId: number;
}

export interface CameraJumpRequest {
  nodeId: string;
  runId: number;
}

export interface GroupSet {
  id: string;
  label: string;
  source: string;
  multi_membership: boolean;
  metadata: Record<string, any>;
}

export interface Group {
  group_set: string;
  id: string;
  label: string;
  nodes: string[];
  metadata: Record<string, any>;
}

export interface GroupingData {
  generated_at?: string;
  source_commit?: string;
  group_sets: GroupSet[];
  groups: Group[];
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
  lodData?: GraphLODData | null;
  details: DetailsData | null; // The rich details loaded asynchronously
  isDetailsLoading: boolean;
  layoutCacheSeed: string;
  totalNodeCounts: Record<string, number>; // Stats based on raw data (for sidebar)
  totalEdgeCounts: Record<string, number>; // Stats based on raw data (for sidebar)
  moduleCounts: Record<string, number>; // Stats for modules
  selectedNode: Node | null;
  setSelectedNode: (node: Node | null) => void;
  filters: Record<string, boolean>;
  setFilters: (filters: Record<string, boolean>) => void;
  edgeTypeFilters: Record<string, boolean>;
  setEdgeTypeFilters: (filters: Record<string, boolean>) => void;
  hideIntraFileEdges: boolean;
  setHideIntraFileEdges: (enabled: boolean) => void;
  hideTestGeneratedVendor: boolean;
  setHideTestGeneratedVendor: (enabled: boolean) => void;
  onlyCrossBoundaryEdges: boolean;
  setOnlyCrossBoundaryEdges: (enabled: boolean) => void;
  hoveredNode: Node | null;
  setHoveredNode: (node: Node | null) => void;
  focusMode: FocusMode;
  setFocusMode: (mode: FocusMode) => void;
  focusHopCount: number;
  setFocusHopCount: (count: number) => void;
  focusClusterId: string | null;
  setFocusClusterId: (clusterId: string | null) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  graphView: GraphViewMode;
  setGraphView: (mode: GraphViewMode) => void;
  activeModule: string | null;
  setActiveModule: (module: string | null) => void;
  // Grouping Support
  groupingData: GroupingData | null;
  activeGroupingMode: string; // ID of the active GroupSet
  setActiveGroupingMode: (mode: string) => void;
  // Visualization Support
  activeColorMode: string;
  setActiveColorMode: (mode: string) => void;
  enableMotionOptimizations: boolean;
  setEnableMotionOptimizations: (enabled: boolean) => void;
  enablePerformanceMode: boolean;
  setEnablePerformanceMode: (enabled: boolean) => void;
  lodMode: LodMode;
  setLodMode: (mode: LodMode) => void;
  zoomSpeed: number;
  setZoomSpeed: (value: number) => void;
  panSpeed: number;
  setPanSpeed: (value: number) => void;
  rotateSpeed: number;
  setRotateSpeed: (value: number) => void;
  zoomLevel: number;
  setZoomLevel: (value: number) => void;
  backboneEdgeDensity: number;
  setBackboneEdgeDensity: (value: number) => void;
  exportRequest: ExportRequest | null;
  setExportRequest: (request: ExportRequest | null) => void;
  exportStatus: ExportStatus;
  setExportStatus: (status: ExportStatus) => void;
  cameraPresetRequest: CameraPresetRequest | null;
  setCameraPresetRequest: (request: CameraPresetRequest | null) => void;
  cameraJumpRequest: CameraJumpRequest | null;
  setCameraJumpRequest: (request: CameraJumpRequest | null) => void;
  // Metadata Support
  gitMetadata: GitMetadata | null;
  dependencyData: DependencyGraph | null;
}

export interface GitMetadata {
  [filePath: string]: {
    last_modified: number;
    change_count: number;
    unique_authors: number;
  }
}

export interface DependencyGraph {
  nodes: Node[]; // Re-using Node type, but with type='external_dependency'
  edges: Edge[];
}

// Configuration for Node Sizing based on Total Degree
// Radius = base + (log(totalDegree + 1) * factor)
export const NODE_SIZE_CONFIG = {
  baseRadius: 5,
  scaleFactor: 2.8,
  maxRadius: 25,
};

export const NODE_COLORS: Record<string, string> = {
  repo: '#38bdf8', // sky-400
  package: '#34d399', // emerald-400
  module: '#22c55e', // green-500
  folder: '#fbbf24', // amber-400
  file: '#a78bfa', // violet-400
  symbol: '#f472b6', // pink-400
  cluster: '#94a3b8', // slate-400
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

export interface GraphRendererViewState {
  viewMode: ViewMode;
  focusMode: FocusMode;
  focusHopCount: number;
  focusClusterId: string | null;
  selectedNode: Node | null;
  activeColorMode: string;
  groupingData: GroupingData | null;
  gitMetadata: GitMetadata | null;
  enableMotionOptimizations: boolean;
  enablePerformanceMode: boolean;
  zoomSpeed: number;
  panSpeed: number;
  rotateSpeed: number;
  zoomLevel: number;
  exportRequest: ExportRequest | null;
  cameraPresetRequest: CameraPresetRequest | null;
  cameraJumpRequest: CameraJumpRequest | null;
  layoutCacheKey: string | null;
  lodLevel: number;
}

export interface GraphRendererHandlers {
  onNodeSelect: (node: Node | null) => void;
  onNodeExpand?: (node: Node) => void;
  onNodeHover: (node: Node | null) => void;
  onBackgroundClick?: () => void;
  onZoomChange?: (zoomLevel: number) => void;
  onExportStatus?: (status: ExportStatus) => void;
  onExportRequestHandled?: (requestId: string) => void;
}

export interface GraphRendererProps {
  data: GraphData;
  viewState: GraphRendererViewState;
  handlers: GraphRendererHandlers;
}
