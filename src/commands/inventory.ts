import { getDb } from '../db/sqlite.js';

interface InventoryOptions {
  json?: boolean;
}

interface InventoryPromptRow {
  id: string;
  stable_name: string;
  display_name: string;
  prompt_type: string;
  status: string;
  version_number: number | null;
  source_file: string | null;
  start_line: number | null;
  end_line: number | null;
  source_language: string | null;
  source_kind: string | null;
  content_hash: string | null;
  updated_at: string;
}

export function showInventory(options: InventoryOptions = {}): void {
  const db = getDb();
  const project = db.prepare(`
    SELECT id, name, root_path, promptlog_version
    FROM projects
    LIMIT 1
  `).get() as {
    id: string;
    name: string;
    root_path: string;
    promptlog_version: string | null;
  } | undefined;

  if (!project) {
    const emptyInventory = {
      initialized: false,
      project: null,
      summary: { total: 0, active: 0, candidate: 0, ignored: 0, removed: 0 },
      prompts: [],
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(emptyInventory, null, 2)}\n`);
    } else {
      console.log('PromptLog is not initialized in this directory. Run: plog init');
    }
    return;
  }

  const rows = db.prepare(`
    SELECT
      p.id,
      p.stable_name,
      p.display_name,
      p.prompt_type,
      p.status,
      pv.version_number,
      pv.source_file,
      pv.start_line,
      pv.end_line,
      pv.source_language,
      pv.source_kind,
      pv.content_hash,
      p.updated_at
    FROM prompts p
    LEFT JOIN prompt_versions pv ON pv.id = p.current_version_id
    WHERE p.project_id = ?
    ORDER BY pv.source_file, pv.start_line, p.stable_name
  `).all(project.id) as unknown as InventoryPromptRow[];

  const prompts = rows.map(row => ({
    id: row.id,
    stableName: row.stable_name,
    displayName: row.display_name,
    type: row.prompt_type,
    status: row.status,
    currentVersion: row.version_number,
    sourceFile: row.source_file,
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.source_language,
    sourceKind: row.source_kind,
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
  }));

  const summary = {
    total: prompts.length,
    active: prompts.filter(prompt => prompt.status === 'active').length,
    candidate: prompts.filter(prompt => prompt.status === 'candidate').length,
    ignored: prompts.filter(prompt => prompt.status === 'ignored').length,
    removed: prompts.filter(prompt => prompt.status === 'removed_from_codebase').length,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      initialized: true,
      project: {
        name: project.name,
        rootPath: project.root_path,
        promptlogVersion: project.promptlog_version,
      },
      summary,
      prompts,
    }, null, 2)}\n`);
    return;
  }

  console.log(`\nPromptLog inventory: ${summary.total} prompt(s)`);
  for (const prompt of prompts) {
    const location = prompt.sourceFile
      ? `${prompt.sourceFile}:${prompt.startLine ?? '?'}-${prompt.endLine ?? '?'}`
      : 'unknown location';
    console.log(`  ${prompt.status.padEnd(21)} ${prompt.stableName}  ${location}`);
  }
  console.log('');
}
