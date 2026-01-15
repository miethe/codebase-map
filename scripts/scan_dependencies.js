
import fs from 'fs';
import path from 'path';

const PKG_FILE = path.join(process.cwd(), 'package.json');
const OUTPUT_FILE = path.join(process.cwd(), 'codebase-graph.dependencies.json');

console.log('Scanning dependencies...');

try {
    if (!fs.existsSync(PKG_FILE)) {
        console.error('No package.json found!');
        process.exit(0);
    }

    const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf-8'));
    const nodes = [];
    const edges = [];

    const processDeps = (deps, type) => {
        if (!deps) return;
        Object.entries(deps).forEach(([name, version]) => {
            const nodeId = `node_modules/${name}`;
            nodes.push({
                id: nodeId,
                type: 'external_dependency',
                label: name,
                file: 'package.json',
                details: {
                    version: version,
                    deptype: type
                },
                // Use a special prefix for grouping later
                modulePath: ['External', type === 'dependencies' ? 'Production' : 'Dev']
            });

            // Edge from package.json (root) to dependency?
            // Or just leave them floating for now, or link to a virtual "Root" node if it exists.
            // In the main graph, we often don't have a single root node.
            // We'll leave edges empty for now, or maybe link them to usage if valid import data existed (which we don't have easily).
        });
    };

    processDeps(pkg.dependencies, 'dependencies');
    processDeps(pkg.devDependencies, 'devDependencies');

    const graph = { nodes, edges };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(graph, null, 2));
    console.log(`Success! Extracted ${nodes.length} dependencies to ${OUTPUT_FILE}`);

} catch (e) {
    console.error('Error scanning dependencies:', e);
    process.exit(1);
}
