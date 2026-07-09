import { getDb } from '../db/sqlite.js';
import { getOrComputeDiff } from '../diff/engine.js';
export function showDiff(promptId, options) {
    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE stable_name = ? OR id = ?').get(promptId, promptId);
    if (!prompt) {
        console.error(`❌  Prompt not found: ${promptId}`);
        return;
    }
    let fromVersion, toVersion;
    if (options.latest) {
        const versions = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 2').all(prompt.id);
        if (versions.length < 2) {
            console.log('⚠️  Only one version exists — nothing to diff.');
            return;
        }
        toVersion = versions[0];
        fromVersion = versions[1];
    }
    else if (options.from && options.to) {
        const parseNum = (v) => parseInt(v.replace(/^v/, ''), 10);
        fromVersion = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?').get(prompt.id, parseNum(options.from));
        toVersion = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?').get(prompt.id, parseNum(options.to));
        if (!fromVersion || !toVersion) {
            console.error('❌  Could not find the requested versions.');
            return;
        }
    }
    else {
        console.log('Usage: plog diff <promptId> --latest');
        console.log('       plog diff <promptId> --from v1 --to v3');
        return;
    }
    const result = getOrComputeDiff(db, prompt.id, fromVersion.id, toVersion.id, fromVersion.raw_content, toVersion.raw_content);
    console.log(`\nDiff: ${prompt.display_name}  v${fromVersion.version_number} → v${toVersion.version_number}`);
    console.log(`Stats: +${result.stats.linesAdded} lines  -${result.stats.linesRemoved} lines  ` +
        `+${result.stats.wordsAdded} words  -${result.stats.wordsRemoved} words\n`);
    for (const part of result.wordDiff) {
        const text = part.added
            ? `\x1b[32m${part.value}\x1b[0m`
            : part.removed
                ? `\x1b[31m\x1b[9m${part.value}\x1b[0m`
                : part.value;
        process.stdout.write(text);
    }
    console.log('\n');
}
