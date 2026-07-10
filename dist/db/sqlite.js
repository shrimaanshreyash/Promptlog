import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';
import { schema } from './schema.js';
let db = null;
const require = createRequire(import.meta.url);
let sqliteWarningFilterInstalled = false;
function installNodeSqliteWarningFilter() {
    if (sqliteWarningFilterInstalled)
        return;
    sqliteWarningFilterInstalled = true;
    const emitWarning = process.emitWarning;
    process.emitWarning = ((warning, ...args) => {
        const message = typeof warning === 'string' ? warning : warning.message;
        if (message.includes('SQLite is an experimental feature'))
            return;
        return emitWarning.call(process, warning, ...args);
    });
}
function openDatabase(dbPath) {
    installNodeSqliteWarningFilter();
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath, {
        enableDoubleQuotedStringLiterals: true,
    });
}
export function initDb(projectRoot) {
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
    if (!db)
        throw new Error('Database not initialized');
    return db;
}
export function closeDb() {
    if (!db)
        return;
    db.close();
    db = null;
}
