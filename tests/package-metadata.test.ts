import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

describe('release metadata', () => {
  it('keeps npm and Claude plugin versions synchronized', () => {
    const root = path.join(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const pluginJson = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string };
    expect(pluginJson.version).toBe(packageJson.version);
  });

  it('installs the Claude plugin from the matching npm package', () => {
    const root = path.join(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string };
    const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')) as {
      plugins: Array<{ source: { source: string; package: string; version: string } }>;
    };
    const source = marketplace.plugins[0].source;

    expect(source.source).toBe('npm');
    expect(source.package).toBe(packageJson.name);
    expect(source.version).toBe(packageJson.version);
  });

  it('ships the Claude plugin manifest and skill in the npm package', () => {
    const root = path.join(__dirname, '..');
    const npmIgnore = fs.readFileSync(path.join(root, '.npmignore'), 'utf8');
    const skill = fs.readFileSync(path.join(root, 'skills', 'plog', 'SKILL.md'), 'utf8');

    expect(npmIgnore).not.toMatch(/^\/\.claude-plugin\/$/m);
    expect(npmIgnore).not.toMatch(/^\/skills\/$/m);
    expect(skill).toContain('${CLAUDE_PLUGIN_ROOT}/dist/index.js');
    expect(skill).not.toContain('npm install -g');
  });

  it('runs the bundled CLI without node_modules', () => {
    const root = path.join(__dirname, '..');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlog-bundle-test-'));
    const distDir = path.join(tempRoot, 'dist');

    try {
      fs.mkdirSync(distDir, { recursive: true });
      fs.copyFileSync(path.join(root, 'package.json'), path.join(tempRoot, 'package.json'));
      fs.copyFileSync(path.join(root, 'dist', 'index.js'), path.join(distDir, 'index.js'));

      const version = execFileSync(process.execPath, [path.join(distDir, 'index.js'), '--version'], {
        cwd: tempRoot,
        encoding: 'utf8',
      }).trim();

      const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
      expect(version).toBe(packageJson.version);
      expect(fs.existsSync(path.join(tempRoot, 'node_modules'))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
