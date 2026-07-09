import fs from 'fs';
import path from 'path';
import { getDb } from '../db/sqlite.js';
export function exportData(projectRoot, config, options) {
    const db = getDb();
    const format = options.format || 'all';
    if (format === 'json' || format === 'all') {
        if (config.exports.json.enabled) {
            exportJson(projectRoot, config, db);
        }
    }
    if (format === 'md' || format === 'all') {
        if (config.exports.markdown.enabled) {
            exportMarkdown(projectRoot, config, db);
        }
    }
    console.log('Export complete.');
}
function exportJson(projectRoot, config, db) {
    const exportDir = path.join(projectRoot, config.exports.json.path);
    if (!fs.existsSync(exportDir))
        fs.mkdirSync(exportDir, { recursive: true });
    const project = db.prepare('SELECT * FROM projects LIMIT 1').get();
    const prompts = db.prepare('SELECT * FROM prompts').all();
    for (const prompt of prompts) {
        const versions = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number ASC').all(prompt.id);
        const locations = db.prepare('SELECT * FROM prompt_locations WHERE prompt_id = ?').all(prompt.id);
        const notes = db.prepare('SELECT * FROM prompt_notes WHERE prompt_id = ?').all(prompt.id);
        prompt.versions = versions;
        prompt.locations = locations;
        prompt.notes = notes;
    }
    const exportData = {
        project,
        prompts
    };
    fs.writeFileSync(path.join(exportDir, 'prompts.json'), JSON.stringify(exportData, null, 2));
    console.log(`Exported JSON to ${exportDir}/prompts.json`);
}
function exportMarkdown(projectRoot, config, db) {
    const exportDir = path.join(projectRoot, config.exports.markdown.path, 'prompts');
    if (!fs.existsSync(exportDir))
        fs.mkdirSync(exportDir, { recursive: true });
    const prompts = db.prepare('SELECT * FROM prompts').all();
    for (const prompt of prompts) {
        const versions = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC').all(prompt.id);
        const notes = db.prepare('SELECT * FROM prompt_notes WHERE prompt_id = ?').all(prompt.id);
        let md = `# ${prompt.stable_name}\n\n`;
        md += `## Metadata\n\n`;
        md += `- Prompt ID: ${prompt.stable_name}\n`;
        md += `- Current status: ${prompt.status}\n`;
        md += `- First seen: ${prompt.first_seen_at}\n`;
        md += `- Last seen: ${prompt.last_seen_at}\n\n`;
        md += `## Version Timeline\n\n`;
        for (const v of versions) {
            md += `### v${v.version_number} - ${v.created_at}\n\n`;
            md += `**Source file:** ${v.source_file}\n\n`;
            const vNotes = notes.filter((n) => n.version_id === v.id);
            if (vNotes.length > 0) {
                md += `**Notes:**\n\n`;
                const typeLabels = {
                    general_note: 'Note',
                    reason: 'Change Reason',
                    issue: 'Issue',
                    benefit: 'Benefit',
                    test_result: 'Test Result',
                    risk: 'Risk',
                };
                for (const n of vNotes) {
                    const label = typeLabels[n.note_type] || 'Note';
                    const severity = n.severity && n.severity !== 'none' ? ` [${n.severity.toUpperCase()}]` : '';
                    md += `- **${label}${severity}:** ${n.title}\n  ${n.body}\n\n`;
                }
            }
            md += `**Prompt content:**\n\n\`\`\`text\n${v.raw_content}\n\`\`\`\n\n---\n\n`;
        }
        const safeFileName = prompt.stable_name.replace(/::/g, '--').replace(/[<>:"/\\|?*\[\]]/g, '_');
        fs.writeFileSync(path.join(exportDir, `${safeFileName}.md`), md);
    }
    console.log(`Exported Markdown to ${exportDir}`);
}
