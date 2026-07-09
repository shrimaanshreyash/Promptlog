import { getDb } from '../db/sqlite.js';
import { v4 as uuidv4 } from 'uuid';
export function addNote(promptId, options) {
    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE stable_name = ? OR id = ?').get(promptId, promptId);
    if (!prompt) {
        console.error(`Prompt not found: ${promptId}`);
        return;
    }
    let version_id = prompt.current_version_id;
    if (options.version) {
        const versionNum = options.version.replace('v', '');
        const version = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?').get(prompt.id, versionNum);
        if (!version) {
            console.error(`Version ${options.version} not found for this prompt.`);
            return;
        }
        version_id = version.id;
    }
    db.prepare(`
    INSERT INTO prompt_notes (id, prompt_id, version_id, note_type, title, body, severity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), prompt.id, version_id, options.type || 'general_note', options.title || 'CLI Note', options.body || '', options.severity || 'low');
    console.log('Note added successfully.');
}
export function listNotes(promptId, options) {
    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE stable_name = ? OR id = ?').get(promptId, promptId);
    if (!prompt) {
        console.error(`Prompt not found: ${promptId}`);
        return;
    }
    let query = 'SELECT pn.*, pv.version_number FROM prompt_notes pn LEFT JOIN prompt_versions pv ON pn.version_id = pv.id WHERE pn.prompt_id = ?';
    const params = [prompt.id];
    if (options.version) {
        const versionNum = options.version.replace('v', '');
        query += ' AND pv.version_number = ?';
        params.push(parseInt(versionNum, 10));
    }
    if (options.type) {
        query += ' AND pn.note_type = ?';
        params.push(options.type);
    }
    if (options.severity) {
        query += ' AND pn.severity = ?';
        params.push(options.severity);
    }
    query += ' ORDER BY pn.created_at DESC';
    const notes = db.prepare(query).all(...params);
    if (notes.length === 0) {
        console.log(`\nNo notes found for: ${prompt.stable_name}\n`);
        return;
    }
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  Notes for: ${prompt.stable_name.substring(0, 36).padEnd(36)}║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    for (const note of notes) {
        const version = note.version_number ? `v${note.version_number}` : '?';
        const type = (note.note_type || 'general_note').replace(/_/g, ' ').toUpperCase();
        const severity = note.severity && note.severity !== 'none' ? ` [${note.severity.toUpperCase()}]` : '';
        console.log(`║  ${version} │ ${type}${severity}`);
        if (note.title)
            console.log(`║       ${note.title.substring(0, 42)}`);
        if (note.body)
            console.log(`║       ${note.body.substring(0, 42)}`);
        console.log(`║       ID: ${note.id.substring(0, 8)}…  ${note.created_at}`);
        console.log(`╟──────────────────────────────────────────────────╢`);
    }
    console.log(`╚══════════════════════════════════════════════════╝`);
    console.log(`  ${notes.length} note(s) total.\n`);
}
export function deleteNote(noteId) {
    const db = getDb();
    const note = db.prepare('SELECT * FROM prompt_notes WHERE id = ? OR id LIKE ?').get(noteId, `${noteId}%`);
    if (!note) {
        console.error(`Note not found: ${noteId}`);
        console.log('Use "plog notes <promptId>" to list note IDs.');
        return;
    }
    db.prepare('DELETE FROM prompt_notes WHERE id = ?').run(note.id);
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get();
    if (projectInfo) {
        db.prepare(`
      INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), projectInfo.id, note.prompt_id, note.version_id, 'note_deleted', JSON.stringify({ note_id: note.id, title: note.title }), 'cli');
    }
    console.log(`Deleted note: ${note.title || note.id}`);
}
