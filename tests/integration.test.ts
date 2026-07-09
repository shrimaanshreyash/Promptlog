import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const CLI = path.join(__dirname, '..', 'dist', 'index.js');

function run(cmd: string, cwd: string): string {
  return execSync(`node ${CLI} ${cmd}`, { cwd, encoding: 'utf8', timeout: 30000 });
}

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlog-test-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

function writePromptFile(dir: string, filename: string, content: string) {
  fs.writeFileSync(path.join(dir, 'src', filename), content, 'utf8');
}

describe('CLI integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('init creates .promptlog directory', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Always respond accurately.`;');
    run('init', testDir);
    expect(fs.existsSync(path.join(testDir, '.promptlog', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, '.promptlog', 'promptlog.sqlite'))).toBe(true);
  });

  it('scan detects JS/TS prompt variables', () => {
    writePromptFile(testDir, 'prompts.ts', `
export const systemPrompt = \`You are a helpful assistant.
Always respond in JSON format.
Never make assumptions.\`;
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 1');
  });

  it('scan detects Python prompt variables', () => {
    writePromptFile(testDir, 'prompts.py', `
SYSTEM_PROMPT = """You are a data analyst.
Parse CSV files and return structured JSON.
Handle missing values gracefully."""
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 1');
  });

  it('scan detects role/content objects', () => {
    writePromptFile(testDir, 'chat.ts', `
const messages = [
  { role: "system", content: \`You are a creative writing assistant. Help users brainstorm ideas.\` },
];
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 1');
  });

  it('scan detects record/dictionary prompts', () => {
    writePromptFile(testDir, 'agents.ts', `
export const AGENT_PROMPTS: Record<string, string> = {
  planner: \`You are a project planner. Break down complex tasks into steps.\`,
  executor: \`You are a task executor. Complete subtasks precisely and report.\`,
};
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 2');
  });

  it('scan detects prompt builder functions', () => {
    writePromptFile(testDir, 'builders.ts', `
export function createSummaryPrompt(doc: string): string {
  return \`Summarize the following document in bullet points. Document: \${doc}\`;
}
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 1');
  });

  it('does not detect non-prompt strings', () => {
    writePromptFile(testDir, 'config.ts', `
const dbUrl = "postgresql://localhost:5432/mydb";
const greeting = "Hello world";
const short = "hi";
`);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 0');
  });

  it('creates new version on content change', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are helpful. Always respond in JSON.`;');
    run('init', testDir);

    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are precise and helpful. Always respond in valid JSON format.`;');
    const output = run('scan', testDir);
    expect(output).toContain('[CHG]');
    expect(output).toContain('v2');
  });

  it('stable names survive line shifts', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Follow instructions.`;');
    run('init', testDir);

    writePromptFile(testDir, 'prompts.ts', '// added comment\n// another\nexport const systemPrompt = `You are a helpful assistant. Follow instructions.`;');
    const output = run('scan', testDir);
    expect(output).not.toContain('[NEW]');
    expect(output).not.toContain('[CHG]');
    expect(output).not.toContain('[REM]');
  });

  it('duplicate content in different files tracked separately', () => {
    const prompt = 'export const systemPrompt = `You are an API assistant. Format responses as JSON.`;';
    writePromptFile(testDir, 'api-a.ts', prompt);
    writePromptFile(testDir, 'api-b.ts', prompt);
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Files with prompts: 2');
  });

  it('status shows correct counts', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Follow all guidelines.`;');
    run('init', testDir);
    const output = run('status', testDir);
    expect(output).toContain('Prompts tracked: 1');
    expect(output).toContain('Active:        1');
  });

  it('diff shows changes between versions', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are helpful. Always respond.`;');
    run('init', testDir);

    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are very helpful. Always respond accurately.`;');
    run('scan', testDir);

    const output = run('diff "prompts::systemPrompt" --latest', testDir);
    expect(output).toContain('v1');
    expect(output).toContain('v2');
  });

  it('manual add registers prompt and tracks changes', () => {
    const content = `const parts = [
  "You are a compliance checker.",
  "Review for regulatory violations.",
  "Flag GDPR non-compliance.",
];`;
    writePromptFile(testDir, 'manual.ts', content);
    run('init', testDir);

    const addOutput = run('add src/manual.ts --start 1 --end 5 --name complianceChecker', testDir);
    expect(addOutput).toContain('Prompt registered manually');

    const statusOutput = run('status', testDir);
    expect(statusOutput).toContain('Prompts tracked: 1');

    const scanOutput = run('scan', testDir);
    expect(scanOutput).not.toContain('[REM]');
  });

  it('note command adds notes to prompts', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a coding assistant. Write clean code.`;');
    run('init', testDir);

    const output = run('note "prompts::systemPrompt" --title "Test note" --body "This is a test" --type issue --severity medium', testDir);
    expect(output).toContain('Note added successfully');
  });

  it('notes command lists notes for a prompt', { timeout: 30000 }, () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a coding assistant. Write clean code.`;');
    run('init', testDir);
    run('note "prompts::systemPrompt" --title "First note" --body "Body one" --type issue --severity high', testDir);
    run('note "prompts::systemPrompt" --title "Second note" --body "Body two" --type benefit --severity low', testDir);

    const output = run('notes "prompts::systemPrompt"', testDir);
    expect(output).toContain('First note');
    expect(output).toContain('Second note');
    expect(output).toContain('2 note(s) total');
  });

  it('notes command filters by type', { timeout: 30000 }, () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a coding assistant. Write clean code.`;');
    run('init', testDir);
    run('note "prompts::systemPrompt" --title "Bug" --type issue --severity high', testDir);
    run('note "prompts::systemPrompt" --title "Win" --type benefit --severity low', testDir);

    const output = run('notes "prompts::systemPrompt" --type issue', testDir);
    expect(output).toContain('Bug');
    expect(output).not.toContain('Win');
    expect(output).toContain('1 note(s) total');
  });

  it('note-delete removes a note', { timeout: 30000 }, () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a coding assistant. Write clean code.`;');
    run('init', testDir);
    run('note "prompts::systemPrompt" --title "To delete" --body "Temp" --type general_note', testDir);

    const listOutput = run('notes "prompts::systemPrompt"', testDir);
    const idMatch = listOutput.match(/ID: ([a-f0-9]{8})/);
    expect(idMatch).toBeTruthy();

    const deleteOutput = run(`note-delete ${idMatch![1]}`, testDir);
    expect(deleteOutput).toContain('Deleted note');

    const afterDelete = run('notes "prompts::systemPrompt"', testDir);
    expect(afterDelete).toContain('No notes found');
  });

  it('export creates output files', () => {
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Be accurate and concise.`;');
    run('init', testDir);

    run('export --format all', testDir);
    expect(fs.existsSync(path.join(testDir, '.promptlog', 'exports', 'json', 'prompts.json'))).toBe(true);
  });
});

