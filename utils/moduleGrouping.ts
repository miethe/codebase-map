
import { Node } from '../types';

/**
 * Helper to process directory paths into capitalized segments.
 * Removes the filename to group by parent directory.
 */
const getDirectorySegments = (fullPath: string, prefix: string): string[] => {
    const relative = fullPath.split(prefix)[1];
    if (!relative) return [];

    const parts = relative.split('/');
    // Remove the last part (filename) to get the directory path
    // We assume the node represents something *inside* that file, so the file is the leaf, and folder is the group.
    parts.pop();

    return parts
        .filter(p => p !== '')
        .map(p => {
            // Clean dynamic routes like [id]
            const clean = p.replace('[', '').replace(']', '');
            return clean.charAt(0).toUpperCase() + clean.slice(1);
        });
};

/**
 * Derives a hierarchical module path from a node's ID or type.
 * Returns an array of recursive modules, e.g. ['Frontend', 'Features', 'Marketplace']
 */
export const deriveModulePath = (node: Node): string[] => {
    const text = node.id;

    // --- FRONTEND ---
    if (text.includes('skillmeat/web/app/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/web/app/');
        return ['Frontend', 'App', ...dirSegments];
    }

    if (text.includes('skillmeat/web/components/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/web/components/');
        return ['Frontend', 'Components', ...dirSegments];
    }

    if (text.includes('skillmeat/web/hooks/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/web/hooks/');
        return ['Frontend', 'Hooks', ...dirSegments];
    }

    if (text.includes('skillmeat/web/lib/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/web/lib/');
        return ['Frontend', 'Lib', ...dirSegments];
    }

    if (node.type === 'route' || node.type === 'page') return ['Frontend', 'Routing'];

    // --- BACKEND ---
    if (text.includes('skillmeat/api/routers/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/api/routers/');
        return ['Backend', 'API Routes', ...dirSegments];
    }

    if (text.includes('skillmeat/core/')) {
        const dirSegments = getDirectorySegments(text, 'skillmeat/core/');
        return ['Backend', 'Core', ...dirSegments];
    }

    if (text.includes('skillmeat/cache/')) return ['Backend', 'Data Models'];
    if (text.includes('skillmeat/db/')) return ['Backend', 'Database'];

    if (['api_endpoint', 'endpoint', 'handler', 'service', 'repository', 'model', 'schema', 'migration'].includes(node.type)) {
        return ['Backend', 'General'];
    }

    // --- SHARED / DEFAULT ---
    if (node.type === 'type') return ['Shared', 'Types'];

    return ['Shared', 'Utils'];
};

/**
 * Determines the label to display for grouping based on the current active drill-down state.
 * 
 * @param nodePath The full hierarchical path of the node (e.g. ['Frontend', 'Features', 'Marketplace'])
 * @param activeModuleId The currently active module content (e.g. 'Frontend' or 'Frontend/Features')
 */
export const getDisplayModule = (nodePath: string[], activeModuleId: string | null): string => {
    // If no module is active, show the top-level group (Index 0)
    if (!activeModuleId) {
        return nodePath[0] || 'Other';
    }

    // Convert active module ID (e.g. 'Frontend/Features') back to parts for comparison
    const activeParts = activeModuleId.split('/');

    // Check if this node belongs to the active module tree
    // It matches if the node's path starts with the active parts
    const isMatch = activeParts.every((part, i) => nodePath[i] === part);

    if (!isMatch) {
        // If it doesn't match the current view, it shouldn't really be visible
        // But if it is forced visible (e.g. by neighbors), we group it as 'Other' or its Top Level
        return 'External';
    }

    // If we are deep enough, return the next level down
    // active: ['Frontend'], node: ['Frontend', 'Features', 'Marketplace'] -> return 'Features'
    const nextLevelIndex = activeParts.length;

    if (nodePath.length > nextLevelIndex) {
        return nodePath[nextLevelIndex];
    }

    // If we are at the bottom of the node's hierarchy (e.g. active is 'Frontend/Features', node IS 'Frontend/Features')
    // Then we might want to return 'Root' or the leaf name itself to keep it in the main cluster
    return nodePath[nodePath.length - 1]; // Just keep it in its own group
};
