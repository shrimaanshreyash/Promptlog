import { getDb } from '../db/sqlite.js';

export function showStatus(projectRoot: string) {
  const db = getDb();

  const project = db.prepare('SELECT * FROM projects LIMIT 1').get() as any;
  if (!project) {
    console.log('\n⚠️  PromptLog is not initialized in this directory.');
    console.log('   Run: plog init\n');
    return;
  }

  const total = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ?").get(project.id) as any).c;
  const active = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'active'").get(project.id) as any).c;
  const removed = (db.prepare("SELECT COUNT(*) as c FROM prompts WHERE project_id = ? AND status = 'removed_from_codebase'").get(project.id) as any).c;
  const versions = (db.prepare(`
    SELECT COUNT(*) as c FROM prompt_versions pv
    JOIN prompts p ON pv.prompt_id = p.id WHERE p.project_id = ?
  `).get(project.id) as any).c;

  const unnoted = (db.prepare(`
    SELECT COUNT(*) as c FROM prompt_versions pv
    JOIN prompts p ON pv.prompt_id = p.id
    LEFT JOIN prompt_notes pn ON pn.version_id = pv.id
    WHERE p.project_id = ? AND pn.id IS NULL AND pv.version_number > 1
  `).get(project.id) as any).c;

  const recentEvents = db.prepare(`
    SELECT pe.event_type, pe.created_at, p.stable_name FROM prompt_events pe
    LEFT JOIN prompts p ON pe.prompt_id = p.id
    WHERE pe.project_id = ?
    ORDER BY pe.created_at DESC LIMIT 5
  `).all(project.id) as any[];

  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║          PromptLog Status                ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Project:         ${(project.name || '').padEnd(22)}║`);
  console.log(`║  Prompts tracked: ${String(total).padEnd(22)}║`);
  console.log(`║    Active:        ${String(active).padEnd(22)}║`);
  console.log(`║    Removed:       ${String(removed).padEnd(22)}║`);
  console.log(`║  Versions total:  ${String(versions).padEnd(22)}║`);
  console.log(`║  Unnoted changes: ${String(unnoted).padEnd(22)}║`);
  console.log(`║  Dashboard:       ${'http://localhost:4319'.padEnd(22)}║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Recent Activity:                        ║');

  if (recentEvents.length === 0) {
    console.log('║    No events yet.                        ║');
  } else {
    for (const evt of recentEvents) {
      const label = `${evt.event_type.replace(/_/g, ' ')} — ${evt.stable_name || 'project'}`;
      console.log(`║    · ${label.substring(0, 38).padEnd(38)}║`);
    }
  }

  console.log('╚══════════════════════════════════════════╝\n');

  if (unnoted > 0) {
    console.log(`💡  ${unnoted} prompt change(s) have no notes. Run: plog note <promptId>`);
  }
}
