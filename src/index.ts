#!/usr/bin/env node
import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/sqlite.js';
import { initConfig } from './config.js';
import { scanProject } from './scanner/index.js';
import { watchProject } from './scanner/watch.js';
import { startServer } from './server/index.js';
import { showDiff } from './commands/diff.js';
import { addNote, listNotes, deleteNote } from './commands/note.js';
import { exportData } from './commands/export.js';
import { rollback } from './commands/rollback.js';
import { showStatus } from './commands/status.js';
import { configGet, configSet } from './commands/config.js';
import { addPromptManually } from './commands/add.js';

const program = new Command();
const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const packageVersion = (JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version: string }).version;

program
  .name('plog')
  .description('Permanent prompt memory, visual diffs, and human notes for AI applications.')
  .version(packageVersion)
  .option('-v, --verbose', 'Enable verbose output')
  .option('-q, --quiet', 'Suppress non-essential output');

function setLogLevel() {
  const opts = program.opts();
  if (opts.quiet) {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
  }
  if (opts.verbose) {
    process.env.PROMPTLOG_VERBOSE = '1';
  }
}

function ensurePromptLogIgnored(projectRoot: string): 'added' | 'present' | 'skipped' {
  const gitDir = path.join(projectRoot, '.git');
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitDir) && !fs.existsSync(gitignorePath)) {
    return 'skipped';
  }

  const entry = '.promptlog/';
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const lines = existing.split(/\r?\n/).map(line => line.trim());
  if (lines.some(line => line === '.promptlog' || line === '.promptlog/' || line === '.promptlog/**')) {
    return 'present';
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`, 'utf8');
  return 'added';
}

// ─── init ─────────────────────────────────────────────────────────────────────
program.command('init')
  .description('Initialize PromptLog in the current project.')
  .option('-o, --open', 'Open the dashboard after initialization')
  .action(async (options) => {
    console.log('\n🚀  Initializing PromptLog...\n');
    const projectRoot = process.cwd();

    const config = initConfig(projectRoot);
    console.log('✅  Config created at .promptlog/config.json');

    const gitignoreStatus = ensurePromptLogIgnored(projectRoot);
    if (gitignoreStatus === 'added') {
      console.log('✅  Added .promptlog/ to .gitignore');
    } else if (gitignoreStatus === 'present') {
      console.log('ℹ️   .promptlog/ already ignored by git');
    }

    const db = initDb(projectRoot);
    console.log('✅  SQLite database initialized');

    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
    if (projectCount.count === 0) {
      const projectId = uuidv4();
      db.prepare(`
        INSERT INTO projects (id, name, root_path, promptlog_version)
        VALUES (?, ?, ?, ?)
      `).run(projectId, config.project.name, projectRoot, packageVersion);
      db.prepare(`
        INSERT INTO prompt_events (id, project_id, event_type, created_by)
        VALUES (?, ?, ?, ?)
      `).run(uuidv4(), projectId, 'project_initialized', 'system');
      console.log(`✅  Project record created: ${config.project.name}`);
    } else {
      console.log('ℹ️   Project already initialized.');
    }

    console.log('\n🔍  Running initial scan...');
    scanProject(projectRoot, config);

    console.log('\n✅  PromptLog initialized successfully!');
    console.log(`\n    Dashboard: http://localhost:${config.ui.defaultPort}`);
    console.log(`    Run:       plog ui\n`);

    if (options.open) {
      const port = config.ui.defaultPort;
      startServer(projectRoot, config, port);
      setTimeout(() => openBrowser(`http://localhost:${port}`), 1000);
    }
  });

// ─── scan ─────────────────────────────────────────────────────────────────────
program.command('scan')
  .description('Scan the project for prompts.')
  .option('--include <pattern>', 'Files to include')
  .option('--exclude <pattern>', 'Files to exclude')
  .option('--json', 'Output results in JSON')
  .action((options) => {
    const projectRoot = process.cwd();
    const config = initConfig(projectRoot);
    initDb(projectRoot);

    if (options.include) config.scanner.include = [options.include];
    if (options.exclude) config.scanner.exclude = [options.exclude];

    if (options.json) {
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = () => {};
      console.warn = () => {};
      try {
        const result = scanProject(projectRoot, config);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
      }
      return;
    }

    console.log('🔍  Scanning project for prompts...\n');
    scanProject(projectRoot, config);
  });

// ─── watch ────────────────────────────────────────────────────────────────────
program.command('watch')
  .description('Watch for prompt changes in real time.')
  .action(() => {
    const projectRoot = process.cwd();
    const config = initConfig(projectRoot);
    initDb(projectRoot);
    watchProject(projectRoot, config);
  });

// ─── ui ───────────────────────────────────────────────────────────────────────
program.command('ui')
  .description('Start the local PromptLog dashboard.')
  .option('-p, --port <number>', 'Port to use')
  .option('--host <host>', 'Host to bind (default: 127.0.0.1, use 0.0.0.0 to expose)')
  .option('--open', 'Open in browser after start')
  .option('--no-open', 'Do not open browser')
  .action((options) => {
    const projectRoot = process.cwd();
    const config = initConfig(projectRoot);
    initDb(projectRoot);

    const port = options.port ? parseInt(options.port, 10) : config.ui.defaultPort;
    const host = options.host || '127.0.0.1';
    startServer(projectRoot, config, port, host);

    const shouldOpen = options.open !== false && config.ui.openBrowser;
    if (shouldOpen) {
      setTimeout(() => openBrowser(`http://localhost:${port}`), 1200);
    }
  });

