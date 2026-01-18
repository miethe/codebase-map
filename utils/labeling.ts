import { Node } from '../types';

const LABEL_THRESHOLDS = [0.45, 0.9, 1.8];
const LABEL_HYSTERESIS = 0.08;

const getInitialLabelBucket = (zoomLevel: number) => {
  if (zoomLevel < LABEL_THRESHOLDS[0]) return 0;
  if (zoomLevel < LABEL_THRESHOLDS[1]) return 1;
  if (zoomLevel < LABEL_THRESHOLDS[2]) return 2;
  return 3;
};

export const getNextLabelBucket = (zoomLevel: number, current: number) => {
  if (current === 0) {
    return zoomLevel > LABEL_THRESHOLDS[0] + LABEL_HYSTERESIS ? 1 : 0;
  }
  if (current === 1) {
    if (zoomLevel < LABEL_THRESHOLDS[0] - LABEL_HYSTERESIS) return 0;
    return zoomLevel > LABEL_THRESHOLDS[1] + LABEL_HYSTERESIS ? 2 : 1;
  }
  if (current === 2) {
    if (zoomLevel < LABEL_THRESHOLDS[1] - LABEL_HYSTERESIS) return 1;
    return zoomLevel > LABEL_THRESHOLDS[2] + LABEL_HYSTERESIS ? 3 : 2;
  }
  return zoomLevel < LABEL_THRESHOLDS[2] - LABEL_HYSTERESIS ? 2 : 3;
};

export const getLabelBucketForZoom = (zoomLevel: number) => getInitialLabelBucket(zoomLevel);

export const getLabelBudgetForBucket = (bucket: number, nodeCount: number) => {
  const base = bucket <= 0 ? 70
    : bucket === 1 ? 130
      : bucket === 2 ? 240
        : 420;
  const scaled = Math.max(40, Math.floor(nodeCount * 0.18));
  const budget = Math.max(30, Math.min(base, scaled));
  return Math.min(nodeCount, budget);
};

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getImportanceScore = (importance?: number) => {
  if (importance === undefined || Number.isNaN(importance)) return 0;
  const normalized = importance <= 1 ? importance * 100 : importance;
  return Math.min(160, normalized * 1.2);
};

export const getLabelRank = (
  node: Node,
  selectedId?: string | null,
  focusNodeIds?: Set<string> | null,
  labelBucket = 2
) => {
  let score = node.totalDegree || node.degree || 0;
  score += getImportanceScore(node.importance);
  if (node.kind === 'cluster') score += 40;
  if (node.entrypoint) score += 60;
  if (node.size) score += Math.min(60, Math.log1p(node.size) * 6);
  if (node.hotness) score += Math.min(80, node.hotness);
  if (focusNodeIds?.has(node.id)) score += 120;
  if (selectedId && node.id === selectedId) score += 2000;
  if (labelBucket === 0 && node.kind === 'cluster') score += 120;
  return { score, tieBreaker: hashString(node.id) };
};

export const compareLabelRank = (
  a: { score: number; tieBreaker: number },
  b: { score: number; tieBreaker: number }
) => {
  if (b.score !== a.score) return b.score - a.score;
  return a.tieBreaker - b.tieBreaker;
};

export const shouldForceLabel = (
  node: Node,
  selectedId?: string | null,
  labelBucket = 2
) => {
  if (selectedId && node.id === selectedId) return true;
  if (labelBucket === 0 && node.kind === 'cluster') return true;
  return false;
};
