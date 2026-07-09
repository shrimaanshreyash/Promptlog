import fs from 'fs';
import path from 'path';

function getConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.promptlog', 'config.json');
}

function readConfig(projectRoot: string): any {
  const configPath = getConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) {
    console.error('PromptLog is not initialized. Run: plog init');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(projectRoot: string, config: any): void {
  const configPath = getConfigPath(projectRoot);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function getNestedValue(obj: any, keyPath: string): any {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(obj: any, keyPath: string, value: any): void {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) current[parts[i]] = {};
    current = current[parts[i]];
  }
  // Try to parse value as JSON, fallback to string
  try {
    current[parts[parts.length - 1]] = JSON.parse(value);
  } catch {
    current[parts[parts.length - 1]] = value;
  }
}

export function configGet(projectRoot: string, key: string): void {
  const config = readConfig(projectRoot);
  const value = getNestedValue(config, key);
  if (value === undefined) {
    console.error(`Key not found: ${key}`);
    process.exit(1);
  }
  console.log(JSON.stringify(value, null, 2));
}

export function configSet(projectRoot: string, key: string, value: string): void {
  const config = readConfig(projectRoot);
  setNestedValue(config, key, value);
  writeConfig(projectRoot, config);
  console.log(`✅  Config updated: ${key} = ${value}`);
}
