import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const CLI = path.join(__dirname, '..', 'dist', 'index.js');
let testDir: string;
let serverProcess: any;
let port: number;

function runCli(cmd: string): string {
  return execSync(`node ${CLI} ${cmd}`, { cwd: testDir, encoding: 'utf8', timeout: 15000 });
}

async function fetchApi(endpoint: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, options);
  return res.json();
}

describe('Server API', { timeout: 30000 }, () => {
  beforeAll(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlog-api-'));
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'src', 'prompts.ts'),
      'export const systemPrompt = `You are a helpful assistant. Follow all instructions carefully and respond.`;\n' +
      'export const userTemplate = `Given context, analyze the data and provide detailed findings.`;'
    );
    runCli('init');
    fs.writeFileSync(path.join(testDir, 'src', 'prompts.ts'),
      'export const systemPrompt = `You are a precise assistant. Follow all instructions and return valid JSON.`;\n' +
      'export const userTemplate = `Given context, analyze the data and provide detailed findings.`;'
    );
    runCli('scan');
    port = 14319;

    const { spawn } = await import('child_process');
    serverProcess = spawn('node', [CLI, 'ui', '--port', String(port), '--no-open'], {
      cwd: testDir, stdio: 'pipe',
    });

    await new Promise<void>((resolve) => {
      serverProcess.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('PromptLog Dashboard')) resolve();
      });
      setTimeout(resolve, 5000);
    });
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* locked on Windows */ }
  });

  it('GET /api/project returns project info', async () => {
    const data = await fetchApi('/api/project');
    expect(data.project).toBeDefined();
    expect(data.project.name).toBeTruthy();
  });

  it('GET /api/stats returns prompt counts', async () => {
    const data = await fetchApi('/api/stats');
    expect(data.stats.totalPrompts).toBeGreaterThanOrEqual(2);
    expect(data.stats.activePrompts).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/prompts returns prompt list', async () => {
    const data = await fetchApi('/api/prompts');
    expect(data.prompts.length).toBeGreaterThanOrEqual(2);
    const names = data.prompts.map((p: any) => p.stable_name);
    expect(names).toContain('prompts::systemPrompt');
  });

  it('GET /api/prompts with search filter works', async () => {
    const data = await fetchApi('/api/prompts?search=system&status=all');
    expect(data.prompts.some((p: any) => p.stable_name.includes('system'))).toBe(true);
  });

  it('GET /api/prompts/:id/versions returns version history', async () => {
    const prompts = await fetchApi('/api/prompts');
    const promptId = prompts.prompts[0].id;
    const data = await fetchApi(`/api/prompts/${promptId}/versions`);
    expect(data.versions.length).toBeGreaterThanOrEqual(1);
    expect(data.versions[0].raw_content).toBeTruthy();
  });

  it('POST /api/rollback/apply replaces only the selected prompt span', async () => {
    const prompts = await fetchApi('/api/prompts');
    const prompt = prompts.prompts.find((item: any) => item.stable_name === 'prompts::systemPrompt');
    const versions = await fetchApi(`/api/prompts/${prompt.id}/versions`);
    expect(versions.versions.length).toBe(2);

    const data = await fetchApi('/api/rollback/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptId: prompt.id, toVersion: 1 }),
    });
    expect(data.success).toBe(true);

    const source = fs.readFileSync(path.join(testDir, 'src', 'prompts.ts'), 'utf8');
    expect(source).toContain('You are a helpful assistant. Follow all instructions carefully and respond.');
    expect(source).toContain('export const userTemplate');
    expect(source).toContain('Given context, analyze the data and provide detailed findings.');
  });

  it('POST /api/prompts/:id/versions/:vid/notes creates note', async () => {
    const prompts = await fetchApi('/api/prompts');
    const promptId = prompts.prompts[0].id;
    const versions = await fetchApi(`/api/prompts/${promptId}/versions`);
    const versionId = versions.versions[0].id;

    const data = await fetchApi(`/api/prompts/${promptId}/versions/${versionId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test note', body: 'API test', note_type: 'test_result', severity: 'low' }),
    });
    expect(data.note).toBeDefined();
    expect(data.note.title).toBe('Test note');
  });

  it('POST /api/prompts/:id/versions/:vid/notes rejects versions from another prompt', async () => {
    const prompts = await fetchApi('/api/prompts');
    expect(prompts.prompts.length).toBeGreaterThanOrEqual(2);
    const promptId = prompts.prompts[0].id;
    const otherPromptId = prompts.prompts[1].id;
    const otherVersions = await fetchApi(`/api/prompts/${otherPromptId}/versions`);
    const otherVersionId = otherVersions.versions[0].id;

    const response = await fetch(`http://127.0.0.1:${port}/api/prompts/${promptId}/versions/${otherVersionId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Wrong target', body: 'Should not save' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('Target version not found');
  });

  it('GET /api/prompts/:id/notes returns notes', async () => {
    const prompts = await fetchApi('/api/prompts');
    const promptId = prompts.prompts[0].id;
    const data = await fetchApi(`/api/prompts/${promptId}/notes`);
    expect(data.notes.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /api/notes/:id updates note', async () => {
    const prompts = await fetchApi('/api/prompts');
    const promptId = prompts.prompts[0].id;
    const notes = await fetchApi(`/api/prompts/${promptId}/notes`);
    const noteId = notes.notes[0].id;

    const data = await fetchApi(`/api/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title', severity: 'high' }),
    });
    expect(data.note.title).toBe('Updated title');
    expect(data.note.severity).toBe('high');
  });

  it('DELETE /api/notes/:id deletes note', async () => {
    const prompts = await fetchApi('/api/prompts');
    const promptId = prompts.prompts[0].id;
    const notes = await fetchApi(`/api/prompts/${promptId}/notes`);
    const noteId = notes.notes[0].id;

    const data = await fetchApi(`/api/notes/${noteId}`, { method: 'DELETE' });
    expect(data.success).toBe(true);
  });

  it('GET /api/watcher/status returns watcher state', async () => {
    const data = await fetchApi('/api/watcher/status');
    expect(typeof data.watching).toBe('boolean');
  });

  it('POST /api/scan triggers rescan', async () => {
    const data = await fetchApi('/api/scan', { method: 'POST' });
    expect(data.success).toBe(true);
  });

  it('GET /api/events returns event log', async () => {
    const data = await fetchApi('/api/events');
    expect(data.events.length).toBeGreaterThanOrEqual(1);
  });
});
