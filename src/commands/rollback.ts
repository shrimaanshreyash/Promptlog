import { getDb } from '../db/sqlite.js';
import { computeDiff } from '../diff/engine.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { applyPromptRollback, safePatchFileName } from '../rollback/apply.js';

export function rollback(promptId: string, versionArg: string, options: { output?: string; apply?: boolean }) {
  const db = getDb();

  const prompt = db.prepare(
    'SELECT * FROM prompts WHERE stable_name = ? OR id = ?'
  ).get(promptId, promptId) as any;

  if (!prompt) {
    console.error(`❌  Prompt not found: ${promptId}`);
    process.exit(1);
  }

  const versionNum = parseInt(versionArg.replace(/^v/, ''), 10);
  if (isNaN(versionNum)) {
    console.error(`❌  Invalid version: ${versionArg}. Use format: v3 or just 3`);
    process.exit(1);
  }

  const targetVersion = db.prepare(
    'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version_number = ?'
  ).get(prompt.id, versionNum) as any;

  if (!targetVersion) {
    console.error(`❌  Version v${versionNum} not found for prompt: ${promptId}`);
    process.exit(1);
  }

  const currentVersion = db.prepare(
    'SELECT * FROM prompt_versions WHERE id = ?'
  ).get(prompt.current_version_id) as any;

  // Generate a unified diff-style patch
  const oldContent = currentVersion?.raw_content ?? '';
  const newContent = targetVersion.raw_content;
  const diffResult = computeDiff(oldContent, newContent);

  const patchLines: string[] = [
    `--- Rollback Patch: ${prompt.stable_name}`,
    `--- Generated:      ${new Date().toISOString()}`,
    `--- Restore to:     v${versionNum} (from v${currentVersion?.version_number ?? '?'})`,
    `--- Source file:    ${currentVersion?.source_file ?? targetVersion.source_file}`,
    `--- Snapshot:       ${targetVersion.snapshot_path ?? 'N/A'}`,
    ``,
    `=== DIFF SUMMARY ===`,
    `Lines added:   ${diffResult.stats.linesAdded}`,
    `Lines removed: ${diffResult.stats.linesRemoved}`,
    `Words added:   ${diffResult.stats.wordsAdded}`,
    `Words removed: ${diffResult.stats.wordsRemoved}`,
    ``,
    `=== RESTORE CONTENT (v${versionNum}) ===`,
    newContent,
    `=== END RESTORE CONTENT ===`,
  ];

  const patchContent = patchLines.join('\n');
  const projectRoot = process.cwd();
  const patchDir = path.join(projectRoot, '.promptlog', 'patches');
  fs.mkdirSync(patchDir, { recursive: true });

  const patchFileName = safePatchFileName(prompt.stable_name, versionNum);
  const patchPath = path.join(patchDir, patchFileName);

  if (options.output) {
    // Write to user-specified file
    const outPath = path.resolve(projectRoot, options.output);
    fs.writeFileSync(outPath, newContent, 'utf8');
    console.log(`✅  Rollback content written to: ${outPath}`);
  } else if (options.apply) {
    const applied = applyPromptRollback(projectRoot, currentVersion, targetVersion);
    fs.writeFileSync(patchPath, patchContent, 'utf8');
    console.log(`✅  Applied rollback to: ${applied.relativeSourceFile}:${applied.startLine}-${applied.endLine}`);
    console.log(`📄  Patch saved to: ${patchPath}`);
    console.log(`\n⚠️  Re-run 'plog scan' to record the restored version.`);
  } else {
    // Default: just generate patch
    fs.writeFileSync(patchPath, patchContent, 'utf8');
    console.log(`\n📄  Rollback patch generated:`);
    console.log(`    ${patchPath}`);
    console.log(`\n    To apply: plog rollback ${promptId} ${versionArg} --apply`);
    console.log(`    To write content to file: plog rollback ${promptId} ${versionArg} --output <file>`);
  }

  // Log event
  const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get() as any;
  if (projectInfo) {
    db.prepare(`
      INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), projectInfo.id, prompt.id, targetVersion.id,
      'rollback_patch_created',
      JSON.stringify({ patchPath: path.relative(projectRoot, patchPath), toVersion: versionNum }),
      'cli'
    );
  }
}
