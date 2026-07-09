import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDb } from '../db/sqlite.js';
import { getGitMetadata } from '../scanner/git.js';

export function addPromptManually(
  projectRoot: string,
  filePath: string,
  options: { start?: string; end?: string; name?: string }
) {
  const db = getDb();
  const absPath = path.resolve(projectRoot, filePath);

  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    return;
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  const startLine = options.start ? parseInt(options.start, 10) : 1;
  const endLine = options.end ? parseInt(options.end, 10) : lines.length;

  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    console.error(`Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
    return;
  }

  const promptContent = lines.slice(startLine - 1, endLine).join('\n').trim();
  if (promptContent.length < 10) {
    console.error('Selected content is too short to be a prompt (< 10 chars).');
    return;
  }

  const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
  const slug = relPath.replace(/\.(ts|tsx|js|jsx|py|md|yaml|yml|json)$/i, '');
  const promptName = options.name || `manual_${startLine}`;
  const stableName = `${slug}::${promptName}`;

  const existing = db.prepare(
    'SELECT id FROM prompts WHERE stable_name = ?'
  ).get(stableName) as any;

  if (existing) {
    console.error(`Prompt already tracked with name: ${stableName}`);
    console.log('Use a different --name or update the existing prompt.');
    return;
  }

  const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined;
  if (!projectInfo) {
    console.error('No project found. Run "plog init" first.');
    return;
  }

  const promptId = uuidv4();
  const versionId = uuidv4();
  const contentHash = crypto.createHash('sha256').update(promptContent).digest('hex');
  const gitMeta = getGitMetadata(projectRoot);
  const ext = path.extname(absPath).replace('.', '');

  db.prepare(`
    INSERT INTO prompts (id, project_id, stable_name, display_name, prompt_type, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(promptId, projectInfo.id, stableName, `${slug} (${promptName}, L${startLine})`, 'manual', 'active');

  db.prepare(`
    INSERT INTO prompt_versions
      (id, prompt_id, version_number, raw_content, normalized_content, content_hash,
       source_file, start_line, end_line, source_language, source_kind,
       git_branch, git_commit, git_author, git_dirty_state, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, promptId, 1,
    promptContent, promptContent, contentHash,
    relPath, startLine, endLine, ext, 'manual',
    gitMeta?.branch ?? null, gitMeta?.commit ?? null,
    gitMeta?.author ?? null, gitMeta?.isDirty ? 1 : 0,
    'active', 'user'
  );

  db.prepare('UPDATE prompts SET current_version_id = ? WHERE id = ?').run(versionId, promptId);

  db.prepare(`
    INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), projectInfo.id, promptId, versionId, 'prompt_added_manually', 'user');

  const snapshotDir = path.join(projectRoot, '.promptlog', 'snapshots', 'prompts', promptId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'v1.prompt.txt'), promptContent, 'utf8');

  console.log(`\n✅  Prompt registered manually:`);
  console.log(`    Name:  ${stableName}`);
  console.log(`    File:  ${relPath}:${startLine}-${endLine}`);
  console.log(`    Chars: ${promptContent.length}`);
  console.log(`\n    This prompt will now be tracked by scan and watch.\n`);
}
