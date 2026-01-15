
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Output file path
const OUTPUT_FILE = path.join(process.cwd(), 'codebase-graph.git-metadata.json');

console.log('Extracting Git metadata...');

try {
    // 1. Get all files tracked by git
    const filesBuffer = execSync('git ls-files');
    const files = filesBuffer.toString().trim().split('\n');

    const metadata = {};

    console.log(`Analyzing ${files.length} files...`);

    // We'll use a bulk log approach to avoid N processes.
    // git log --name-only --format="COMMIT|%at|%an"
    // This gives us the full history. We can parse it to aggregate stats.

    // However, for very large repos, this log is huge.
    // Let's rely on 'git log' per file for now IF the file count is small (<1000).
    // If it's large, we might throttle or use the bulk method.
    // Given the 'skillmeat' app seems to be moderate size, let's try the bulk method but stream it or just buffer it if memory allows.
    // Actually, Node buffer max is ~1GB. 'git log' text is usually fine.

    // Command: git log --name-only --format="###%at|%an"
    // The separator ### helps identifying commits.
    const logBuffer = execSync('git log --name-only --format="###%at|%an"');
    const logOutput = logBuffer.toString();
    const lines = logOutput.split('\n');

    let currentCommitDate = 0;
    let currentCommitAuthor = '';

    const stats = {}; // filepath -> { changes: 0, lastModified: 0, authors: Set }

    // Initialize stats for known files
    files.forEach(f => {
        stats[f] = { changes: 0, lastModified: 0, authors: new Set() };
    });

    for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith('###')) {
            const parts = line.substring(3).split('|');
            currentCommitDate = parseInt(parts[0], 10) * 1000; // git gives seconds, js needs ms
            currentCommitAuthor = parts[1];
        } else {
            // It's a file path
            const filePath = line.trim();
            if (stats[filePath]) {
                const s = stats[filePath];
                s.changes++;
                s.authors.add(currentCommitAuthor);
                // Log is roughly reverse chronological (newest first), so the first time we see a file, it's the last modified date.
                if (s.lastModified === 0) {
                    s.lastModified = currentCommitDate;
                }
            }
        }
    }

    // Convert Sets to arrays or top author
    const finalMetadata = {};
    for (const [file, s] of Object.entries(stats)) {
        // Find top author or just store count
        const authorsArray = Array.from(s.authors);
        finalMetadata[file] = {
            last_modified: s.lastModified,
            change_count: s.changes,
            unique_authors: authorsArray.length,
            // Simple heuristic for "created by" or "owned by": most frequent author? 
            // We didn't track frequency per author, just set. 
            // Let's just keep unique_authors count for complexity score.
        };
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalMetadata, null, 2));
    console.log(`Success! Metadata written to ${OUTPUT_FILE}`);

} catch (e) {
    console.error('Error extracting git metadata:', e);
    process.exit(1);
}
