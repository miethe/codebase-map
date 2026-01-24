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
    clusterLodData,
    gitMetadata,
    showMultiMembership,
    layeredLodEnabled,
    layerSpacing,
    showLodPlanes,
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
    setFocusClusterId,
    setFocusMode,
    setSelectedNode
  ]);

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
        if (isClusterView && node.modulePath?.length) {
          if (isExpanded) {
            const parentPath = node.modulePath.slice(0, -1);
            setActiveModule(parentPath.length ? parentPath.join('/') : null);
          } else {
            setActiveModule(node.modulePath.join('/'));
          }
        }
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
    isClusterView,
    setSelectedNode,
    setHoveredNode,
    setActiveModule,
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
