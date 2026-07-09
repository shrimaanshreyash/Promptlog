import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { schema } from './schema.js';

let db: Database.Database | null = null;

export function initDb(projectRoot: string) {
  const dbDir = path.join(projectRoot, '.promptlog');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'promptlog.sqlite');
  db = new Database(dbPath);

  // Initialize schema
  db.exec(schema);
  
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}
