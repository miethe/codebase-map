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
  const { graphData, toggleCluster } = useGraphLOD({
    baseData: data,
    lodData,
    zoomLevel,
    allowLod
  });

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data: graphData,
    viewState: {
      viewMode,
      focusMode,
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
          toggleCluster(clusterId);
          return;
        }
        setSelectedNode(node);
      },
      onNodeHover: setHoveredNode,
      onBackgroundClick: () => setSelectedNode(null),
      onZoomChange: setZoomLevel,
      onExportStatus: setExportStatus,
      onExportRequestHandled: () => setExportRequest(null)
    }
  }), [
    graphData,
    viewMode,
    focusMode,
    selectedNode,
    activeColorMode,
    groupingData,
    gitMetadata,
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
    setSelectedNode,
    setHoveredNode,
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
