
import { Node, GroupingData, NODE_COLORS, GitMetadata } from '../types';

// Palette for categorical data (e.g. owners, domains)
// Distinct colors that are not too close to the dark background
const CATEGORICAL_PALETTE = [
    '#3b82f6', // blue-500
    '#10b981', // emerald-500
    '#f97316', // orange-500
    '#ef4444', // red-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
    '#eab308', // yellow-500
    '#06b6d4', // cyan-500
    '#84cc16', // lime-500
    '#d946ef', // fuchsia-500
    '#6366f1', // indigo-500
    '#14b8a6', // teal-500
    '#f43f5e', // rose-500
    '#a855f7', // purple-500
];

// Cache for stable color assignment to arbitrary strings
const stringToColorCache = new Map<string, string>();

/**
 * Assigns a stable color to a string from the palette.
 */
const getColorForString = (str: string): string => {
    if (!str) return '#64748b'; // slate-500 (default/unknown)
    if (stringToColorCache.has(str)) return stringToColorCache.get(str)!;

    // Simple hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % CATEGORICAL_PALETTE.length;
    const color = CATEGORICAL_PALETTE[index];
    stringToColorCache.set(str, color);
    return color;
};

/**
 * Determines the color of a node based on the active color mode.
 */
export const getNodeColor = (
    node: Node,
    mode: string,
    groupingData: GroupingData | null,
    gitMetadata: GitMetadata | null
): string => {
    // 1. Default Mode: Node Type
    if (mode === 'type') {
        return NODE_COLORS[node.type] || '#64748b';
    }

    // 2. Module Mode: Based on top-level directory/module
    if (mode === 'module') {
        const topModule = node.modulePath?.[0] || 'Other';
        return getColorForString(topModule);
    }

    // 3. Grouping Modes (Ownership, Domain, Layer, etc.)
    // We look up if this node belongs to any group in the specified grouping set.
    if (groupingData) {
        // Find a group in this set that contains the node
        const relevantGroup = groupingData.groups.find(g =>
            g.group_set === mode && g.nodes.includes(node.id)
        );

        if (relevantGroup) {
            return getColorForString(relevantGroup.label);
        }
    }

    // 4. Git Metadata Modes (Recency, Churn)
    if ((mode === 'recency' || mode === 'churn') && gitMetadata && node.file) {
        // Find relative path key in gitMetadata
        // The node.file is absolute or relative? The git-metadata uses relative paths.
        // Assuming node.file matches keys in gitMetadata (which are relative from root)
        // We might need to handle leading './' if present/absent
        // Let's try direct lookup first, then fallback

        let stats = gitMetadata[node.file];
        if (!stats && node.file.startsWith('/') && !gitMetadata[node.file]) {
            // Try stripping leading slash or matching basename if needed, 
            // but ideally the extrator script kept them consistent.
        }

        if (stats) {
            if (mode === 'recency') {
                // Time decay heat map
                // 1 day ago = Hot (Red/Orange), 1 year ago = Cold (Blue/Grey)
                const now = Date.now();
                const diffMs = now - stats.last_modified;
                const days = diffMs / (1000 * 60 * 60 * 24);

                if (days < 1) return '#ef4444'; // Red-500 (< 24h)
                if (days < 7) return '#f97316'; // Orange-500 (< 1 week)
                if (days < 30) return '#eab308'; // Yellow-500 (< 1 month)
                if (days < 90) return '#84cc16'; // Lime-500 (< 3 months)
                if (days < 180) return '#10b981'; // Emerald-500 (< 6 months)
                return '#3b82f6'; // Blue-500 (> 6 months)
            }

            if (mode === 'churn') {
                // Change count heat map
                const changes = stats.change_count;
                if (changes > 50) return '#ef4444'; // Very High Churn
                if (changes > 20) return '#f97316'; // High
                if (changes > 10) return '#eab308'; // Medium
                if (changes > 5) return '#84cc16'; // Low
                return '#3b82f6'; // Stable
            }
        }
    }

    // Fallback node color if not found in group
    return '#334155'; // slate-700 (dim, indicates no membership)
};
