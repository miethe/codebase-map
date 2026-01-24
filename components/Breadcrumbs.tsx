import React, { useContext, useMemo } from 'react';
import { ChevronRight, CornerUpLeft } from 'lucide-react';
import { GraphContext } from '../App';
import { Node } from '../types';

const getNodeLabel = (node: Node | undefined, fallback: string) => {
  if (!node) return fallback;
  return node.label_short || node.label || node.id;
};

export const Breadcrumbs: React.FC = () => {
  const {
    data,
    lodData,
    clusterLodData,
    selectedNode,
    focusClusterId,
    setFocusClusterId,
    graphView,
    activeModule
  } = useContext(GraphContext);

  const { nodeById, nodeByCluster } = useMemo(() => {
    const byId = new Map<string, Node>();
    const byCluster = new Map<string, Node>();
    const addNodes = (nodes?: Node[]) => {
      if (!nodes) return;
      nodes.forEach(node => {
        if (!byId.has(node.id)) byId.set(node.id, node);
        const clusterKey = node.cluster_id || node.id;
        if (!byCluster.has(clusterKey)) byCluster.set(clusterKey, node);
      });
    };
    addNodes(data.nodes);
    addNodes(lodData?.lod0?.nodes);
    addNodes(lodData?.lod1?.nodes);
    addNodes(lodData?.lod2?.nodes);
    addNodes(lodData?.lod3?.nodes);
    addNodes(clusterLodData?.lod0?.nodes);
    addNodes(clusterLodData?.lod1?.nodes);
    addNodes(clusterLodData?.lod2?.nodes);
    addNodes(clusterLodData?.lod3?.nodes);
    return { nodeById: byId, nodeByCluster: byCluster };
  }, [data.nodes, lodData, clusterLodData]);

  const focusNode = focusClusterId
    ? nodeByCluster.get(focusClusterId) || nodeById.get(focusClusterId)
    : null;

  const rootLabel = graphView === 'frontend' ? 'Frontend' : graphView === 'backend' ? 'Backend' : 'System';

  const crumbs = useMemo(() => {
    const items: Array<{ label: string; id?: string }> = [{ label: rootLabel }];
    let path: string[] | null = null;

    if (focusClusterId) {
      if (focusNode?.cluster_path?.length) {
        path = focusNode.cluster_path;
      } else {
        path = [focusClusterId];
      }
    } else if (selectedNode?.cluster_path?.length) {
      path = selectedNode.cluster_path;
    } else if (selectedNode?.modulePath?.length) {
      path = selectedNode.modulePath;
    } else if (activeModule) {
      path = activeModule.split('/');
    }

    if (path) {
      path.forEach(segment => {
        const label = getNodeLabel(nodeByCluster.get(segment), segment);
        const isCluster = nodeByCluster.has(segment);
        items.push({ label, id: isCluster ? segment : undefined });
      });
    }

    if (selectedNode) {
      const selectedLabel = getNodeLabel(selectedNode, selectedNode.id);
      if (items[items.length - 1]?.label !== selectedLabel) {
        items.push({ label: selectedLabel });
      }
    }

    return items.filter(item => item.label);
  }, [rootLabel, focusClusterId, focusNode, selectedNode, nodeByCluster, activeModule]);

  if (!crumbs.length || (crumbs.length === 1 && !focusClusterId && !selectedNode && !activeModule)) {
    return null;
  }

  const handleBack = () => {
    if (!focusClusterId) return;
    const path = focusNode?.cluster_path;
    if (!path || path.length <= 1) {
      setFocusClusterId(null);
      return;
    }
    const parentId = path[path.length - 2];
    setFocusClusterId(parentId);
  };

  return (
    <div className="mt-3 rounded border border-slate-800/60 bg-slate-900/60 px-2 py-1.5 text-[10px] text-slate-400">
      <div className="flex items-center gap-2 flex-wrap">
        {focusClusterId && (
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 rounded border border-slate-700/70 px-1.5 py-0.5 text-slate-300 hover:text-white hover:border-indigo-400/60 transition-colors"
          >
            <CornerUpLeft size={10} />
            Back
          </button>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          {crumbs.map((crumb, index) => (
            <div key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight size={10} className="text-slate-600" />}
              {crumb.id ? (
                <button
                  type="button"
                  onClick={() => setFocusClusterId(crumb.id!)}
                  className="hover:text-indigo-300 transition-colors"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="text-slate-300">{crumb.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
