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
    gitMetadata
  } = useContext(GraphContext);

  const useWebglRenderer = import.meta.env.VITE_GRAPH_RENDERER === 'webgl';

  const rendererProps = useMemo<GraphRendererProps>(() => ({
    data,
    viewState: {
      viewMode,
      focusMode,
      selectedNode,
      activeColorMode,
      groupingData,
      gitMetadata
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
    setSelectedNode,
    setHoveredNode
  ]);

  return useWebglRenderer ? (
    <GraphCanvasWebGL {...rendererProps} />
  ) : (
    <GraphCanvas {...rendererProps} />
  );
};
