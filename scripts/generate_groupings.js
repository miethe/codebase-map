import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const DEFAULTS = {
  graph: 'codebase-graph.unified.json',
  details: 'codebase-graph.details.json',
  taxonomy: 'grouping.taxonomy.json',
  outBase: 'codebase-graph.groupings.base.json',
  outSummary: 'codebase-graph.groupings.summary.json'
};

const SUMMARY_LIMITS = {
  tokens: 8,
  paths: 6,
  samples: 6
};

const STOP_TOKENS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'from', 'with', 'without', 'of', 'in', 'to', 'by', 'as',
  'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are', 'be', 'via',
  'src', 'lib', 'app', 'apps', 'component', 'components', 'page', 'pages', 'hook', 'hooks',
  'util', 'utils', 'common', 'shared', 'test', 'tests', 'spec', 'specs', 'index', 'main', 'default',
  'file', 'files', 'dir', 'folder', 'module', 'modules', 'package', 'packages', 'type', 'types',
  'node', 'nodes', 'edge', 'edges', 'graph', 'data', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'md', 'css', 'scss', 'html'
]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const config = { ...DEFAULTS };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const next = args[i + 1];
    if (!next) continue;
    if (flag === '--graph') config.graph = next;
    if (flag === '--details') config.details = next;
    if (flag === '--taxonomy') config.taxonomy = next;
    if (flag === '--out-base') config.outBase = next;
    if (flag === '--out-summary') config.outSummary = next;
  }
  return config;
};

const toPosix = value => value.replace(/\\/g, '/');

const utcNow = () => {
  const stamp = new Date().toISOString();
  return stamp.replace(/\.\d{3}Z$/, 'Z');
};

const getSourceCommit = () => {
  try {
    const out = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || 'unknown';
  } catch (err) {
    return 'unknown';
  }
};

const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');

const loadJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const normalizePathSegments = value => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/\s*(?:>|\/)\s*/g)
    .map(item => item.trim())
    .filter(Boolean);
};

const normalizeTokens = value => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[^a-zA-Z0-9]+/g)
    .map(item => item.trim())
    .filter(Boolean);
};

const normalizeMatchPaths = value => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const loadTaxonomy = taxonomyPath => {
  if (!fs.existsSync(taxonomyPath)) return null;
  const raw = loadJson(taxonomyPath);
  const rules = [];
  const addRule = (entry, order) => {
    if (!entry) return;
    const pathSegments = normalizePathSegments(entry.path || entry.pathSegments || entry.domain || entry.group);
    if (!pathSegments.length) return;
    const tokens = normalizeTokens(entry.tokens || entry.token);
    const paths = normalizeMatchPaths(entry.paths || entry.pathMatch || entry.match);
    rules.push({
      order,
      path: pathSegments,
      tokens: tokens.map(token => token.toLowerCase()),
      paths: paths.map(item => item.toLowerCase()),
      confidence: typeof entry.confidence === 'number' ? entry.confidence : null
    });
  };

  if (Array.isArray(raw.rules)) {
    raw.rules.forEach((entry, idx) => addRule(entry, rules.length + idx));
  }

  if (Array.isArray(raw.domains)) {
    raw.domains.forEach((entry, idx) => addRule(entry, rules.length + idx));
  }

  if (raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens)) {
    Object.entries(raw.tokens).forEach(([token, target]) => {
      addRule({ tokens: [token], path: target }, rules.length);
    });
  }

  if (raw.paths && typeof raw.paths === 'object' && !Array.isArray(raw.paths)) {
    Object.entries(raw.paths).forEach(([matchPath, target]) => {
      addRule({ paths: [matchPath], path: target }, rules.length);
    });
  }

  if (!rules.length) return null;
  return {
    version: raw.version || 1,
    rules
  };
};

const splitCamel = value => value.replace(/([a-z])([A-Z])/g, '$1 $2');

