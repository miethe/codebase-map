export type LayoutCachePoint = {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};

type LayoutCachePayload = {
  v: number;
  savedAt: number;
  nodes: Array<[string, number, number, number, number, number, number]>;
};

const STORAGE_PREFIX = 'codebase-map.layout';
const LAYOUT_CACHE_VERSION = 1;
const MAX_CACHED_NODES = 12000;

const getStorage = () => {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
};

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const buildLayoutCacheKey = (parts: Array<string | number | boolean | null | undefined>) => {
  const seed = parts.filter(part => part !== null && part !== undefined).join('|');
  const hash = hashString(seed).toString(36);
  return `${STORAGE_PREFIX}:${LAYOUT_CACHE_VERSION}:${hash}`;
};

export const loadLayoutCache = (key: string): Map<string, LayoutCachePoint> | null => {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as LayoutCachePayload;
    if (!payload || payload.v !== LAYOUT_CACHE_VERSION || !Array.isArray(payload.nodes)) return null;
    const map = new Map<string, LayoutCachePoint>();
    payload.nodes.forEach(entry => {
      if (!entry || entry.length < 3) return;
      const [id, x, y, z, vx, vy, vz] = entry;
      if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
      map.set(id, { x, y, z, vx, vy, vz });
    });
    return map;
  } catch (err) {
    return null;
  }
};

export const saveLayoutCache = (key: string, positions: Map<string, LayoutCachePoint>) => {
  const storage = getStorage();
  if (!storage) return;
  if (!positions.size) return;
  try {
    const nodes: LayoutCachePayload['nodes'] = [];
    let count = 0;
    positions.forEach((pos, id) => {
      if (count >= MAX_CACHED_NODES) return;
      nodes.push([
        id,
        pos.x,
        pos.y,
        pos.z ?? 0,
        pos.vx ?? 0,
        pos.vy ?? 0,
        pos.vz ?? 0
      ]);
      count += 1;
    });
    const payload: LayoutCachePayload = {
      v: LAYOUT_CACHE_VERSION,
      savedAt: Date.now(),
      nodes
    };
    storage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    // Ignore cache failures (e.g. quota exceeded).
  }
};
