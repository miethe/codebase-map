import React, { useContext, useMemo } from 'react';
import { GraphContext } from '../App';
import { GraphCanvas } from './GraphCanvas';
import { GraphCanvasWebGL } from './GraphCanvasWebGL';
import { GraphRendererProps } from '../types';

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
    enableMotionOptimizations,
    enablePerformanceMode,
    zoomSpeed,
    panSpeed,
    rotateSpeed
  } = useContext(GraphContext);

  const rendererMode = (import.meta.env.VITE_GRAPH_RENDERER || 'svg').toLowerCase();
  const useWebglRenderer = rendererMode === 'webgl';

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data,
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
      rotateSpeed
    },
    handlers: {
      onNodeSelect: setSelectedNode,
      onNodeHover: setHoveredNode,
      onBackgroundClick: () => setSelectedNode(null)
    }
  }), [
    data,
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
    setSelectedNode,
    setHoveredNode
  ]);

  return useWebglRenderer ? (
    <GraphCanvasWebGL {...rendererProps} />
  ) : (
    <GraphCanvas {...rendererProps} />
  );
};