const extractTokensFromText = text => {
  if (!text) return [];
  const normalized = splitCamel(String(text));
  return normalized
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/g)
    .map(token => token.trim())
    .filter(token => token && token.length >= 2 && !STOP_TOKENS.has(token) && !/^\d+$/.test(token));
};

const collectNodeTokens = (node, details) => {
  const sources = [];
  if (node.id) sources.push(node.id);
  if (node.label) sources.push(node.label);
  if (node.label_short) sources.push(node.label_short);
  if (node.file) sources.push(node.file);
  if (node.module) sources.push(node.module);
  if (node.package) sources.push(node.package);
  if (node.type) sources.push(node.type);
  if (node.cluster_path) sources.push(node.cluster_path.join(' '));
  if (details?.doc_summary) sources.push(details.doc_summary);
  if (details?.docstring) sources.push(details.docstring);
  if (details?.signature) sources.push(details.signature);
  const tokens = [];
  sources.forEach(source => {
    tokens.push(...extractTokensFromText(source));
  });
  return tokens;
};

const collectNodeTokensRaw = node => {
  const sources = [];
  if (node.id) sources.push(node.id);
  if (node.label) sources.push(node.label);
  if (node.label_short) sources.push(node.label_short);
  if (node.file) sources.push(node.file);
  if (node.module) sources.push(node.module);
  if (node.package) sources.push(node.package);
  if (node.type) sources.push(node.type);
  if (node.cluster_path) sources.push(node.cluster_path.join(' '));
  const tokens = [];
  sources.forEach(source => {
    tokens.push(...splitCamel(String(source))
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase()
      .split(/\s+/g)
      .map(token => token.trim())
      .filter(token => token && token.length >= 2 && !/^\d+$/.test(token))
    );
  });
  return tokens;
};

