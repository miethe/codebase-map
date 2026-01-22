import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const DEFAULTS = {
  base: 'codebase-graph.groupings.base.json',
  overrides: 'codebase-graph.groupings.overrides.json',
  out: 'codebase-graph.groupings.json'
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const config = { ...DEFAULTS };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const next = args[i + 1];
    if (!next) continue;
    if (flag === '--base') config.base = next;
    if (flag === '--overrides') config.overrides = next;
    if (flag === '--out') config.out = next;
  }
  return config;
};

const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');

const loadJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const fingerprintForGroup = group => {
  const nodes = Array.isArray(group.nodes) ? [...group.nodes].sort() : [];
  return `sha1:${sha1(nodes.join(','))}`;
};

const main = () => {
  const config = parseArgs();
  const basePath = path.resolve(ROOT, config.base);
  const overridesPath = path.resolve(ROOT, config.overrides);
  const outPath = path.resolve(ROOT, config.out);

  if (!fs.existsSync(basePath)) {
    console.error(`Missing base groupings at ${basePath}`);
    process.exit(1);
  }

  const base = loadJson(basePath);
  const overridesPayload = fs.existsSync(overridesPath) ? loadJson(overridesPath) : null;
  const overrides = Array.isArray(overridesPayload?.overrides) ? overridesPayload.overrides : [];

  const overridesByFingerprint = new Map();
  const overridesById = new Map();
  overrides.forEach(override => {
    if (override?.fingerprint) overridesByFingerprint.set(override.fingerprint, override);
    if (override?.id) overridesById.set(override.id, override);
  });

  const applied = new Set();
  const mergedGroups = (base.groups || []).map(group => {
    const fingerprint = fingerprintForGroup(group);
    const override = overridesByFingerprint.get(fingerprint) || overridesById.get(group.id);
    if (!override) return group;

    if (override.fingerprint) applied.add(override.fingerprint);
    if (override.id) applied.add(override.id);

    const metadata = { ...(group.metadata || {}) };
    if (Array.isArray(override.path) && override.path.length) {
      metadata.path = override.path;
    }
    if (typeof override.confidence === 'number') {
      metadata.confidence = override.confidence;
    }
    if (override.notes) {
      metadata.notes = override.notes;
    }

    return {
      ...group,
      label: override.label || group.label,
      metadata
    };
  });

  overrides.forEach(override => {
    const keys = [override?.fingerprint, override?.id].filter(Boolean);
    const matched = keys.some(key => applied.has(key));
    if (!matched) {
      console.warn(`Override not applied (no match): ${override.fingerprint || override.id || 'unknown'}`);
    }
  });

  const merged = {
    ...base,
    groups: mergedGroups
  };

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Merged groupings: ${outPath}`);
};

main();
