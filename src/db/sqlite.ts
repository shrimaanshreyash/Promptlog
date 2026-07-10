import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { schema } from './schema.js';

let db: DatabaseSync | null = null;
const require = createRequire(import.meta.url);
let sqliteWarningFilterInstalled = false;

function installNodeSqliteWarningFilter() {
  if (sqliteWarningFilterInstalled) return;
  sqliteWarningFilterInstalled = true;

  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: any[]) => {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (message.includes('SQLite is an experimental feature')) return;
    return (emitWarning as any).call(process, warning, ...args);
  }) as typeof process.emitWarning;
}

function openDatabase(dbPath: string): DatabaseSync {
  installNodeSqliteWarningFilter();
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  return new DatabaseSync(dbPath, {
    enableDoubleQuotedStringLiterals: true,
  });
}

export function initDb(projectRoot: string) {
  if (db) {
    db.close();
    db = null;
  }
  const dbDir = path.join(projectRoot, '.promptlog');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'promptlog.sqlite');
  db = openDatabase(dbPath);

  // Initialize schema
  db.exec(schema);
  
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}
