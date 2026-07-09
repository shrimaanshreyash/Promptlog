import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { scanProject, scanFiles, broadcastSseEvent } from './index.js';
const WATCH_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.yaml', '.yml', '.json', '.md', '.mdx',
    '.txt', '.prompt', '.jinja', '.jinja2', '.hbs',
    '.env',
]);
const WATCH_EXACT_NAMES = new Set(['.env', '.env.local', '.env.production']);
function resolveWatchPaths(projectRoot, includePatterns) {
    const dirs = [];
    for (const pattern of includePatterns) {
        const base = pattern.split('*')[0].replace(/\/+$/, '');
        if (!base) {
            dirs.push(projectRoot);
            continue;
        }
        const full = path.join(projectRoot, base);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            dirs.push(full);
        }
        else if (fs.existsSync(full)) {
            dirs.push(path.dirname(full));
        }
        else {
            const parent = path.dirname(full);
            if (fs.existsSync(parent))
                dirs.push(parent);
        }
    }
    const unique = [...new Set(dirs)];
    console.log(`[watch] Resolved watch directories: ${unique.map(d => path.relative(projectRoot, d) || '.').join(', ')}`);
    return unique;
}
export function watchProject(projectRoot, config) {
    console.log(`[watch] Starting watch on ${projectRoot}`);
    console.log(`[watch] Config include: ${config.scanner.include.join(', ')}`);
    const watchDirs = resolveWatchPaths(projectRoot, config.scanner.include);
    const ignoreDirs = [
        'node_modules', '.git', '.next', '.promptlog', 'dist', 'build',
        '.vercel', '__pycache__', '.venv', 'venv', '.turbo', '.cache',
        'coverage', '.nyc_output', '.parcel-cache',
    ];
    const usePolling = process.env.PROMPTLOG_POLL === '1' || process.env.CHOKIDAR_USEPOLLING === '1';
    if (usePolling) {
        console.log('[watch] Using polling mode (PROMPTLOG_POLL=1)');
    }
    const watcher = chokidar.watch(watchDirs, {
        ignored: [
            ...ignoreDirs.map(d => `**/${d}/**`),
            ...ignoreDirs.map(d => path.join(projectRoot, d)),
            (filePath) => {
                const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
                return ignoreDirs.some(d => rel.startsWith(d + '/') || rel === d);
            },
        ],
        persistent: true,
        ignoreInitial: true,
        usePolling,
        interval: usePolling ? 2000 : undefined,
    });
    const isWatchedFile = (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const name = path.basename(filePath);
        return WATCH_EXTENSIONS.has(ext) || WATCH_EXACT_NAMES.has(name);
    };
    watcher
        .on('add', (filePath) => {
        if (!isWatchedFile(filePath))
            return;
        const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        console.log(`[watch] + FILE ADDED: ${rel}`);
        scheduleRescan(projectRoot, config, 'file_added', filePath);
    })
        .on('change', (filePath) => {
        if (!isWatchedFile(filePath))
            return;
        const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        console.log(`[watch] ~ FILE CHANGED: ${rel}`);
        scheduleRescan(projectRoot, config, 'file_changed', filePath);
    })
        .on('unlink', (filePath) => {
        if (!isWatchedFile(filePath))
            return;
        const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        console.log(`[watch] - FILE DELETED: ${rel}`);
        scheduleFullRescan(projectRoot, config, 'file_deleted', rel);
    })
        .on('error', (err) => {
        console.error('[watch] Watcher error:', err instanceof Error ? err.message : err);
    })
        .on('ready', () => {
        console.log('[watch] Ready. Monitoring for file changes...');
    });
    return watcher;
}
let scanTimeout = null;
let pendingFiles = [];
let pendingFullRescan = false;
function scheduleRescan(projectRoot, config, reason, filePath) {
    pendingFiles.push(filePath);
    if (scanTimeout)
        clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
        const files = [...new Set(pendingFiles)];
        pendingFiles = [];
        if (pendingFullRescan) {
            pendingFullRescan = false;
            doFullRescan(projectRoot, config, reason, files.map(f => path.relative(projectRoot, f).replace(/\\/g, '/')));
            return;
        }
        console.log(`[watch] === INCREMENTAL SCAN ===`);
        console.log(`[watch] Reason: ${reason}`);
        console.log(`[watch] Files (${files.length}):`);
        for (const f of files) {
            console.log(`[watch]   → ${path.relative(projectRoot, f).replace(/\\/g, '/')}`);
        }
        try {
            const result = scanFiles(projectRoot, config, files);
            console.log(`[watch] Scan complete — confirmed: ${result.confirmed}, candidates: ${result.candidates}, rejected: ${result.rejected}`);
            console.log(`[watch] === END SCAN ===`);
            broadcastSseEvent('scan_complete', {
                trigger: reason,
                filesChanged: files.map(f => path.relative(projectRoot, f).replace(/\\/g, '/')),
                confirmed: result.confirmed,
                candidates: result.candidates,
                timestamp: new Date().toISOString(),
            });
        }
        catch (err) {
            console.error('[watch] Scan error:', err.message || err);
        }
    }, 3000);
}
function scheduleFullRescan(projectRoot, config, reason, relPath) {
    pendingFullRescan = true;
    pendingFiles.push(relPath);
    if (scanTimeout)
        clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
        const files = [...pendingFiles];
        pendingFiles = [];
        pendingFullRescan = false;
        doFullRescan(projectRoot, config, reason, files);
    }, 3000);
}
function doFullRescan(projectRoot, config, reason, files) {
    console.log(`[watch] === FULL RESCAN ===`);
    console.log(`[watch] Reason: ${reason} (${files.join(', ')})`);
    try {
        const result = scanProject(projectRoot, config);
        console.log(`[watch] Full scan complete — confirmed: ${result.confirmed}`);
        console.log(`[watch] === END RESCAN ===`);
        broadcastSseEvent('scan_complete', {
            trigger: reason,
            filesChanged: files,
            confirmed: result.confirmed,
            candidates: result.candidates,
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        console.error('[watch] Scan error:', err.message || err);
    }
}
