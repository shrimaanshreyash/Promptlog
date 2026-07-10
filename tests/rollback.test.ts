import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyPromptRollback, RollbackApplyError } from '../src/rollback/apply.js';

function tempProject(source: string): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlog-rollback-'));
  const file = path.join(root, 'src', 'prompts.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return { root, file };
}

describe('safe rollback application', () => {
  it('replaces only the current prompt content', () => {
    const current = 'You are a precise assistant. Return valid JSON.';
    const target = 'You are a helpful assistant. Return JSON.';
    const project = tempProject(
      `import { run } from './runtime';\n\nexport const systemPrompt = \`${current}\`;\nexport const untouched = 'keep me';\n`,
    );

    applyPromptRollback(
      project.root,
      { source_file: 'src/prompts.ts', raw_content: current, start_line: 3 },
      { source_file: 'src/prompts.ts', raw_content: target, start_line: 3 },
    );

    const result = fs.readFileSync(project.file, 'utf8');
    expect(result).toContain(`systemPrompt = \`${target}\``);
    expect(result).toContain("import { run } from './runtime'");
    expect(result).toContain("untouched = 'keep me'");
  });

  it('uses the recorded location when identical prompt text appears more than once', () => {
    const current = 'You are an assistant that performs text-to-speech.';
    const project = tempProject(
      `const first = \`${current}\`;\n\n\nconst second = \`${current}\`;\n`,
    );

    applyPromptRollback(
      project.root,
      { source_file: 'src/prompts.ts', raw_content: current, start_line: 4 },
      { source_file: 'src/prompts.ts', raw_content: 'You are the streaming text-to-speech assistant.' },
    );

    const result = fs.readFileSync(project.file, 'utf8');
    expect(result).toContain(`first = \`${current}\``);
    expect(result).toContain('second = `You are the streaming text-to-speech assistant.`');
  });

  it('refuses to write when the current content cannot be located', () => {
    const original = 'export const systemPrompt = `Current source differs from the database.`;\n';
    const project = tempProject(original);

    expect(() => applyPromptRollback(
      project.root,
      { source_file: 'src/prompts.ts', raw_content: 'Missing current prompt', start_line: 1 },
      { source_file: 'src/prompts.ts', raw_content: 'Older prompt' },
    )).toThrow(RollbackApplyError);
    expect(fs.readFileSync(project.file, 'utf8')).toBe(original);
  });

  it('refuses source paths outside the project root', () => {
    const project = tempProject('export const prompt = `Safe content`;\n');
    expect(() => applyPromptRollback(
      project.root,
      { source_file: '../outside.ts', raw_content: 'Safe content', start_line: 1 },
      { source_file: '../outside.ts', raw_content: 'Older content' },
    )).toThrow(/outside the project root/);
  });
});
