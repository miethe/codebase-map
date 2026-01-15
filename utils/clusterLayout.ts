
import * as d3 from 'd3';
import { Node, Edge } from '../types';

interface ClusterNode extends d3.SimulationNodeDatum {
    id: string;
    width: number;
    height: number;
    nodeCount: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
}

interface ClusterLink extends d3.SimulationLinkDatum<ClusterNode> {
    weight: number;
}

/**
 * Computes a force-directed layout for clusters (modules).
 * 
 * @param nodes - All visible nodes with 'module' property assigned
 * @param edges - All visible edges
 * @param width - Canvas width
 * @param height - Canvas height
 * @returns Map of ModuleName -> {x, y}
 */
export const computeClusterLayout = (
    nodes: Node[],
    edges: Edge[],
    width: number,
    height: number
): Record<string, { x: number, y: number }> => {
    // 1. Identify Clusters and their sizes
    const clusters = new Map<string, { count: number }>();
    nodes.forEach(n => {
        const mod = n.module || 'Other';
        const entry = clusters.get(mod) || { count: 0 };
        entry.count++;
        clusters.set(mod, entry);
    });

    const clusterNodes: ClusterNode[] = Array.from(clusters.entries()).map(([id, data]) => {
        // Estimate box size based on node count
        // Assuming roughly square packing: area ~= count * nodeArea
        // nodeArea ~= (25px * 2)^2 = 2500
        const side = Math.sqrt(data.count * 2500) + 50; // +50 padding
        return {
            id,
            nodeCount: data.count,
            width: side,
            height: side, // simplified to square for collision
            x: width / 2 + (Math.random() - 0.5) * 50, // jitter initial pos
            y: height / 2 + (Math.random() - 0.5) * 50
        };
    });

    // 2. Build Adjacency / Link Weights between Clusters
    const linkMap = new Map<string, number>(); // "ModA|ModB" -> count

    edges.forEach(e => {
        const srcId = typeof e.source === 'object' ? (e.source as Node).id : e.source as string;
        const tgtId = typeof e.target === 'object' ? (e.target as Node).id : e.target as string;

        const srcNode = nodes.find(n => n.id === srcId);
        const tgtNode = nodes.find(n => n.id === tgtId);

        if (srcNode && tgtNode) {
            const srcMod = srcNode.module || 'Other';
            const tgtMod = tgtNode.module || 'Other';

            if (srcMod !== tgtMod) {
                // Determine order to keep key unique
                const [m1, m2] = [srcMod, tgtMod].sort();
                const key = `${m1}|${m2}`;

                // Weighting Logic
                // Base weight = 1
                // Bonus for strong types (API calls, Service-Repo)
                let weight = 1;
                if (['calls_api', 'service_calls_repository', 'handled_by'].includes(e.type)) {
                    weight = 2;
                }

                linkMap.set(key, (linkMap.get(key) || 0) + weight);
            }
        }
    });

    const clusterLinks: ClusterLink[] = Array.from(linkMap.entries()).map(([key, weight]) => {
        const [source, target] = key.split('|');
        return { source, target, weight };
    });

    // 3. Run Headless Simulation
    const simulation = d3.forceSimulation(clusterNodes)
        .force("charge", d3.forceManyBody().strength(-500)) // Repel
        .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1))
        .force("collide", d3.forceCollide().radius((d: any) => d.width / 1.5).strength(0.8)) // Prevent overlap
        .force("link", d3.forceLink(clusterLinks)
            .id((d: any) => d.id)
            .distance((d: any) => {
                // Inverse relationship: High weight = Short distance
                // Max weight likely around 10-50 for tight couples.
                // Min dist 100, Max dist 600
                const w = d.weight;
                return Math.max(150, 600 - (w * 20));
            })
            .strength((d: any) => {
                // Stronger pull for higher weights
                return Math.min(0.5, d.weight * 0.05);
            })
        )
        .stop();

    // Run ticks manually
    const TICKS = 75;
    for (let i = 0; i < TICKS; ++i) simulation.tick();

    // 4. Extract Results
    const result: Record<string, { x: number, y: number }> = {};
    clusterNodes.forEach(n => {
        result[n.id] = {
            x: Math.max(n.width / 2, Math.min(width - n.width / 2, n.x!)),
            y: Math.max(n.height / 2, Math.min(height - n.height / 2, n.y!))
        };
    });

    return result;
};
