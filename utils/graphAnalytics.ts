
import { Node, Edge } from '../types';

export interface ClusterMetrics {
    nodeCount: number;
    internalEdges: number;
    externalEdges: number;
    cohesion: number; // Internal density (0-1)
    coupling: number; // Ratio of external edges vs total edges
    instability: number; // metrics often used in architecture (Ce / (Ca + Ce))
}

/**
 * Computes metrics for a subset of nodes (a module/cluster).
 * @param clusterNodes List of nodes in the cluster
 * @param allEdges List of all edges in the graph
 */
export const computeClusterMetrics = (clusterNodes: Node[], allEdges: Edge[]): ClusterMetrics => {
    const nodeIds = new Set(clusterNodes.map(n => n.id));
    const count = clusterNodes.length;

    let internal = 0;
    let afferent = 0; // Incoming from outside (Ca)
    let efferent = 0; // Outgoing to outside (Ce)

    allEdges.forEach(e => {
        const isSourceIn = nodeIds.has(e.from);
        const isTargetIn = nodeIds.has(e.to);

        if (isSourceIn && isTargetIn) {
            internal++;
        } else if (isSourceIn && !isTargetIn) {
            efferent++;
        } else if (!isSourceIn && isTargetIn) {
            afferent++;
        }
    });

    // Cohesion: Actual Internal Edges / Possible Internal Edges (N * (N-1))
    // For directed graph.
    const maxInternal = count * (count - 1);
    const cohesion = count > 1 ? internal / (maxInternal || 1) : 1;

    // Coupling: Total external edges / Total edges related to this cluster
    const totalRemote = afferent + efferent;
    const totalInvolved = internal + totalRemote;
    const coupling = totalInvolved > 0 ? totalRemote / totalInvolved : 0;

    // Instability (Martin's metric): Ce / (Ca + Ce)
    // 0 = Stable (Core), 1 = Unstable (Dependent)
    const instability = totalRemote > 0 ? efferent / (totalRemote || 1) : 0;

    return {
        nodeCount: count,
        internalEdges: internal,
        externalEdges: totalRemote,
        cohesion,
        coupling,
        instability
    };
};
