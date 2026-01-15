
import { Node, GroupingData } from '../types';

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
 * Legacy derivation logic (fallback)
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
 * Builds a map of NodeID -> Hierarchical Path based on the selected grouping mode.
 */
export const buildNodePathMap = (groupings: GroupingData | null, mode: string): Map<string, string[]> => {
    const map = new Map<string, string[]>();

    if (!groupings) return map;

    // Filter relevant groups
    const relevantGroups = groupings.groups.filter(g => g.group_set === mode);

    for (const group of relevantGroups) {
        let path: string[] = [];

        if (mode === 'structure') {
            const pkg = group.metadata.package || 'Root';
            const roughPkg = pkg.split('.').pop() || pkg; // "api", "web"
            const category = roughPkg === 'web' ? 'Frontend' : (roughPkg === 'api' ? 'Backend' : 'Shared');

            if (group.metadata.directory) {
                // Remove prefix if redundant
                const parts = group.metadata.directory.split('/').filter((p: string) => p !== 'skillmeat' && p !== 'web' && p !== 'api');
                const cleanParts = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1));
                path = [category, ...cleanParts];
            } else {
                path = [category];
            }
        } else if (mode === 'computed') {
            path = ['Computed', group.label];
        } else {
            // Domain, Layer, etc.
            path = [mode.charAt(0).toUpperCase() + mode.slice(1), group.label];
        }

        for (const nodeId of group.nodes) {
            map.set(nodeId, path);
        }
    }

    return map;
};

/**
 * Determines the label to display for grouping based on the current active drill-down state.
 */
export const getDisplayModule = (nodePath: string[], activeModuleId: string | null): string => {
    if (!activeModuleId) {
        return nodePath[0] || 'Other';
    }

    const activeParts = activeModuleId.split('/');
    const isMatch = activeParts.every((part, i) => nodePath[i] === part);

    if (!isMatch) {
        return 'External';
    }

    const nextLevelIndex = activeParts.length;

    if (nodePath.length > nextLevelIndex) {
        return nodePath[nextLevelIndex];
    }

    return nodePath[nodePath.length - 1];
};