const getPathHint = node => {
  let raw = node.file || '';
  if (!raw && node.id) {
    const candidate = node.id.split(':').slice(1).join(':');
    if (candidate.includes('/')) {
      raw = candidate.split('::')[0];
    }
  }
  if (!raw) return null;
  let cleaned = toPosix(raw).replace(/^\.?\//, '');
  const idx = cleaned.indexOf('skillmeat/');
  if (idx >= 0) {
    cleaned = cleaned.slice(idx);
  }
  if (cleaned.includes('::')) {
    cleaned = cleaned.split('::')[0];
  }
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (/\.[a-z0-9]+$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (!parts.length) return null;
  if (parts[0] === 'node_modules') return null;
  const prefix = parts.slice(0, Math.min(parts.length, 3));
  return prefix.join('/');
};

const commonPrefix = paths => {
  if (!paths.length) return null;
  const parts = paths.map(item => item.split('/'));
  const prefix = [];
  for (let i = 0; ; i += 1) {
    const segment = parts[0][i];
    if (!segment) break;
    if (!parts.every(entry => entry[i] === segment)) break;
    prefix.push(segment);
  }
  if (!prefix.length) return null;
  return prefix.join('/');
};

const labelForComponent = nodes => {
  const packages = nodes.map(node => node.package).filter(Boolean);
  if (packages.length && new Set(packages).size === 1) {
    return `package:${packages[0]}`;
  }
  const directories = nodes
    .map(node => node.file)
    .filter(Boolean)
    .map(filePath => {
      const normalized = toPosix(filePath);
      const idx = normalized.lastIndexOf('/');
      if (idx === -1) return '.';
      return normalized.slice(0, idx) || '.';
    });
  const prefix = commonPrefix(directories);
  if (prefix) {
    return `dir:${prefix}`;
  }
  const types = nodes.map(node => node.type).filter(Boolean);
  if (types.length) {
    const counts = new Map();
    types.forEach(type => counts.set(type, (counts.get(type) || 0) + 1));
    let topType = null;
    let topCount = 0;
    counts.forEach((count, type) => {
      if (count > topCount) {
        topType = type;
        topCount = count;
      }
    });
    if (topType) return `type:${topType}`;
  }
  return 'cluster';
};

const pickTaxonomyRule = (node, rules) => {
  if (!rules || !rules.length) return null;
  const tokens = new Set(collectNodeTokensRaw(node));
  const text = [node.file, node.id, node.module, node.label].filter(Boolean).join(' ').toLowerCase();
  let best = null;
  rules.forEach(rule => {
    let matchedByPath = false;
    let longestPath = 0;
    if (rule.paths.length) {
      rule.paths.forEach(pathMatch => {
        if (pathMatch && text.includes(pathMatch)) {
          matchedByPath = true;
          longestPath = Math.max(longestPath, pathMatch.split('/').length);
        }
      });
    }
    let matchedByTokens = false;
    if (rule.tokens.length) {
      matchedByTokens = rule.tokens.every(token => tokens.has(token));
    }
    if (!matchedByPath && !matchedByTokens) return;
    let score = 0;
    if (matchedByPath) score += 100 + longestPath;
    if (matchedByTokens) score += rule.tokens.length * 2;
    score += rule.path.length;
    const candidate = { ...rule, score };
    if (!best || candidate.score > best.score) {
      best = candidate;
    } else if (best && candidate.score === best.score && candidate.order < best.order) {
      best = candidate;
    }
  });
  return best;
};

const buildAdjacency = (nodes, edges) => {
  const adjacency = new Map();
  nodes.forEach(node => {
    if (node.id) adjacency.set(node.id, new Set());
  });
  edges.forEach(edge => {
    const fromId = edge.from;
    const toId = edge.to;
    if (!fromId || !toId) return;
    const fromSet = adjacency.get(fromId);
    const toSet = adjacency.get(toId);
    if (!fromSet || !toSet) return;
    fromSet.add(toId);
    toSet.add(fromId);
  });
  const finalized = new Map();
  adjacency.forEach((neighbors, nodeId) => {
    const sorted = [...neighbors].sort();
    finalized.set(nodeId, sorted);
  });
  return finalized;
};

const ensureUniqueLabel = (label, used) => {
  const count = used.get(label);
  if (!count) {
    used.set(label, 1);
    return label;
  }
  const next = count + 1;
  used.set(label, next);
  return `${label} #${next}`;
};

const buildComponents = (nodeIds, adjacency, bucketSet) => {
  const visited = new Set();
  const components = [];
  nodeIds.forEach(nodeId => {
    if (visited.has(nodeId)) return;
    const stack = [nodeId];
    visited.add(nodeId);
    const component = [];
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      const neighbors = adjacency.get(current) || [];
      neighbors.forEach(neighbor => {
        if (!bucketSet.has(neighbor) || visited.has(neighbor)) return;
        visited.add(neighbor);
        stack.push(neighbor);
      });
    }
    components.push(component.sort());
  });
  return components;
};

const main = () => {
  const config = parseArgs();
  const graphPath = path.resolve(ROOT, config.graph);
  const detailsPath = path.resolve(ROOT, config.details);
  const taxonomyPath = path.resolve(ROOT, config.taxonomy);
  const outBasePath = path.resolve(ROOT, config.outBase);
  const outSummaryPath = path.resolve(ROOT, config.outSummary);

  if (!fs.existsSync(graphPath)) {
    console.error(`Missing unified graph at ${graphPath}`);
    process.exit(1);
  }

  const graph = loadJson(graphPath);
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const details = fs.existsSync(detailsPath) ? loadJson(detailsPath) : null;
  const taxonomy = loadTaxonomy(taxonomyPath);

  const nodeMap = new Map(nodes.filter(node => node.id).map(node => [node.id, node]));
  const detailsNodes = details?.nodes || {};

  const adjacency = buildAdjacency(nodes, edges);

  const buckets = new Map();
  const bucketMeta = new Map();

  nodes.forEach(node => {
    if (!node.id) return;
    const rule = taxonomy?.rules ? pickTaxonomyRule(node, taxonomy.rules) : null;
    const pathSegments = rule?.path || null;
    const bucketKey = pathSegments ? pathSegments.join('>') : 'unassigned';
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, new Set());
    }
    buckets.get(bucketKey).add(node.id);
    if (pathSegments) {
      const existing = bucketMeta.get(bucketKey);
      if (!existing) {
        bucketMeta.set(bucketKey, {
          path: pathSegments,
          confidence: typeof rule?.confidence === 'number' ? rule.confidence : null
        });
      }
    }
  });

  const groups = [];
  buckets.forEach((bucketSet, bucketKey) => {
    const nodeIds = [...bucketSet].filter(Boolean).sort();
    if (!nodeIds.length) return;
    const components = buildComponents(nodeIds, adjacency, bucketSet);
    components.forEach(component => {
      if (component.length <= 1) return;
      const hash = sha1(component.join(','));
      const groupId = `component:${hash.slice(0, 10)}`;
      const componentNodes = component.map(id => nodeMap.get(id)).filter(Boolean);
      const bucketInfo = bucketMeta.get(bucketKey);
      const labelBase = bucketInfo?.path?.length ? bucketInfo.path.join(' / ') : labelForComponent(componentNodes);
      const metadata = {
        size: component.length
      };
      if (bucketInfo?.path?.length) metadata.path = bucketInfo.path;
      if (typeof bucketInfo?.confidence === 'number') metadata.confidence = bucketInfo.confidence;
      groups.push({
        group_set: 'computed',
        id: groupId,
        label_base: labelBase,
        nodes: component,
        metadata
      });
    });
  });

  groups.sort((a, b) => {
    if (a.group_set !== b.group_set) return a.group_set.localeCompare(b.group_set);
    return a.id.localeCompare(b.id);
  });

  const usedLabels = new Map();
  const finalizedGroups = groups.map(group => {
    const uniqueLabel = ensureUniqueLabel(group.label_base || 'cluster', usedLabels);
    return {
      group_set: group.group_set,
      id: group.id,
      label: `${uniqueLabel} (${group.metadata.size})`,
      nodes: group.nodes,
      metadata: group.metadata
    };
  });

  const basePayload = {
    generated_at: utcNow(),
    source_commit: getSourceCommit(),
    group_sets: [
      {
        id: 'computed',
        label: 'Computed Clusters',
        source: 'analysis',
        multi_membership: false,
        metadata: {
          algorithm: taxonomy ? 'taxonomy_components' : 'connected_components',
          singletons_excluded: true,
          taxonomy_rules: taxonomy ? taxonomy.rules.length : 0
        }
      }
    ],
    groups: finalizedGroups
  };

  const summaryGroups = finalizedGroups.map(group => {
    const tokenCounts = new Map();
    const pathCounts = new Map();
    group.nodes.forEach(nodeId => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      const nodeDetails = detailsNodes[nodeId];
      const tokens = collectNodeTokens(node, nodeDetails);
      tokens.forEach(token => tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1));
      const pathHint = getPathHint(node);
      if (pathHint) pathCounts.set(pathHint, (pathCounts.get(pathHint) || 0) + 1);
    });
    const topTokens = [...tokenCounts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, SUMMARY_LIMITS.tokens)
      .map(entry => entry[0]);
    const topPaths = [...pathCounts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, SUMMARY_LIMITS.paths)
      .map(entry => entry[0]);
    const fingerprint = `sha1:${sha1(group.nodes.join(','))}`;
    return {
      id: group.id,
      fingerprint,
      size: group.metadata.size || group.nodes.length,
      top_tokens: topTokens,
      top_paths: topPaths,
      sample_nodes: group.nodes.slice(0, SUMMARY_LIMITS.samples)
    };
  });

  const summaryPayload = {
    version: 1,
    generated_at: basePayload.generated_at,
    source_commit: basePayload.source_commit,
    groups: summaryGroups
  };

  fs.writeFileSync(outBasePath, JSON.stringify(basePayload, null, 2));
  fs.writeFileSync(outSummaryPath, JSON.stringify(summaryPayload, null, 2));

  console.log(`Generated ${finalizedGroups.length} groups.`);
  console.log(`Base groupings: ${outBasePath}`);
  console.log(`Summary: ${outSummaryPath}`);
};

main();
