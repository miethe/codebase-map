
import { Node, GroupingData } from '../types';

const COMPUTED_LABEL_MIN_SHARE = 0.45;
const COMPUTED_ROOT_MIN_SHARE = 0.6;
const COMPUTED_MAX_DEPTH = 4;
const FILE_EXT_RE = /\.[a-z0-9]+$/i;

const getRepoRoot = (nodes: Node[]): string | null => {
    const counts = new Map<string, number>();
    nodes.forEach(node => {
        node.cluster_path?.forEach(segment => {
            if (!segment.startsWith('repo:')) return;
            const name = segment.slice('repo:'.length);
            if (!name) return;
            counts.set(name, (counts.get(name) || 0) + 1);
        });
    });

    let top: string | null = null;
    let topCount = 0;
    counts.forEach((count, name) => {
        if (count > topCount) {
            top = name;
            topCount = count;
        }
    });

    return top;
};

const cleanSegment = (segment: string): string => {
    return segment.replace('[', '').replace(']', '').trim().toLowerCase();
};

const getNodeDirectorySegments = (node: Node, repoRoot: string | null): string[] => {
    const normalizedRoot = repoRoot ? repoRoot.toLowerCase() : null;
    let raw = node.file || '';

    if (!raw && node.cluster_path?.length) {
        const folderLike = [...node.cluster_path].reverse()
            .find(segment => segment.startsWith('folder:') || segment.startsWith('module:') || segment.startsWith('package:'));
        if (folderLike) {
            raw = folderLike.split(':').slice(1).join(':');
        }
    }

    if (!raw) {
        raw = node.id;
    }

    if (raw.includes('::')) {
        raw = raw.split('::')[0];
    }

    if (raw.includes(':') && raw.includes('/')) {
        raw = raw.split(':').slice(1).join(':');
    }

    raw = raw.replace(/^\/+/, '');

    if (normalizedRoot && raw.startsWith(`${normalizedRoot}/`)) {
        raw = raw.slice(normalizedRoot.length + 1);
    }

    if (normalizedRoot && raw.includes(`${normalizedRoot}/`)) {
        raw = raw.split(`${normalizedRoot}/`).slice(1).join(`${normalizedRoot}/`);
    }

    let parts = raw.split('/').filter(Boolean).map(cleanSegment);

    if (!parts.length) return parts;

    if (normalizedRoot && parts[0] === normalizedRoot) {
        parts = parts.slice(1);
    }

    if (parts.length && FILE_EXT_RE.test(parts[parts.length - 1])) {
        parts = parts.slice(0, -1);
    }

    return parts;
};

const getCommonPrefix = (paths: string[][]): string[] => {
    if (!paths.length) return [];
    let prefix = paths[0];
    for (let i = 1; i < paths.length; i += 1) {
        const current = paths[i];
        let idx = 0;
        while (idx < prefix.length && idx < current.length && prefix[idx] === current[idx]) idx += 1;
        prefix = prefix.slice(0, idx);
        if (!prefix.length) break;
    }
    return prefix;
};

const getBucketCounts = (paths: string[][], depth: number) => {
    const counts = new Map<string, { segments: string[]; count: number }>();
    paths.forEach(segments => {
        if (!segments.length) return;
        const bucket = segments.slice(0, depth);
        const key = bucket.join('/');
        const entry = counts.get(key) || { segments: bucket, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
    });
    return [...counts.values()].sort((a, b) => b.count - a.count);
};

const formatComputedLabel = (segments: string[], size: number, fallback: string) => {
    if (!segments.length) return `${fallback} (${size})`;
    const label = segments.join(' ');
    return `${label} (${size})`;
};

const ensureUniqueLabel = (label: string, used: Map<string, number>) => {
    const existing = used.get(label);
    if (!existing) {
        used.set(label, 1);
        return label;
    }
    const next = existing + 1;
    used.set(label, next);
    return `${label} #${next}`;
};

const hasPrefix = (segments: string[], prefix: string[]) => {
    if (prefix.length > segments.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
        if (segments[i] !== prefix[i]) return false;
    }
    return true;
};

type ComputedGroupInfo = {
    label: string;
    baseSegments: string[];
    size: number;
};

const deriveComputedGroupInfo = (groupings: GroupingData | null, nodes: Node[]): Map<string, ComputedGroupInfo> => {
    const info = new Map<string, ComputedGroupInfo>();
    if (!groupings || !nodes.length) return info;

    const repoRoot = getRepoRoot(nodes);
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const usedLabels = new Map<string, number>();
    const computedGroups = groupings.groups.filter(group => group.group_set === 'computed');

    computedGroups.forEach(group => {
        const groupNodes = group.nodes.map(id => nodeById.get(id)).filter(Boolean) as Node[];
        const paths = groupNodes
            .map(node => getNodeDirectorySegments(node, repoRoot))
            .filter(path => path.length);

        const size = group.metadata?.size || group.nodes.length || groupNodes.length || 0;
        const common = getCommonPrefix(paths);
        const bucketCounts = getBucketCounts(paths, 2);
        const rootCounts = getBucketCounts(paths, 1);

        let baseSegments: string[] = [];

        if (common.length >= 2) {
            baseSegments = common.slice(0, 2);
        } else if (bucketCounts.length && bucketCounts[0].count / Math.max(1, paths.length) >= COMPUTED_LABEL_MIN_SHARE) {
            baseSegments = bucketCounts[0].segments;
        } else if (rootCounts.length && rootCounts[0].count / Math.max(1, paths.length) >= COMPUTED_ROOT_MIN_SHARE) {
            baseSegments = rootCounts[0].segments;
        } else if (common.length) {
            baseSegments = [common[0]];
        }

        const labelBase = baseSegments.length ? baseSegments : [];
        const fallback = common.length ? common.join(' ') : 'Mixed cluster';
        const label = ensureUniqueLabel(formatComputedLabel(labelBase, size, fallback), usedLabels);

        info.set(group.id, { label, baseSegments, size });
    });

    return info;
};

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

export const enhanceComputedGroupingData = (groupings: GroupingData | null, nodes: Node[]): GroupingData | null => {
    if (!groupings) return groupings;
    const info = deriveComputedGroupInfo(groupings, nodes);
    if (!info.size) return groupings;

    const groups = groupings.groups.map(group => {
        if (group.group_set !== 'computed') return group;
        const computed = info.get(group.id);
        if (!computed || computed.label === group.label) return group;
        return { ...group, label: computed.label };
    });

    return { ...groupings, groups };
};

export const buildComputedNodePathMap = (groupings: GroupingData | null, nodes: Node[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    if (!groupings || !nodes.length) return map;

    const info = deriveComputedGroupInfo(groupings, nodes);
    if (!info.size) return map;

    const repoRoot = getRepoRoot(nodes);
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const computedGroups = groupings.groups.filter(group => group.group_set === 'computed');

    computedGroups.forEach(group => {
        const computed = info.get(group.id);
        if (!computed) return;
        const label = computed.label;
        const baseSegments = computed.baseSegments;

        group.nodes.forEach(nodeId => {
            const node = nodeById.get(nodeId);
            if (!node) return;
            const segments = getNodeDirectorySegments(node, repoRoot);
            const relative = baseSegments.length && hasPrefix(segments, baseSegments)
                ? segments.slice(baseSegments.length)
                : segments;
            const trimmed = relative.slice(0, COMPUTED_MAX_DEPTH);
            const modulePath = ['Computed', label, ...trimmed];
            map.set(nodeId, modulePath.filter(Boolean));
        });
    });

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
