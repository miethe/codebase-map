import React, { useContext, useMemo } from 'react';
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
    setFocusClusterId,
    viewMode,
    activeColorMode,
    groupingData,
    gitMetadata,
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
  const { graphData, toggleCluster, expandedClusters, lodLevel } = useGraphLOD({
    baseData: data,
    lodData,
    zoomLevel,
    allowLod,
    lodMode,
    focusClusterId,
    backboneEdgeDensity
  });

  const layoutCacheKey = useMemo(() => {
    if (!layoutCacheSeed) return null;
    const sourceTag = graphData.source || 'base';
    return buildLayoutCacheKey([layoutCacheSeed, sourceTag, `lod:${lodLevel}`]);
  }, [layoutCacheSeed, graphData.source, lodLevel]);

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data: graphData,
    viewState: {
      viewMode,
      focusMode,
      focusHopCount,
      focusClusterId,
      selectedNode,
      activeColorMode,
      groupingData,
      gitMetadata,
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
        if (!allowLod || !node?.kind || !CLUSTER_KINDS.has(node.kind)) return;
        const clusterId = node.cluster_id || node.id;
        const isExpanded = expandedClusters.has(clusterId);
        const isFocused = focusClusterId === clusterId;
        if (isFocused && isExpanded) {
          setFocusClusterId(null);
        } else {
          setFocusClusterId(clusterId);
        }
        toggleCluster(clusterId);
      },
      onNodeHover: setHoveredNode,
      onBackgroundClick: () => {
        setSelectedNode(null);
        setFocusClusterId(null);
      },
      onZoomChange: setZoomLevel,
      onExportStatus: setExportStatus,
      onExportRequestHandled: () => setExportRequest(null)
    }
  }), [
    graphData,
    viewMode,
    focusMode,
    focusHopCount,
    focusClusterId,
    selectedNode,
    activeColorMode,
    groupingData,
    gitMetadata,
    allowLod,
    toggleCluster,
    expandedClusters,
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
    setZoomLevel,
    setExportRequest,
    setExportStatus
  ]);

  return useWebglRenderer ? (
    <GraphCanvasWebGL {...rendererProps} />
  ) : (
    <GraphCanvas {...rendererProps} />
  );
};