// ─── status ───────────────────────────────────────────────────────────────────
program.command('status')
  .description('Show project status and prompt summary.')
  .action(() => {
    const projectRoot = process.cwd();
    const config = initConfig(projectRoot);
    initDb(projectRoot);
    showStatus(config.ui.defaultPort);
  });

// ─── diff ─────────────────────────────────────────────────────────────────────
program.command('diff <promptId>')
  .description('Show diff between prompt versions.')
  .option('--from <version>', 'From version (e.g. v2)')
  .option('--to <version>', 'To version (e.g. v3)')
  .option('--latest', 'Compare the two most recent versions')
  .action((promptId, options) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    showDiff(promptId, options);
  });

// ─── note ─────────────────────────────────────────────────────────────────────
program.command('note <promptId>')
  .description('Add a note to a prompt version.')
  .option('--version <version>', 'Target version (e.g. v3), defaults to current')
  .option('--type <type>', 'Note type (issue, benefit, reason, test_result, risk, etc)')
  .option('--title <title>', 'Note title')
  .option('--body <body>', 'Note body')
  .option('--severity <severity>', 'Severity (none, low, medium, high, critical)')
  .action((promptId, options) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    addNote(promptId, options);
  });

// ─── notes (list) ────────────────────────────────────────────────────────────
program.command('notes <promptId>')
  .description('List all notes for a prompt.')
  .option('--version <version>', 'Filter by version (e.g. v3)')
  .option('--type <type>', 'Filter by note type')
  .option('--severity <severity>', 'Filter by severity')
  .action((promptId, options) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    listNotes(promptId, options);
  });

// ─── note-delete ─────────────────────────────────────────────────────────────
program.command('note-delete <noteId>')
  .description('Delete a note by ID (use "plog notes <promptId>" to find IDs).')
  .action((noteId) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    deleteNote(noteId);
  });

// ─── export ───────────────────────────────────────────────────────────────────
program.command('export')
  .description('Export prompt history to Markdown or JSON.')
  .option('--format <format>', 'Export format: md, json, or all', 'all')
  .action((options) => {
    const projectRoot = process.cwd();
    const config = initConfig(projectRoot);
    initDb(projectRoot);
    exportData(projectRoot, config, options);
  });

// ─── rollback ─────────────────────────────────────────────────────────────────
program.command('rollback <promptId> <version>')
  .description('Generate a rollback patch or restore an older prompt version.')
  .option('-o, --output <file>', 'Write rollback content to this file')
  .option('--apply', 'Apply rollback directly to source file')
  .action((promptId, version, options) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    rollback(promptId, version, options);
  });

// ─── ignore ───────────────────────────────────────────────────────────────────
program.command('ignore <promptId>')
  .description('Mark a prompt as ignored (stop tracking it).')
  .action((promptId) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    const db = initDb(projectRoot);
    const prompt = db.prepare('SELECT id, stable_name, status FROM prompts WHERE stable_name = ? OR id = ?').get(promptId, promptId) as any;
    if (!prompt) {
      console.error(`Prompt not found: ${promptId}`);
      return;
    }
    if (prompt.status === 'ignored') {
      console.log(`Already ignored: ${prompt.stable_name}`);
      return;
    }
    db.prepare("UPDATE prompts SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prompt.id);
    console.log(`Ignored: ${prompt.stable_name}`);
  });

// ─── unignore ─────────────────────────────────────────────────────────────────
program.command('unignore <promptId>')
  .description('Restore a previously ignored prompt.')
  .action((promptId) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    const db = initDb(projectRoot);
    const prompt = db.prepare('SELECT id, stable_name, status FROM prompts WHERE stable_name = ? OR id = ?').get(promptId, promptId) as any;
    if (!prompt) {
      console.error(`Prompt not found: ${promptId}`);
      return;
    }
    if (prompt.status !== 'ignored') {
      console.log(`Not ignored: ${prompt.stable_name} (status: ${prompt.status})`);
      return;
    }
    db.prepare("UPDATE prompts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prompt.id);
    console.log(`Restored: ${prompt.stable_name}`);
  });

// ─── add (manual registration) ────────────────────────────────────────────────
program.command('add <file>')
  .description('Manually register a prompt the scanner missed.')
  .option('--start <line>', 'Start line number')
  .option('--end <line>', 'End line number')
  .option('--name <name>', 'Custom name for this prompt')
  .action((file, options) => {
    const projectRoot = process.cwd();
    initConfig(projectRoot);
    initDb(projectRoot);
    addPromptManually(projectRoot, file, options);
  });

// ─── config ───────────────────────────────────────────────────────────────────
const configCmd = program.command('config')
  .description('Read or update PromptLog configuration.');

configCmd.command('get <key>')
  .description('Get a config value (e.g. ui.defaultPort)')
  .action((key) => {
    const projectRoot = process.cwd();
    configGet(projectRoot, key);
  });

configCmd.command('set <key> <value>')
  .description('Set a config value (e.g. ui.defaultPort 5000)')
  .action((key, value) => {
    const projectRoot = process.cwd();
    configSet(projectRoot, key, value);
  });

// ─── helpers ──────────────────────────────────────────────────────────────────
function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      execSync(`start "" "${url}"`);
    } else if (platform === 'darwin') {
      execSync(`open "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }
  } catch {
    console.log(`Open your browser at: ${url}`);
  }
}

program.hook('preAction', () => setLogLevel());
program.parse(process.argv);
