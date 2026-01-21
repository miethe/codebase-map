import React, { useContext, useMemo, useCallback } from 'react';
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
    focusClusterId,
    drilldownContext,
    expandDepthMode,
    setFocusMode,
    setFocusClusterId,
    viewMode,
    activeColorMode,
    groupingData,
    activeGroupingMode,
    gitMetadata,
    showMultiMembership,
    layeredLodEnabled,
    layerSpacing,
    showLodPlanes,
    graphView,
    activeModule,
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

  const rendererMode = (import.meta.env.VITE_GRAPH_RENDERER || 'svg').toLowerCase();
  const useWebglRenderer = rendererMode === 'webgl';

  const allowLod = Boolean(lodData) && graphView === 'unified' && !activeModule;
  const { graphData, toggleCluster, expandedClusters, expandedByDepth, popExpansion, lodLevel } = useGraphLOD({
    baseData: data,
    lodData,
    zoomLevel,
    allowLod,
    lodMode,
    focusClusterId,
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
      setFocusClusterId(nextFocusId || null);
      popExpansion();
      return;
    }
    if (selectedNode) {
      setSelectedNode(null);
    }
  }, [expandedByDepth, expandedClusters.size, focusMode, popExpansion, selectedNode, setFocusClusterId, setFocusMode, setSelectedNode]);

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data: graphData,
    viewState: {
      viewMode,
      focusMode,
      focusHopCount,
      focusClusterId,
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
        const isFocused = focusClusterId === clusterId;
        if (isFocused && isExpanded) {
          setFocusClusterId(null);
        } else {
          setFocusClusterId(clusterId);
        }
        toggleCluster(clusterId, depth);
      },
      onNodeHover: setHoveredNode,
      onBackgroundClick: () => {
        setSelectedNode(null);
        setFocusClusterId(null);
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
    focusClusterId,
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
    setSelectedNode,
    setHoveredNode,
    setFocusClusterId,
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