describe('multi-version tracking', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('tracks 5 consecutive versions correctly', { timeout: 30000 }, () => {
    const versions = [
      'export const systemPrompt = `You are a helpful assistant. Follow all instructions carefully and respond.`;',
      'export const systemPrompt = `You are a helpful and precise assistant. Follow all instructions carefully and respond.`;',
      'export const systemPrompt = `You are a helpful and precise assistant. Follow all instructions carefully. Respond in JSON.`;',
      'export const systemPrompt = `You are a helpful and precise assistant. Always follow instructions. Respond in valid JSON format.`;',
      'export const systemPrompt = `You are a principal engineer. Always follow instructions. Respond in valid JSON format. Cite sources.`;',
    ];

    writePromptFile(testDir, 'prompts.ts', versions[0]);
    run('init', testDir);

    for (let i = 1; i < versions.length; i++) {
      writePromptFile(testDir, 'prompts.ts', versions[i]);
      const output = run('scan', testDir);
      expect(output).toContain(`v${i + 1}`);
    }

    const status = run('status', testDir);
    expect(status).toContain('Versions total:  5');

    const diff = run('diff "prompts::systemPrompt" --from v1 --to v5', testDir);
    expect(diff).toContain('v1');
    expect(diff).toContain('v5');
  });
});

describe('ignore and unignore', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Follow all guidelines carefully.`;');
    run('init', testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('ignore marks prompt as ignored', () => {
    const output = run('ignore "prompts::systemPrompt"', testDir);
    expect(output).toContain('Ignored');
    const status = run('status', testDir);
    expect(status).toContain('Active:        0');
  });

  it('unignore restores ignored prompt', () => {
    run('ignore "prompts::systemPrompt"', testDir);
    const output = run('unignore "prompts::systemPrompt"', testDir);
    expect(output).toContain('Restored');
    const status = run('status', testDir);
    expect(status).toContain('Active:        1');
  });

  it('ignore already-ignored prompt is idempotent', () => {
    run('ignore "prompts::systemPrompt"', testDir);
    const output = run('ignore "prompts::systemPrompt"', testDir);
    expect(output).toContain('Already ignored');
  });
});

describe('.env prompt detection', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('detects prompt variables in .env files', () => {
    fs.writeFileSync(path.join(testDir, '.env'), 'SYSTEM_PROMPT="You are a helpful assistant. Follow all instructions carefully and respond accurately."\nDB_URL=postgresql://localhost\n');
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 1');
  });

  it('ignores non-prompt env variables', () => {
    fs.writeFileSync(path.join(testDir, '.env'), 'DATABASE_URL=postgresql://localhost\nAPI_KEY=sk-1234567890\nPORT=3000\n');
    run('init', testDir);
    const output = run('scan', testDir);
    expect(output).toContain('Confirmed: 0');
  });
});

describe('quiet and verbose flags', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
    writePromptFile(testDir, 'prompts.ts', 'export const systemPrompt = `You are a helpful assistant. Always respond accurately and follow guidelines.`;');
    run('init', testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('--quiet suppresses scan output', () => {
    const output = run('--quiet scan', testDir);
    expect(output.trim()).toBe('');
  });

  it('normal scan produces output', () => {
    const output = run('scan', testDir);
    expect(output).toContain('Scanning');
  });
});
