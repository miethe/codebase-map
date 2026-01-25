import React, { useContext, useMemo, useCallback, useRef, useEffect } from 'react';
import { GraphContext } from '../App';
import { GraphCanvas } from './GraphCanvas';
import { GraphCanvasWebGL } from './GraphCanvasWebGL';
import { CLUSTER_KINDS, GraphRendererProps } from '../types';
import { useGraphLOD } from '../utils/useGraphLOD';
import { buildLayoutCacheKey } from '../utils/layoutCache';

export const GraphRenderer: React.FC = () => {
  const {
    data,
    selectedNode,
    setSelectedNode,
    setHoveredNode,
    focusMode,
    focusHopCount,
    focusClusterIds,
    drilldownContext,
    expandDepthMode,
    setFocusMode,
    setFocusClusterIds,
    addFocusClusterId,
    viewMode,
    activeColorMode,
    groupingData,
    activeGroupingMode,
    clusterLodData,
    gitMetadata,
    showMultiMembership,
    layeredLodEnabled,
    layerSpacing,
    showLodPlanes,
    dimDrilldownLabels,
    graphView,
    activeModule,
    setActiveModule,
    enableMotionOptimizations,
    enablePerformanceMode,
    lodMode,
    zoomSpeed,
    panSpeed,
    rotateSpeed,
    lodData,
    zoomLevel,
    setZoomLevel,
    backboneEdgeDensity,
    exportRequest,
    setExportRequest,
    setExportStatus,
    cameraPresetRequest,
    cameraJumpRequest,
    layoutCacheSeed
  } = useContext(GraphContext);

  // Track Ctrl/Cmd key state for multi-select
  const ctrlKeyRef = useRef(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) ctrlKeyRef.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) ctrlKeyRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const rendererMode = (import.meta.env.VITE_GRAPH_RENDERER || 'webgl').toLowerCase();
  const useWebglRenderer = rendererMode === 'webgl';

  const isClusterView = viewMode === 'clusters';
  const activeLodData = isClusterView ? clusterLodData : lodData;
  const baseData = isClusterView && clusterLodData?.lod0 ? clusterLodData.lod0 : data;
  const allowLod = Boolean(activeLodData)
    && (isClusterView || (graphView === 'unified' && !activeModule));
  const { graphData, toggleCluster, expandedClusters, expandedByDepth, popExpansion, lodLevel } = useGraphLOD({
    baseData,
    lodData: activeLodData,
    zoomLevel,
    allowLod,
    lodMode,
    focusClusterIds,
    backboneEdgeDensity,
    expandDepthMode
  });

  const getNodeDepth = (node: { lodDepth?: number; cluster_path?: string[] }) => {
    if (typeof node.lodDepth === 'number') return Math.max(0, Math.round(node.lodDepth));
    if (node.cluster_path?.length) return Math.max(0, node.cluster_path.length - 1);
    return 0;
  };

  const layoutCacheKey = useMemo(() => {
    if (!layoutCacheSeed) return null;
    const sourceTag = graphData.source || 'base';
    return buildLayoutCacheKey([layoutCacheSeed, sourceTag, `lod:${lodLevel}`]);
  }, [layoutCacheSeed, graphData.source, lodLevel]);

  const handleEscape = useCallback(() => {
    if (focusMode !== 'off') {
      setFocusMode('off');
      return;
    }
    if (expandedClusters.size > 0) {
      const depths = Array.from(expandedByDepth.keys()).sort((a, b) => a - b);
      const nextFocusDepth = depths.length > 1 ? depths[depths.length - 2] : null;
      const nextFocusId = nextFocusDepth !== null ? expandedByDepth.get(nextFocusDepth) : null;
      setFocusClusterIds(nextFocusId ? new Set([nextFocusId]) : null);
      popExpansion();
      if (isClusterView) {
        if (!nextFocusId) {
          setActiveModule(null);
        } else {
          const nextNode = graphData.nodes.find(node => node.id === nextFocusId || node.cluster_id === nextFocusId);
          const nextPath = nextNode?.modulePath;
          setActiveModule(nextPath?.length ? nextPath.join('/') : null);
        }
      }
      return;
    }
    if (selectedNode) {
      setSelectedNode(null);
    }
  }, [
    expandedByDepth,
    expandedClusters.size,
    focusMode,
    graphData.nodes,
    isClusterView,
    popExpansion,
    selectedNode,
    setActiveModule,
    setFocusClusterIds,
    setFocusMode,
    setSelectedNode
  ]);

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data: graphData,
    viewState: {
      viewMode,
      focusMode,
      focusHopCount,
      focusClusterIds,
      drilldownContext,
      expandedClusterIds: expandedClusters,
      selectedNode,
      activeColorMode,
      activeGroupingMode,
      groupingData,
      gitMetadata,
      showMultiMembership,
      layeredLodEnabled,
      layerSpacing,
      showLodPlanes,
      dimDrilldownLabels,
      enableMotionOptimizations,
      enablePerformanceMode,
      zoomSpeed,
      panSpeed,
      rotateSpeed,
      zoomLevel,
      exportRequest,
      cameraPresetRequest,
      cameraJumpRequest,
      layoutCacheKey,
      lodLevel
    },
    handlers: {
      onNodeSelect: (node) => {
        setSelectedNode(node);
      },
      onNodeExpand: (node) => {
        const isExpandable = Boolean(node?.canExpand ?? (node?.kind && CLUSTER_KINDS.has(node.kind)));
        if (!allowLod || !isExpandable) return;
        const clusterId = node.cluster_id || node.id;
        const depth = getNodeDepth(node);
        const isExpanded = expandedClusters.has(clusterId);
        if (isClusterView && node.modulePath?.length) {
          if (isExpanded) {
            const parentPath = node.modulePath.slice(0, -1);
            setActiveModule(parentPath.length ? parentPath.join('/') : null);
          } else {
            setActiveModule(node.modulePath.join('/'));
          }
        }
        const isFocused = focusClusterIds?.has(clusterId);
        const isMultiSelect = ctrlKeyRef.current;
        if (isFocused && isExpanded && !isMultiSelect) {
          setFocusClusterIds(null);
        } else if (isMultiSelect) {
          // Multi-select: add to existing focus
          addFocusClusterId(clusterId);
        } else {
          // Single-select: replace focus
          setFocusClusterIds(new Set([clusterId]));
        }
        toggleCluster(clusterId, depth);
      },
      onNodeHover: setHoveredNode,
      onBackgroundClick: () => {
        setSelectedNode(null);
        setFocusClusterIds(null);
      },
      onZoomChange: setZoomLevel,
      onExportStatus: setExportStatus,
      onExportRequestHandled: () => setExportRequest(null),
      onEscape: handleEscape
    }
  }), [
    graphData,
    viewMode,
    focusMode,
    focusHopCount,
    focusClusterIds,
    drilldownContext,
    expandedClusters,
    expandedByDepth,
    selectedNode,
    activeColorMode,
    activeGroupingMode,
    groupingData,
    gitMetadata,
    showMultiMembership,
    layeredLodEnabled,
    layerSpacing,
    showLodPlanes,
    dimDrilldownLabels,
    allowLod,
    toggleCluster,
    enableMotionOptimizations,
    enablePerformanceMode,
    zoomSpeed,
    panSpeed,
    rotateSpeed,
    zoomLevel,
    exportRequest,
    cameraPresetRequest,
    cameraJumpRequest,
    layoutCacheKey,
    lodLevel,
    isClusterView,
    setSelectedNode,
    setHoveredNode,
    setActiveModule,
    setFocusClusterIds,
    addFocusClusterId,
    setFocusMode,
    setZoomLevel,
    setExportRequest,
    setExportStatus,
    handleEscape,
    popExpansion
  ]);

  return useWebglRenderer ? (
    <GraphCanvasWebGL {...rendererProps} />
  ) : (
    <GraphCanvas {...rendererProps} />
  );
};
