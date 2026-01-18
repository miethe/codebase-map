import React, { useContext, useMemo } from 'react';
import { GraphContext } from '../App';
import { GraphCanvas } from './GraphCanvas';
import { GraphCanvasWebGL } from './GraphCanvasWebGL';
import { GraphRendererProps } from '../types';
import { useGraphLOD } from '../utils/useGraphLOD';

export const GraphRenderer: React.FC = () => {
  const {
    data,
    selectedNode,
    setSelectedNode,
    setHoveredNode,
    focusMode,
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
    zoomSpeed,
    panSpeed,
    rotateSpeed,
    lodData,
    zoomLevel,
    setZoomLevel,
    exportRequest,
    setExportRequest,
    setExportStatus,
    cameraPresetRequest
  } = useContext(GraphContext);

  const rendererMode = (import.meta.env.VITE_GRAPH_RENDERER || 'svg').toLowerCase();
  const useWebglRenderer = rendererMode === 'webgl';

  const allowLod = Boolean(lodData) && graphView === 'unified' && !activeModule;
  const { graphData, toggleCluster, expandedClusters } = useGraphLOD({
    baseData: data,
    lodData,
    zoomLevel,
    allowLod,
    focusClusterId
  });

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data: graphData,
    viewState: {
      viewMode,
      focusMode,
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
      cameraPresetRequest
    },
    handlers: {
      onNodeSelect: (node) => {
        if (allowLod && node?.kind === 'cluster') {
          const clusterId = node.cluster_id || node.id;
          const isExpanded = expandedClusters.has(clusterId);
          const isFocused = focusClusterId === clusterId;
          if (isFocused && isExpanded) {
            setFocusClusterId(null);
          } else {
            setFocusClusterId(clusterId);
          }
          toggleCluster(clusterId);
          return;
        }
        setSelectedNode(node);
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
