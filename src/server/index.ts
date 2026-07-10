import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/sqlite.js';
import { PromptLogConfig } from '../config.js';
import { getOrComputeDiff } from '../diff/engine.js';
import { registerSseClient, unregisterSseClient, scanProject } from '../scanner/index.js';
import { watchProject } from '../scanner/watch.js';
import { exportData } from '../commands/export.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

export function startServer(projectRoot: string, config: PromptLogConfig, port: number, host: string = '127.0.0.1') {
  const app = express();
  let activeWatcher: any = null;
  app.use(cors({ origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] }));
  app.use(express.json());

  // ─── Project ─────────────────────────────────────────────────────────────
  app.get('/api/project', (_req, res) => {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects LIMIT 1').get();
    res.json({ project });
  });

  // ─── Stats ────────────────────────────────────────────────────────────────
  app.get('/api/stats', (_req, res) => {
    const db = getDb();
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (!projectInfo) return res.json({ stats: null });

    const totalPrompts = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ?").get(projectInfo.id) as any).c;
    const activePrompts = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'active'").get(projectInfo.id) as any).c;
    const candidatePrompts = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'candidate'").get(projectInfo.id) as any).c;
    const removedPrompts = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'removed_from_codebase'").get(projectInfo.id) as any).c;
    const ignoredPrompts = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'ignored'").get(projectInfo.id) as any).c;
    const totalVersions = (db.prepare("SELECT COUNT(*) as c FROM prompt_versions pv JOIN prompts p ON pv.prompt_id = p.id WHERE p.project_id = ?").get(projectInfo.id) as any).c;

    // Unnoted: versions with no notes
    const unnotedVersions = (db.prepare(`
      SELECT COUNT(*) as c FROM prompt_versions pv
      JOIN prompts p ON pv.prompt_id = p.id
      LEFT JOIN prompt_notes pn ON pn.version_id = pv.id
      WHERE p.project_id = ? AND pn.id IS NULL AND pv.version_number > 1
    `).get(projectInfo.id) as any).c;

    const recentEvents = db.prepare(`
      SELECT pe.*, p.stable_name, p.display_name FROM prompt_events pe
      LEFT JOIN prompts p ON pe.prompt_id = p.id
      WHERE pe.project_id = ?
      ORDER BY pe.created_at DESC LIMIT 10
    `).all(projectInfo.id);

    res.json({
      stats: {
        totalPrompts,
        activePrompts,
        candidatePrompts,
        removedPrompts,
        ignoredPrompts,
        totalVersions,
        unnotedVersions,
        recentEvents,
      },
    });
  });

  // ─── Prompts ──────────────────────────────────────────────────────────────
  app.get('/api/prompts', (req, res) => {
    const db = getDb();
    const { status, search } = req.query as Record<string, string>;

    let query = 'SELECT * FROM prompts';
    const params: any[] = [];
    const clauses: string[] = [];

    if (status && status !== 'all') {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(stable_name LIKE ? OR display_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
    query += ' ORDER BY last_seen_at DESC';

    const prompts = db.prepare(query).all(...params);
    res.json({ prompts });
  });

  app.get('/api/prompts/:id', (req, res) => {
    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(req.params.id);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    res.json({ prompt });
  });

  // ─── Classification actions ───────────────────────────────────────────────
  app.post('/api/prompts/:id/confirm', (req, res) => {
    const db = getDb();
    db.prepare("UPDATE prompts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by) VALUES (?, ?, ?, ?, ?)`)
        .run(uuidv4(), projectInfo.id, req.params.id, 'prompt_confirmed', 'user');
    }
    res.json({ success: true, status: 'active' });
  });

  app.post('/api/prompts/:id/ignore', (req, res) => {
    const db = getDb();
    db.prepare("UPDATE prompts SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by) VALUES (?, ?, ?, ?, ?)`)
        .run(uuidv4(), projectInfo.id, req.params.id, 'prompt_ignored', 'user');
    }
    res.json({ success: true, status: 'ignored' });
  });

  app.post('/api/prompts/:id/mark-code', (req, res) => {
    const db = getDb();
    db.prepare("UPDATE prompts SET status = 'ignored', prompt_type = 'code_leakage', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by) VALUES (?, ?, ?, ?, ?)`)
        .run(uuidv4(), projectInfo.id, req.params.id, 'prompt_marked_as_code', 'user');
    }
    res.json({ success: true, status: 'ignored' });
  });

  // ─── Versions ─────────────────────────────────────────────────────────────
  app.get('/api/prompts/:id/versions', (req, res) => {
    const db = getDb();
    const versions = db.prepare(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC'
    ).all(req.params.id);
    res.json({ versions });
  });

  app.get('/api/prompts/:id/versions/:versionId', (req, res) => {
    const db = getDb();
    const version = db.prepare(
      'SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?'
    ).get(req.params.versionId, req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    res.json({ version });
  });

  // ─── Diff ─────────────────────────────────────────────────────────────────
  app.get('/api/prompts/:id/diff', (req, res) => {
    const db = getDb();
    const { from: fromParam, to: toParam } = req.query as { from?: string; to?: string };

    const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(req.params.id) as any;
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    // Resolve version numbers
    const parseVersionNum = (v: string) => parseInt(v.replace(/^v/, ''), 10);

    let fromVersion: any, toVersion: any;

    if (fromParam && toParam) {
      fromVersion = db.prepare(
        'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?'
      ).get(req.params.id, parseVersionNum(fromParam));
      toVersion = db.prepare(
        'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?'
      ).get(req.params.id, parseVersionNum(toParam));
    } else {
      // Default: latest vs previous
      const versions = db.prepare(
        'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 2'
      ).all(req.params.id) as any[];
      if (versions.length < 2) {
        return res.json({ diff: null, message: 'Only one version exists — nothing to diff.' });
      }
      toVersion = versions[0];
      fromVersion = versions[1];
    }

    if (!fromVersion || !toVersion) {
      return res.status(404).json({ error: 'Could not find requested versions for diff.' });
    }

    const result = getOrComputeDiff(
      db,
      req.params.id,
      fromVersion.id,
      toVersion.id,
      fromVersion.raw_content,
      toVersion.raw_content
    );

    res.json({
      diff: result,
      from: { versionNumber: fromVersion.version_number, id: fromVersion.id },
      to: { versionNumber: toVersion.version_number, id: toVersion.id },
    });
  });

  // ─── Notes ────────────────────────────────────────────────────────────────
  app.get('/api/prompts/:id/notes', (req, res) => {
    const db = getDb();
    const { version_id, note_type, severity } = req.query as Record<string, string>;

    let query = 'SELECT * FROM prompt_notes WHERE prompt_id = ?';
    const params: any[] = [req.params.id];

    if (version_id) {
      query += ' AND version_id = ?';
      params.push(version_id);
    }
    if (note_type) {
      query += ' AND note_type = ?';
      params.push(note_type);
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY created_at DESC';

    const notes = db.prepare(query).all(...params);
    res.json({ notes });
  });

  app.post('/api/prompts/:id/versions/:versionId/notes', (req, res) => {
    const db = getDb();
    const { note_type, title, body, severity } = req.body;

    if (!title && !body) {
      return res.status(400).json({ error: 'Note must have a title or body.' });
    }

    const prompt = db.prepare('SELECT id FROM prompts WHERE id = ?').get(req.params.id);
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found.' });
    }

    const version = db.prepare(
      'SELECT id FROM prompt_versions WHERE id = ? AND prompt_id = ?'
    ).get(req.params.versionId, req.params.id);
    if (!version) {
      return res.status(404).json({ error: 'Target version not found for this prompt.' });
    }

    const noteId = uuidv4();
    db.prepare(`
      INSERT INTO prompt_notes (id, prompt_id, version_id, note_type, title, body, severity, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noteId,
      req.params.id,
      req.params.versionId,
      note_type || 'general_note',
      title || '',
      body || '',
      severity || 'none',
      'user'
    );

    // Log event
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), projectInfo.id, req.params.id, req.params.versionId, 'note_added', 'user');
    }

    const note = db.prepare('SELECT * FROM prompt_notes WHERE id = ?').get(noteId);
    res.status(201).json({ note });
  });

  app.patch('/api/notes/:noteId', (req, res) => {
    const db = getDb();
    const { title, body, severity, note_type } = req.body;
    const existing = db.prepare('SELECT * FROM prompt_notes WHERE id = ?').get(req.params.noteId) as any;
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    db.prepare(`
      UPDATE prompt_notes SET
        title = ?, body = ?, severity = ?, note_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title ?? existing.title,
      body ?? existing.body,
      severity ?? existing.severity,
      note_type ?? existing.note_type,
      req.params.noteId
    );

    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), projectInfo.id, existing.prompt_id, existing.version_id,
        'note_updated',
        JSON.stringify({ note_id: req.params.noteId, title: title ?? existing.title }),
        'user'
      );
    }

    const note = db.prepare('SELECT * FROM prompt_notes WHERE id = ?').get(req.params.noteId);
    res.json({ note });
  });

  app.delete('/api/notes/:noteId', (req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM prompt_notes WHERE id = ?').get(req.params.noteId) as any;
    if (!existing) return res.status(404).json({ error: 'Note not found' });
    db.prepare('DELETE FROM prompt_notes WHERE id = ?').run(req.params.noteId);

    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), projectInfo.id, existing.prompt_id, existing.version_id,
        'note_deleted',
        JSON.stringify({ note_id: req.params.noteId, title: existing.title }),
        'user'
      );
    }

    res.json({ success: true });
  });

  // ─── Global notes search ───────────────────────────────────────────────────
  app.get('/api/notes/search', (req, res) => {
    const db = getDb();
    const { q, note_type, severity, limit: limitParam } = req.query as Record<string, string>;
    const limit = parseInt(limitParam || '50', 10);

    let query = `
      SELECT pn.*, p.stable_name, p.display_name, pv.version_number
      FROM prompt_notes pn
      LEFT JOIN prompts p ON pn.prompt_id = p.id
      LEFT JOIN prompt_versions pv ON pn.version_id = pv.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q) {
      query += ' AND (pn.title LIKE ? OR pn.body LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (note_type) {
      query += ' AND pn.note_type = ?';
      params.push(note_type);
    }
    if (severity) {
      query += ' AND pn.severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY pn.created_at DESC LIMIT ?';
    params.push(limit);

    const notes = db.prepare(query).all(...params);
    res.json({ notes });
  });

  // ─── Bulk note delete ──────────────────────────────────────────────────────
  app.post('/api/notes/bulk-delete', (req, res) => {
    const db = getDb();
    const { noteIds } = req.body as { noteIds: string[] };
    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({ error: 'noteIds array is required.' });
    }

    const placeholders = noteIds.map(() => '?').join(',');
    const notes = db.prepare(`SELECT * FROM prompt_notes WHERE id IN (${placeholders})`).all(...noteIds) as any[];

    if (notes.length === 0) return res.status(404).json({ error: 'No matching notes found.' });

    db.prepare(`DELETE FROM prompt_notes WHERE id IN (${placeholders})`).run(...noteIds);

    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      for (const note of notes) {
        db.prepare(`
          INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(), projectInfo.id, note.prompt_id, note.version_id,
          'note_deleted',
          JSON.stringify({ note_id: note.id, title: note.title, bulk: true }),
          'user'
        );
      }
    }

    res.json({ success: true, deleted: notes.length });
  });

  // ─── Events ───────────────────────────────────────────────────────────────
  app.get('/api/events', (req, res) => {
    const db = getDb();
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (!projectInfo) return res.json({ events: [] });
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const events = db.prepare(`
      SELECT pe.*, p.stable_name, p.display_name FROM prompt_events pe
      LEFT JOIN prompts p ON pe.prompt_id = p.id
      WHERE pe.project_id = ?
      ORDER BY pe.created_at DESC LIMIT ?
    `).all(projectInfo.id, limit);
    res.json({ events });
  });

  // ─── Export ───────────────────────────────────────────────────────────────
  app.post('/api/export', (req, res) => {
    const { format } = req.body as { format?: string };
    try {
      exportData(projectRoot, config, { format: format || 'all' });
      res.json({ success: true, format: format || 'all' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Rollback ─────────────────────────────────────────────────────────────
  app.post('/api/rollback', (req, res) => {
    const db = getDb();
    const { promptId, toVersion } = req.body as { promptId: string; toVersion: number };

    const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any;
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const version = db.prepare(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?'
    ).get(promptId, toVersion) as any;
    if (!version) return res.status(404).json({ error: `Version v${toVersion} not found` });

    // Generate patch content
    const currentVersion = db.prepare(
      'SELECT * FROM prompt_versions WHERE id = ?'
    ).get(prompt.current_version_id) as any;

    const patchDir = path.join(projectRoot, '.promptlog', 'patches');
    fs.mkdirSync(patchDir, { recursive: true });
    const patchName = `${prompt.stable_name}-v${toVersion}.patch`;
    const patchPath = path.join(patchDir, patchName);

    const patchContent = [
      `--- Rollback patch for: ${prompt.stable_name}`,
      `--- Generated: ${new Date().toISOString()}`,
      `--- From: v${currentVersion?.version_number ?? '?'} → v${toVersion}`,
      `--- Source file: ${version.source_file}`,
      ``,
      `=== RESTORE CONTENT ===`,
      version.raw_content,
      `=== END RESTORE CONTENT ===`,
    ].join('\n');

    fs.writeFileSync(patchPath, patchContent, 'utf8');

    // Log event
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), projectInfo.id, promptId, version.id,
        'rollback_patch_created',
        JSON.stringify({ patchPath: path.relative(projectRoot, patchPath), toVersion }),
        'user'
      );
    }

    res.json({
      success: true,
      patchPath: path.relative(projectRoot, patchPath).replace(/\\/g, '/'),
      content: version.raw_content,
    });
  });

  // ─── Rollback Apply ────────────────────────────────────────────────────────
  app.post('/api/rollback/apply', (req, res) => {
    const db = getDb();
    const { promptId, toVersion } = req.body as { promptId: string; toVersion: number };

    const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any;
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const version = db.prepare(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?'
    ).get(promptId, toVersion) as any;
    if (!version) return res.status(404).json({ error: `Version v${toVersion} not found` });

    const sourceFile = path.join(projectRoot, version.source_file);
    if (!fs.existsSync(sourceFile)) {
      return res.status(400).json({
        error: `Source file not found: ${version.source_file}. Cannot apply rollback.`,
      });
    }

    // Write the content to source file
    fs.writeFileSync(sourceFile, version.raw_content, 'utf8');

    // Log event
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
    if (projectInfo) {
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), projectInfo.id, promptId, version.id,
        'rollback_applied',
        JSON.stringify({ toVersion, sourceFile: version.source_file }),
        'user'
      );
    }

    res.json({
      success: true,
      message: `Rollback applied. ${version.source_file} restored to v${toVersion}. Re-scan to record the new version.`,
      sourceFile: version.source_file,
    });
  });

  // ─── Manual prompt registration ──────────────────────────────────────────
  app.post('/api/prompts/add', async (req, res) => {
    const { filePath, startLine, endLine, name } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });
    try {
      const { addPromptManually } = await import('../commands/add.js');
      addPromptManually(projectRoot, filePath, {
        start: startLine?.toString(),
        end: endLine?.toString(),
        name,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Scanner & Watcher ───────────────────────────────────────────────────
  app.post('/api/scan', (req, res) => {
    try {
      scanProject(projectRoot, config);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/watcher/status', (req, res) => {
    res.json({ watching: activeWatcher !== null });
  });

  app.post('/api/watcher/toggle', async (req, res) => {
    try {
      if (activeWatcher) {
        await activeWatcher.close();
        activeWatcher = null;
        console.log('[server] File watcher stopped.');
      } else {
        activeWatcher = watchProject(projectRoot, config);
        console.log('[server] File watcher started.');
      }
      res.json({ success: true, watching: activeWatcher !== null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── SSE live updates ─────────────────────────────────────────────────────
  app.get('/api/live', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send a heartbeat every 20s to keep connection alive
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 20_000);

    registerSseClient(res);

    req.on('close', () => {
      clearInterval(heartbeat);
      unregisterSseClient(res);
    });
  });

  // ─── Serve compiled UI ────────────────────────────────────────────────────
  const __cliDir = path.dirname(fileURLToPath(import.meta.url));
  const uiPath = path.join(__cliDir, '..', '..', 'ui', 'dist');
  if (fs.existsSync(uiPath)) {
    app.use(express.static(uiPath));
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(uiPath, 'index.html'));
      } else {
        next();
      }
    });
  }

  // ─── Start with port fallback ─────────────────────────────────────────────
  const server = app.listen(port, host, () => {
    console.log(`\n✅  PromptLog Dashboard → http://${host}:${port}\n`);
    if (host === '127.0.0.1' || host === 'localhost') {
      console.log(`    (bound to localhost only — use --host 0.0.0.0 to expose)\n`);
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${port} in use — trying port ${port + 1}...`);
      startServer(projectRoot, config, port + 1, host);
    } else {
      console.error('Server error:', err);
    }
  });

  return server;
}
