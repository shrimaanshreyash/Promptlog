import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('release metadata', () => {
  it('keeps npm and Claude plugin versions synchronized', () => {
    const root = path.join(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const pluginJson = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string };
    expect(pluginJson.version).toBe(packageJson.version);
  });
});
