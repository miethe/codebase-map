
import { Node, GroupingData, NODE_COLORS } from '../types';

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
    groupingData: GroupingData | null
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

    // Fallback node color if not found in group
    return '#334155'; // slate-700 (dim, indicates no membership)
};
