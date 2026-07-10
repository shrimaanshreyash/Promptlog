import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { getGitMetadata } from './git.js';
import crypto from 'crypto';
// ─── SSE broadcaster ──────────────────────────────────────────────────────────
let sseClients = [];
export function registerSseClient(res) { sseClients.push(res); }
export function unregisterSseClient(res) { sseClients = sseClients.filter(c => c !== res); }
export function broadcastSseEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(payload);
        }
        catch { /* dead client */ }
    }
}
// ─── Helpers ───────────────────────────────────────────────────────────────────
function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}
function lineAt(content, charIndex) {
    return (content.substring(0, charIndex).match(/\n/g) || []).length + 1;
}
function lineCount(text) {
    return (text.match(/\n/g) || []).length;
}
function extractTemplateLiteral(content, startAfterBacktick) {
    let depth = 0;
    let i = startAfterBacktick;
    while (i < content.length) {
        if (content[i] === '`' && depth === 0) {
            return content.substring(startAfterBacktick, i);
        }
        if (content[i] === '$' && content[i + 1] === '{') {
            depth++;
            i += 2;
            continue;
        }
        if (content[i] === '}' && depth > 0) {
            depth--;
            i++;
            continue;
        }
        if (content[i] === '\\') {
            i += 2;
            continue;
        }
        i++;
    }
    return null;
}
function pathSlug(projectRoot, filePath) {
    const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    return rel
        .replace(/^src\//, '')
        .replace(/\.(ts|tsx|js|jsx|py|md|mdc|yaml|yml|json)$/i, '')
        .replace(/\s+/g, '-');
}
// ─── Code leakage detection ────────────────────────────────────────────────────
const CODE_TOKENS = [
    'async ', 'await ', 'const ', 'let ', 'var ', 'return ', 'function ',
    'import ', 'export ', 'class ', 'interface ', 'type ',
    'if (', 'else {', 'for (', 'while (', 'switch (',
    'try {', 'catch (', 'catch {', 'finally {',
    'throw ', 'new ', 'delete ', 'typeof ', 'instanceof ',
    '=>', '});', '});', ');', '({', '})',
    'console.log', 'console.error', 'console.warn',
    'NextResponse', 'NextRequest', 'Request', 'Response',
    'Array.isArray', '.json()', '.parse(', '.stringify(',
    '.then(', '.catch(', '.finally(',
    'module.exports', 'require(',
    'def ', 'self.', 'elif ', 'except ', 'raise ',
];
function computeCodeScore(text) {
    let hits = 0;
    for (const token of CODE_TOKENS) {
        const idx = text.indexOf(token);
        if (idx !== -1)
            hits++;
        // Check for multiple occurrences
        if (idx !== -1 && text.indexOf(token, idx + token.length) !== -1)
            hits++;
    }
    const lines = text.split('\n');
    const totalLines = lines.length;
    if (totalLines === 0)
        return 0;
    // Lines that look like code (start with common code patterns)
    let codeLines = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^(const |let |var |if |else |for |while |return |import |export |async |await |try |catch |function |class |throw |switch |case |break |default:|\/\/|\/\*|\*\/|\* |} |}\)|}\);|};|\);|\(|{$|}$)/.test(trimmed)) {
            codeLines++;
        }
        if (/^[}\]);]+$/.test(trimmed))
            codeLines++;
    }
    const codeLineRatio = codeLines / totalLines;
    const tokenDensity = hits / Math.max(1, totalLines);
    return Math.round((codeLineRatio * 60) + (tokenDensity * 40));
}
// ─── Prompt scoring ────────────────────────────────────────────────────────────
const STRONG_PROMPT_PHRASES = [
    'you are a', 'you are an', 'you will', 'you must', 'you should',
    'your role', 'your task', 'your job',
    'respond with', 'respond only', 'respond in',
    'do not ', "don't ", 'never ', 'always ',
    'step by step', 'step-by-step',
    'output format', 'respond.*json', 'valid json',
    'given the following', 'based on the',
    'instructions:', 'guidelines:',
];
const MODERATE_PROMPT_WORDS = [
    'analyze', 'analyse', 'summarize', 'evaluate', 'compare',
    'generate', 'create', 'provide', 'list', 'describe', 'explain',
    'expert', 'specialist', 'professional',
    'prompt', 'context', 'query',
];
function computePromptScore(text) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const phrase of STRONG_PROMPT_PHRASES) {
        if (phrase.includes('.*')) {
            if (new RegExp(phrase).test(lower))
                score += 15;
        }
        else if (lower.includes(phrase)) {
            score += 15;
        }
    }
    for (const word of MODERATE_PROMPT_WORDS) {
        if (lower.includes(word))
            score += 5;
    }
    // Bonus: contains template variables like ${...} or {{...}}
    const templateVars = (text.match(/\$\{[^}]+\}|\{\{[^}]+\}\}/g) || []).length;
    score += Math.min(templateVars * 3, 15);
    // Cap at 100
    return Math.min(score, 100);
}
// ─── Classification engine ─────────────────────────────────────────────────────
function classify(p) {
    const promptScore = computePromptScore(p.content);
    const codeScore = computeCodeScore(p.content);
    let classification;
    let rejectionReason;
    // High code score = likely code leakage (unless strong prompt evidence)
    if (codeScore > 40 && promptScore < 30 && p.confidence !== 'high') {
        classification = 'rejected';
        rejectionReason = 'code_leakage';
    }
    else if (p.confidence === 'high') {
        classification = 'confirmed';
    }
    else if (p.confidence === 'medium') {
        if (promptScore >= 20 && codeScore < 50) {
            classification = 'confirmed';
        }
        else if (codeScore > 40) {
            classification = 'rejected';
            rejectionReason = 'code_leakage';
        }
        else {
            classification = 'candidate';
        }
    }
    else {
        // low confidence
        if (promptScore >= 40 && codeScore < 30) {
            classification = 'candidate';
        }
        else {
            classification = 'rejected';
            rejectionReason = codeScore > 30 ? 'code_leakage' : 'low_evidence';
        }
    }
    return {
        ...p,
        classification,
        prompt_score: promptScore,
        code_score: codeScore,
        rejection_reason: rejectionReason,
    };
}
// ─── Deduplication ─────────────────────────────────────────────────────────────
function deduplicatePrompts(prompts) {
    const byName = new Map();
    for (const p of prompts) {
        const existing = byName.get(p.stable_name);
        if (!existing) {
            byName.set(p.stable_name, p);
        }
        else {
            const rank = { high: 3, medium: 2, low: 1 };
            if (rank[p.confidence] > rank[existing.confidence]) {
                byName.set(p.stable_name, p);
            }
        }
    }
    return [...byName.values()];
}
// ─── Prompt-like variable/field name patterns ──────────────────────────────────
const PROMPT_VAR_SUFFIXES = /(?:prompts?|instructions?|templates?|messages?|personas?|polic(?:y|ies))$/i;
const PROMPT_VAR_NAMES = new Set([
    'prompt', 'systemprompt', 'userprompt', 'developerprompt',
    'instructions', 'systeminstructions', 'systeminstruction',
    'template', 'prompttemplate', 'baseprompt',
    'systemmessage', 'system_prompt', 'system_message',
]);
const NON_PROMPT_NAMES = /^(?:log_?message|error_?message|status_?message|debug_?message|info_?message|warn(?:ing)?_?message|success_?message|failure_?message|toast_?message|flash_?message|alert_?message|notification_?message|validation_?message|http_?message|response_?message|request_?message|socket_?message|event_?message|queue_?message|cache_?message|db_?message|sql_?message|log_?template|error_?log|status_?log|debug_?log)$/i;
function isPromptLikeVarName(name) {
    const lower = name.toLowerCase().replace(/_/g, '');
    if (PROMPT_VAR_NAMES.has(lower))
        return true;
    if (NON_PROMPT_NAMES.test(name))
        return false;
    return PROMPT_VAR_SUFFIXES.test(name);
}
const PROMPT_BUILDER_NAMES = /^(?:create|build|generate|get|make|format|compose|prepare)\w*(?:Prompt|Messages|Instructions|Template|System_?Prompt)/i;
function isPromptBuilderName(name) {
    return PROMPT_BUILDER_NAMES.test(name);
}
// ─── LLM SDK call patterns ────────────────────────────────────────────────────
const LLM_CALL_PATTERNS = [
    /openai\s*\.\s*chat\s*\.\s*completions\s*\.\s*create/,
    /openai\s*\.\s*responses\s*\.\s*create/,
    /anthropic\s*\.\s*messages\s*\.\s*create/,
    /generateText\s*\(/,
    /generateObject\s*\(/,
    /streamText\s*\(/,
    /streamObject\s*\(/,
    /generateContent\s*\(/,
    /ChatOpenAI/,
    /PromptTemplate\s*\.\s*from/,
    /ChatPromptTemplate/,
    /\.invoke\s*\(/,
    /completion\s*\(/,
];
// Generic model-call wrappers (common in any AI project)
const WRAPPER_CALL_PATTERNS = [
    /call\w*AI\s*\(/i,
    /call\w*Model\s*\(/i,
    /call\w*Platform\w*\s*\(/i,
    /send\w*Prompt\s*\(/i,
    /run\w*Model\s*\(/i,
    /query\w*Model\s*\(/i,
];
function fileHasLlmCalls(content) {
    return LLM_CALL_PATTERNS.some(rx => rx.test(content))
        || WRAPPER_CALL_PATTERNS.some(rx => rx.test(content));
}
function nearLlmCall(content, matchIndex, windowChars = 3000) {
    const start = Math.max(0, matchIndex - windowChars);
    const end = Math.min(content.length, matchIndex + windowChars);
    const window = content.substring(start, end);
    return LLM_CALL_PATTERNS.some(rx => rx.test(window))
        || WRAPPER_CALL_PATTERNS.some(rx => rx.test(window));
}
export function scanProject(projectRoot, config) {
    const db = getDb();
    const gitMeta = getGitMetadata(projectRoot);
    const includePatterns = config.scanner.include.length > 0
        ? config.scanner.include
        : ['src/**/*', 'lib/**/*', 'app/**/*', 'prompts/**/*', '*.md', '**/*.py'];
    const extraPatterns = [
        'CLAUDE.md', 'AGENTS.md',
        '.cursor/rules/**/*.mdc', '.cursorrules',
        '.gemini/**/*.md',
        '.github/copilot-instructions.md',
        'prompts/**/*.yaml', 'prompts/**/*.yml', 'prompts/**/*.json',
        '**/*.prompt.md', '**/*.prompt.yaml', '**/*.prompt.json',
        '.env', '.env.local', '.env.production',
    ];
    const allPatterns = [...new Set([...includePatterns, ...extraPatterns])];
    const files = globSync(allPatterns, {
        cwd: projectRoot,
        ignore: [
            ...config.scanner.exclude,
            '**/*.sqlite', '**/node_modules/**', '**/.git/**',
            '**/dist/**', '**/build/**', '**/.next/**',
            '**/.venv/**', '**/venv/**', '**/coverage/**',
            '**/.promptlog/**',
        ],
        nodir: true,
        absolute: true,
    });
    console.log(`Scanning ${files.length} files...`);
    const seenStableNames = new Set();
    const result = { confirmed: 0, candidates: 0, rejected: 0, filesScanned: files.length, filesWithPrompts: 0 };
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const fileSize = fs.statSync(file).size;
        if (fileSize > 512_000)
            continue;
        try {
            const content = fs.readFileSync(file, 'utf8');
            const rawPrompts = detectPromptsInFile(projectRoot, file, ext, content);
            const classified = deduplicatePrompts(rawPrompts.map(classify));
            const saved = classified.filter(p => p.classification !== 'rejected');
            if (saved.length > 0)
                result.filesWithPrompts++;
            for (const prompt of classified) {
                if (prompt.classification === 'rejected') {
                    result.rejected++;
                    continue;
                }
                seenStableNames.add(prompt.stable_name);
                savePromptDetection(projectRoot, prompt, gitMeta);
                if (prompt.classification === 'confirmed')
                    result.confirmed++;
                else
                    result.candidates++;
            }
        }
        catch (err) {
            console.warn(`Failed to scan: ${file}`, err);
        }
    }
    console.log(`\n  Confirmed: ${result.confirmed}`);
    console.log(`  Candidates: ${result.candidates}`);
    console.log(`  Rejected (code leakage / low evidence): ${result.rejected}`);
    console.log(`  Files with prompts: ${result.filesWithPrompts}\n`);
    markRemovedPrompts(seenStableNames);
    trackManualPrompts(projectRoot);
    broadcastSseEvent('scan_complete', { ...result, timestamp: new Date().toISOString() });
    return result;
}
export function scanFiles(projectRoot, config, filePaths) {
    const db = getDb();
    const gitMeta = getGitMetadata(projectRoot);
    const result = { confirmed: 0, candidates: 0, rejected: 0, filesScanned: filePaths.length, filesWithPrompts: 0 };
    const seenStableNames = new Set();
    const scannedFiles = new Set();
    for (const file of filePaths) {
        const absPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
        if (!fs.existsSync(absPath))
            continue;
        const ext = path.extname(absPath).toLowerCase();
        const fileSize = fs.statSync(absPath).size;
        if (fileSize > 512_000)
            continue;
        try {
            const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
            const content = fs.readFileSync(absPath, 'utf8');
            const rawPrompts = detectPromptsInFile(projectRoot, absPath, ext, content);
            const classified = deduplicatePrompts(rawPrompts.map(classify));
            scannedFiles.add(relPath);
            const saved = classified.filter(p => p.classification !== 'rejected');
            if (saved.length > 0)
                result.filesWithPrompts++;
            for (const prompt of classified) {
                if (prompt.classification === 'rejected') {
                    result.rejected++;
                    continue;
                }
                seenStableNames.add(prompt.stable_name);
                savePromptDetection(projectRoot, prompt, gitMeta);
                if (prompt.classification === 'confirmed')
                    result.confirmed++;
                else
                    result.candidates++;
            }
        }
        catch (err) {
            console.warn(`Failed to scan: ${absPath}`, err);
        }
    }
    markRemovedPromptsInFiles(scannedFiles, seenStableNames);
    trackManualPrompts(projectRoot);
    return result;
}
function detectPromptsInFile(projectRoot, filePath, ext, content) {
    const slug = pathSlug(projectRoot, filePath);
    const fileLower = filePath.replace(/\\/g, '/').toLowerCase();
    const lines = content.split('\n');
    const baseName = path.basename(filePath, ext);
    const instructionPrompts = detectInstructionFiles(slug, baseName, fileLower, ext, content, filePath, lines);
    if (instructionPrompts.length > 0)
        return instructionPrompts;
    if (baseName === '.env' || ext === '.env' || fileLower.endsWith('.env') || fileLower.endsWith('.env.local')) {
        return detectEnvPrompts(slug, content, filePath);
    }
    if (['.yaml', '.yml'].includes(ext))
        return detectYamlPrompts(slug, baseName, content, filePath);
    if (ext === '.json')
        return detectJsonPrompts(slug, baseName, content, filePath, lines);
    if (ext === '.py')
        return detectPythonPrompts(slug, baseName, content, filePath);
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        return detectJsTsPrompts(slug, baseName, ext, content, filePath);
    }
    if (['.md'].includes(ext) && content.length > 100) {
        return detectMarkdownPrompts(slug, baseName, fileLower, content, filePath, lines);
    }
    return [];
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 1: Instruction files
// ═══════════════════════════════════════════════════════════════════════════════
function detectInstructionFiles(slug, baseName, fileLower, ext, content, filePath, lines) {
    const isKnown = ['claude', 'agents', 'gemini', 'codex'].includes(baseName.toLowerCase()) ||
        fileLower.includes('.cursor/rules/') ||
        fileLower.includes('.cursorrules') ||
        fileLower.includes('.gemini/') ||
        fileLower.includes('copilot-instructions') ||
        fileLower.endsWith('.mdc');
    if (['.md', '.mdc'].includes(ext) && isKnown) {
        return [{
                id: `${slug}::instruction`,
                stable_name: `${slug}::instruction`,
                display_name: baseName,
                prompt_type: 'instruction_file',
                content,
                file_path: filePath,
                start_line: 1,
                end_line: lines.length,
                language: 'markdown',
                confidence: 'high',
                detection_method: 'instruction_file',
                evidence: 'known_instruction_filename',
            }];
    }
    return [];
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 1b: .env files
// ═══════════════════════════════════════════════════════════════════════════════
function detectEnvPrompts(slug, content, filePath) {
    const prompts = [];
    const envRx = /^(\w*(?:PROMPT|INSTRUCTION|SYSTEM_MESSAGE|TEMPLATE)\w*)\s*=\s*["']?([\s\S]*?)["']?\s*$/gim;
    let m;
    while ((m = envRx.exec(content)) !== null) {
        const varName = m[1];
        const val = m[2].trim().replace(/\\n/g, '\n');
        if (val.length < 20)
            continue;
        const sl = lineAt(content, m.index);
        prompts.push({
            id: `${slug}::${varName}`, stable_name: `${slug}::${varName}`,
            display_name: `${slug} (${varName})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl,
            language: 'env', confidence: 'high',
            detection_method: 'env_variable',
            evidence: `env_var:${varName}`,
            symbol_name: varName,
        });
    }
    return prompts;
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2: YAML / JSON
// ═══════════════════════════════════════════════════════════════════════════════
function detectYamlPrompts(slug, baseName, content, filePath) {
    const prompts = [];
    const rx = /^(?:system|instructions?|prompt|content|template|developer|messages):\s*[|>]?\s*(.+)/gim;
    let match;
    while ((match = rx.exec(content)) !== null) {
        const val = match[1].trim().replace(/^['"]|['"]$/g, '');
        if (val.length < 20)
            continue;
        const sl = lineAt(content, match.index);
        const key = match[0].split(':')[0].trim().toLowerCase();
        prompts.push({
            id: `${slug}::${key}_${sl}`,
            stable_name: `${slug}::${key}_${sl}`,
            display_name: `${baseName} (YAML ${key}, L${sl})`,
            prompt_type: 'system_prompt',
            content: val,
            file_path: filePath,
            start_line: sl, end_line: sl,
            language: 'yaml',
            confidence: 'high',
            detection_method: 'yaml_key',
            evidence: `yaml_field:${key}`,
        });
    }
    return prompts;
}
function detectJsonPrompts(slug, baseName, content, filePath, lines) {
    const prompts = [];
    const keys = ['system', 'instructions', 'prompt', 'content', 'systemPrompt', 'template', 'developer', 'promptTemplate', 'messages'];
    try {
        const parsed = JSON.parse(content);
        for (const key of keys) {
            if (typeof parsed[key] === 'string' && parsed[key].length > 20) {
                prompts.push({
                    id: `${slug}::${key}`, stable_name: `${slug}::${key}`,
                    display_name: `${baseName} (${key})`,
                    prompt_type: 'system_prompt', content: parsed[key],
                    file_path: filePath, start_line: 1, end_line: lines.length,
                    language: 'json', confidence: 'high',
                    detection_method: 'json_key', evidence: `json_field:${key}`,
                });
            }
            if (Array.isArray(parsed[key])) {
                for (let i = 0; i < parsed[key].length; i++) {
                    const msg = parsed[key][i];
                    if (msg && typeof msg === 'object' && typeof msg.content === 'string' && msg.content.length > 20) {
                        const role = msg.role || 'unknown';
                        prompts.push({
                            id: `${slug}::${key}[${i}].${role}`, stable_name: `${slug}::${key}[${i}].${role}`,
                            display_name: `${baseName} (${key}[${i}] ${role})`,
                            prompt_type: role === 'system' ? 'system_prompt' : 'prompt_template',
                            content: msg.content,
                            file_path: filePath, start_line: 1, end_line: lines.length,
                            language: 'json', confidence: 'high',
                            detection_method: 'json_messages_array', evidence: `json_messages[${i}].${role}`,
                        });
                    }
                }
            }
        }
    }
    catch { /* not valid JSON */ }
    return prompts;
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 3: Python
// ═══════════════════════════════════════════════════════════════════════════════
function detectPythonPrompts(slug, baseName, content, filePath) {
    const prompts = [];
    const pyVarRx = /(\w+)\s*=\s*(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|"([^"\n]{20,})"|'([^'\n]{20,})')/g;
    let m;
    while ((m = pyVarRx.exec(content)) !== null) {
        const varName = m[1];
        const val = (m[2] || m[3] || m[4] || m[5] || '').trim();
        if (val.length < 20)
            continue;
        const isKnown = isPromptLikeVarName(varName) || /^(SYSTEM_PROMPT|USER_PROMPT|PROMPT|INSTRUCTIONS)$/i.test(varName);
        if (!isKnown && val.length < 100)
            continue;
        if (!isKnown && !nearLlmCall(content, m.index))
            continue;
        const sl = lineAt(content, m.index);
        const pySn = isKnown ? `${slug}::${varName}` : `${slug}::${varName}_${sl}`;
        prompts.push({
            id: pySn, stable_name: pySn,
            display_name: `${baseName} (${varName}, L${sl})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
            language: 'python',
            confidence: isKnown ? 'high' : 'medium',
            detection_method: isKnown ? 'python_prompt_var' : 'python_template_near_llm',
            evidence: isKnown ? `var_name:${varName}` : `near_llm_call+var:${varName}`,
            symbol_name: varName,
        });
    }
    const pyMsgRx = /\(\s*["']system["']\s*,\s*(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|"([^"]+)"|'([^']+)')\s*\)/g;
    while ((m = pyMsgRx.exec(content)) !== null) {
        const val = (m[1] || m[2] || m[3] || m[4] || '').trim();
        if (val.length < 20)
            continue;
        const sl = lineAt(content, m.index);
        prompts.push({
            id: `${slug}::system_msg_${sl}`, stable_name: `${slug}::system_msg_${sl}`,
            display_name: `${baseName} (system msg, L${sl})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl,
            language: 'python', confidence: 'high',
            detection_method: 'python_system_message_tuple',
            evidence: 'role:system in message tuple',
        });
    }
    const pyFnRx = /def\s+(\w+)\s*\([^)]*\)\s*(?:->.*?)?\s*:\s*\n([\s\S]*?)(?=\ndef\s|\nclass\s|$)/g;
    while ((m = pyFnRx.exec(content)) !== null) {
        const fnName = m[1];
        if (!isPromptBuilderName(fnName))
            continue;
        const fnBody = m[2];
        const returnRx = /return\s+(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)''')/;
        const rm = returnRx.exec(fnBody);
        if (rm) {
            const val = (rm[1] || rm[2] || '').trim();
            if (val.length < 30)
                continue;
            const sl = lineAt(content, m.index);
            prompts.push({
                id: `${slug}::${fnName}`, stable_name: `${slug}::${fnName}`,
                display_name: `${baseName} (${fnName})`,
                prompt_type: 'dynamic_builder', content: val,
                file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
                language: 'python', confidence: 'high',
                detection_method: 'python_prompt_builder',
                evidence: `builder_function:${fnName}`,
                function_name: fnName,
            });
        }
    }
    return prompts;
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 4: JS/TS
// ═══════════════════════════════════════════════════════════════════════════════
function detectJsTsPrompts(slug, baseName, ext, content, filePath) {
    const prompts = [];
    const lang = ext.substring(1);
    const hasLlmCalls = fileHasLlmCalls(content);
    detectRoleContentObjects(prompts, slug, lang, content, filePath);
    detectFieldAssignments(prompts, slug, lang, content, filePath);
    detectPromptVariables(prompts, slug, lang, content, filePath, hasLlmCalls);
    detectPromptRecordObjects(prompts, slug, lang, content, filePath);
    detectPromptBuilders(prompts, slug, lang, content, filePath);
    detectVercelAiSdk(prompts, slug, lang, content, filePath);
    return prompts;
}
// ── 4a: role/content objects ─────────────────────────────────────────────────
function detectRoleContentObjects(prompts, slug, lang, content, filePath) {
    const roleRx = /role\s*:\s*['"]system['"]/g;
    let m;
    while ((m = roleRx.exec(content)) !== null) {
        const searchStart = m.index;
        const after = content.substring(searchStart, searchStart + 2000);
        // Stop at next role: to avoid crossing object boundaries
        const nextRole = after.indexOf('role:', 10);
        const searchWindow = nextRole > 0 ? after.substring(0, nextRole) : after;
        const contentMatch = searchWindow.match(/content\s*:\s*`([\s\S]*?)`/) ||
            searchWindow.match(/content\s*:\s*'((?:[^'\\]|\\.)*)'/) ||
            searchWindow.match(/content\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (!contentMatch)
            continue;
        const val = contentMatch[1].trim();
        if (val.length < 10)
            continue;
        const sl = lineAt(content, searchStart);
        const sn = `${slug}::system_${sl}`;
        if (prompts.some(p => p.stable_name === sn))
            continue;
        prompts.push({
            id: sn, stable_name: sn,
            display_name: `${slug} (system, L${sl})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
            language: lang, confidence: 'high',
            detection_method: 'role_content_object',
            evidence: 'role:system + content field',
        });
    }
}
// ── 4b: field assignments ────────────────────────────────────────────────────
function detectFieldAssignments(prompts, slug, lang, content, filePath) {
    const fieldRx = /(?:^|[,{(\n])\s*(system|instructions|systemPrompt|system_prompt|systemMessage|system_message)\s*[:=]\s*([`"'])([\s\S]*?)\2/gm;
    let m;
    while ((m = fieldRx.exec(content)) !== null) {
        const fieldName = m[1];
        const val = m[3].trim();
        if (val.length < 20)
            continue;
        const sl = lineAt(content, m.index);
        const sn = `${slug}::${fieldName}_${sl}`;
        if (prompts.some(p => p.stable_name === sn))
            continue;
        prompts.push({
            id: sn, stable_name: sn,
            display_name: `${slug} (${fieldName}, L${sl})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
            language: lang, confidence: 'high',
            detection_method: 'field_assignment',
            evidence: `field:${fieldName}`,
            symbol_name: fieldName,
        });
    }
}
// ── 4c: prompt variable declarations ─────────────────────────────────────────
function detectPromptVariables(prompts, slug, lang, content, filePath, hasLlmCalls) {
    const varRx = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*`/g;
    let m;
    while ((m = varRx.exec(content)) !== null) {
        const varName = m[1];
        const backtickStart = m.index + m[0].length;
        const extracted = extractTemplateLiteral(content, backtickStart);
        if (!extracted)
            continue;
        const val = extracted.trim();
        if (val.length < 30)
            continue;
        const knownName = isPromptLikeVarName(varName);
        const sl = lineAt(content, m.index);
        if (knownName) {
            const sn = `${slug}::${varName}`;
            if (prompts.some(p => p.stable_name === sn))
                continue;
            prompts.push({
                id: sn, stable_name: sn,
                display_name: `${slug} (${varName}, L${sl})`,
                prompt_type: 'prompt_template', content: val,
                file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
                language: lang, confidence: 'high',
                detection_method: 'prompt_variable',
                evidence: `var_name:${varName}`,
                symbol_name: varName,
            });
            continue;
        }
        // Medium: near LLM call + prompt-like content + NOT code
        if (hasLlmCalls && val.length >= 80 && nearLlmCall(content, m.index)) {
            const sn = `${slug}::${varName}_${sl}`;
            if (prompts.some(p => p.stable_name === sn))
                continue;
            prompts.push({
                id: sn, stable_name: sn,
                display_name: `${slug} (${varName}, L${sl})`,
                prompt_type: 'prompt_template', content: val,
                file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
                language: lang, confidence: 'medium',
                detection_method: 'variable_near_llm_call',
                evidence: `var:${varName}+near_llm_call`,
                symbol_name: varName,
            });
        }
    }
    // String assignments with prompt-like names (double-quoted and single-quoted)
    const strPatterns = [
        /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*"((?:[^"\\]|\\.)*)"/g,
        /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*'((?:[^'\\]|\\.)*)'/g,
    ];
    for (const strRx of strPatterns) {
        while ((m = strRx.exec(content)) !== null) {
            const varName = m[1];
            const val = m[2].trim();
            if (val.length < 30 || !isPromptLikeVarName(varName))
                continue;
            const sl = lineAt(content, m.index);
            const sn = `${slug}::${varName}`;
            if (prompts.some(p => p.stable_name === sn))
                continue;
            prompts.push({
                id: sn, stable_name: sn,
                display_name: `${slug} (${varName}, L${sl})`,
                prompt_type: 'prompt_template', content: val,
                file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
                language: lang, confidence: 'high',
                detection_method: 'prompt_variable_string',
                evidence: `var_name:${varName}`,
                symbol_name: varName,
            });
        }
    }
}
// ── 4d: prompt-like record/object literals ──────────────────────────────────
function detectPromptRecordObjects(prompts, slug, lang, content, filePath) {
    const recordRx = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]*)?=\s*\{/g;
    let m;
    while ((m = recordRx.exec(content)) !== null) {
        const varName = m[1];
        if (!isPromptLikeVarName(varName))
            continue;
        const objStart = m.index + m[0].length - 1;
        let depth = 1;
        let objEnd = objStart + 1;
        for (let i = objStart + 1; i < content.length && depth > 0; i++) {
            if (content[i] === '{')
                depth++;
            else if (content[i] === '}')
                depth--;
            if (depth === 0)
                objEnd = i + 1;
        }
        const objBody = content.substring(objStart, objEnd);
        const valRx = /(?:(\w+)|(\d+)|['"]([^'"]+)['"])\s*:\s*`/g;
        let vm;
        while ((vm = valRx.exec(objBody)) !== null) {
            const key = vm[1] || vm[2] || vm[3];
            const extracted = extractTemplateLiteral(objBody, vm.index + vm[0].length);
            if (!extracted)
                continue;
            valRx.lastIndex = vm.index + vm[0].length + extracted.length + 1;
            const val = extracted.trim();
            if (val.length < 30)
                continue;
            const sl = lineAt(content, m.index + vm.index);
            const sn = `${slug}::${varName}_${key}`;
            if (prompts.some(p => p.stable_name === sn))
                continue;
            prompts.push({
                id: sn, stable_name: sn,
                display_name: `${slug} (${varName}[${key}], L${sl})`,
                prompt_type: 'prompt_template', content: val,
                file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
                language: lang, confidence: 'high',
                detection_method: 'prompt_record_object',
                evidence: `record_var:${varName}, key:${key}`,
                symbol_name: varName,
            });
        }
    }
}
// ── 4e: prompt builder functions ─────────────────────────────────────────────
function detectPromptBuilders(prompts, slug, lang, content, filePath) {
    // Match function declarations and exported functions with prompt-like names
    const fnDeclRx = /(?:export\s+)?function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*\w+)?\s*\{/g;
    let m;
    while ((m = fnDeclRx.exec(content)) !== null) {
        const fnName = m[1];
        if (!isPromptBuilderName(fnName))
            continue;
        // Extract function body by counting braces
        const bodyStart = m.index + m[0].length;
        let depth = 1;
        let bodyEnd = bodyStart;
        for (let i = bodyStart; i < content.length && depth > 0; i++) {
            if (content[i] === '{')
                depth++;
            else if (content[i] === '}')
                depth--;
            if (depth === 0)
                bodyEnd = i;
        }
        const fnBody = content.substring(bodyStart, bodyEnd);
        // Find return template literal — get the FIRST return with backtick
        const returnMatch = /return\s*`/.exec(fnBody);
        if (!returnMatch)
            continue;
        const extracted = extractTemplateLiteral(fnBody, returnMatch.index + returnMatch[0].length);
        if (!extracted)
            continue;
        const val = extracted.trim();
        if (val.length < 30)
            continue;
        const sl = lineAt(content, m.index);
        const sn = `${slug}::${fnName}`;
        if (prompts.some(p => p.stable_name === sn))
            continue;
        prompts.push({
            id: sn, stable_name: sn,
            display_name: `${slug} (${fnName})`,
            prompt_type: 'dynamic_builder', content: val,
            file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
            language: lang, confidence: 'high',
            detection_method: 'prompt_builder_function',
            evidence: `builder:${fnName}`,
            function_name: fnName,
        });
    }
}
// ── 4f: Vercel AI SDK ────────────────────────────────────────────────────────
function detectVercelAiSdk(prompts, slug, lang, content, filePath) {
    const rx = /(?:generateText|streamText|generateObject|streamObject)\s*\(\s*\{[\s\S]*?(?:system|prompt)\s*:\s*([`"'])([\s\S]*?)\1/g;
    let m;
    while ((m = rx.exec(content)) !== null) {
        const val = m[2].trim();
        if (val.length < 20)
            continue;
        const sl = lineAt(content, m.index);
        const fnName = content.substring(m.index, m.index + 30).match(/(\w+)\s*\(/)?.[1] || 'generate';
        const sn = `${slug}::${fnName}_${sl}`;
        if (prompts.some(p => p.stable_name === sn))
            continue;
        prompts.push({
            id: sn, stable_name: sn,
            display_name: `${slug} (${fnName}, L${sl})`,
            prompt_type: 'system_prompt', content: val,
            file_path: filePath, start_line: sl, end_line: sl + lineCount(val),
            language: lang, confidence: 'high',
            detection_method: 'vercel_ai_sdk',
            evidence: `sdk_call:${fnName}`,
        });
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// Layer 5: Markdown prompt files
// ═══════════════════════════════════════════════════════════════════════════════
function detectMarkdownPrompts(slug, baseName, fileLower, content, filePath, lines) {
    const isPromptDir = fileLower.includes('/prompts/') || fileLower.includes('/prompt/');
    const isPromptNamed = baseName.toLowerCase().includes('prompt') || baseName.toLowerCase().includes('instruction');
    if (!isPromptDir && !isPromptNamed)
        return [];
    return [{
            id: `${slug}::prompt_doc`, stable_name: `${slug}::prompt_doc`,
            display_name: `${baseName} (prompt doc)`,
            prompt_type: 'prompt_template', content,
            file_path: filePath, start_line: 1, end_line: lines.length,
            language: 'markdown', confidence: 'medium',
            detection_method: 'markdown_prompt_file',
            evidence: isPromptDir ? 'in_prompts_directory' : `filename_contains_prompt`,
        }];
}
// ═══════════════════════════════════════════════════════════════════════════════
// Database persistence
// ═══════════════════════════════════════════════════════════════════════════════
function markRemovedPrompts(seenStableNames) {
    const db = getDb();
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get();
    if (!projectInfo)
        return;
    const activePrompts = db.prepare("SELECT id, stable_name, prompt_type FROM prompts WHERE project_id = ? AND status IN ('active', 'candidate')").all(projectInfo.id);
    for (const prompt of activePrompts) {
        if (prompt.prompt_type === 'manual')
            continue;
        if (!seenStableNames.has(prompt.stable_name)) {
            db.prepare("UPDATE prompts SET status = 'removed_from_codebase', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prompt.id);
            db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), projectInfo.id, prompt.id, 'prompt_removed_from_codebase', 'scanner');
            console.log(`  [REM] ${prompt.stable_name}`);
        }
    }
}
function markRemovedPromptsInFiles(scannedFiles, seenStableNames) {
    if (scannedFiles.size === 0)
        return;
    const db = getDb();
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get();
    if (!projectInfo)
        return;
    const placeholders = [...scannedFiles].map(() => '?').join(', ');
    const prompts = db.prepare(`
    SELECT p.id, p.stable_name, p.prompt_type
    FROM prompts p
    JOIN prompt_versions v ON v.id = p.current_version_id
    WHERE p.project_id = ?
      AND p.status IN ('active', 'candidate')
      AND v.source_file IN (${placeholders})
  `).all(projectInfo.id, ...scannedFiles);
    for (const prompt of prompts) {
        if (prompt.prompt_type === 'manual' || seenStableNames.has(prompt.stable_name))
            continue;
        db.prepare("UPDATE prompts SET status = 'removed_from_codebase', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prompt.id);
        db.prepare(`
      INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), projectInfo.id, prompt.id, 'prompt_removed_from_codebase', 'scanner');
        console.log(`  [REM] ${prompt.stable_name}`);
    }
}
function trackManualPrompts(projectRoot) {
    const db = getDb();
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get();
    if (!projectInfo)
        return;
    const manualPrompts = db.prepare("SELECT p.id, p.stable_name, p.current_version_id FROM prompts p WHERE p.project_id = ? AND p.prompt_type = 'manual' AND p.status = 'active'").all(projectInfo.id);
    const gitMeta = getGitMetadata(projectRoot);
    for (const prompt of manualPrompts) {
        if (!prompt.current_version_id)
            continue;
        const version = db.prepare('SELECT source_file, start_line, end_line, content_hash FROM prompt_versions WHERE id = ?').get(prompt.current_version_id);
        if (!version)
            continue;
        const absPath = path.join(projectRoot, version.source_file);
        if (!fs.existsSync(absPath))
            continue;
        const fileContent = fs.readFileSync(absPath, 'utf8');
        const lines = fileContent.split('\n');
        const lineSpan = version.end_line - version.start_line + 1;
        const prevContent = db.prepare('SELECT raw_content FROM prompt_versions WHERE id = ?').get(prompt.current_version_id);
        const previousRaw = prevContent?.raw_content || '';
        let currentContent;
        let actualStart = version.start_line;
        let actualEnd = version.end_line;
        const origStart = Math.min(version.start_line - 1, lines.length - 1);
        const origEnd = Math.min(version.end_line, lines.length);
        const origSlice = lines.slice(origStart, origEnd).join('\n').trim();
        if (hashContent(origSlice) === version.content_hash) {
            continue;
        }
        if (origSlice.length > 0 && previousRaw && origSlice !== previousRaw) {
            currentContent = origSlice;
            actualStart = version.start_line;
            actualEnd = version.end_line;
        }
        else {
            let found = false;
            for (let s = 0; s <= lines.length - lineSpan; s++) {
                const slice = lines.slice(s, s + lineSpan).join('\n').trim();
                if (hashContent(slice) === version.content_hash) {
                    found = true;
                    break;
                }
            }
            if (found)
                continue;
            currentContent = origSlice;
        }
        const currentHash = hashContent(currentContent);
        if (currentHash === version.content_hash)
            continue;
        {
            const versionNum = db.prepare('SELECT MAX(version_number) as max FROM prompt_versions WHERE prompt_id = ?').get(prompt.id).max + 1;
            const ext = path.extname(absPath).replace('.', '') || 'txt';
            const versionId = uuidv4();
            db.prepare(`
        INSERT INTO prompt_versions
          (id, prompt_id, version_number, raw_content, normalized_content, content_hash,
           source_file, start_line, end_line, source_language, source_kind,
           git_branch, git_commit, git_author, git_dirty_state, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(versionId, prompt.id, versionNum, currentContent, currentContent, currentHash, version.source_file, actualStart, actualEnd, ext, 'manual', gitMeta?.branch ?? null, gitMeta?.commit ?? null, gitMeta?.author ?? null, gitMeta?.isDirty ? 1 : 0, 'active', 'scanner');
            db.prepare('UPDATE prompts SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(versionId, prompt.id);
            db.prepare(`
        INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), projectInfo.id, prompt.id, versionId, 'prompt_changed', 'scanner');
            console.log(`  [CHG] ${prompt.stable_name} → v${versionNum} (manual)`);
        }
    }
}
function savePromptDetection(projectRoot, prompt, gitMeta) {
    const db = getDb();
    const normalizedContent = prompt.content.trim().replace(/\r\n/g, '\n');
    const contentHash = hashContent(normalizedContent);
    const relPath = path.relative(projectRoot, prompt.file_path).replace(/\\/g, '/');
    const projectInfo = db.prepare('SELECT id FROM projects LIMIT 1').get();
    if (!projectInfo)
        return;
    const projectId = projectInfo.id;
    // Map classification to DB status
    const dbStatus = prompt.classification === 'confirmed' ? 'active' : 'candidate';
    let dbPrompt = db.prepare('SELECT id, current_version_id, status FROM prompts WHERE stable_name = ? AND project_id = ?').get(prompt.stable_name, projectId);
    let isNewPrompt = false;
    if (!dbPrompt) {
        isNewPrompt = true;
        const promptId = uuidv4();
        db.prepare(`
      INSERT INTO prompts (id, project_id, stable_name, display_name, prompt_type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(promptId, projectId, prompt.stable_name, prompt.display_name, prompt.prompt_type, dbStatus);
        dbPrompt = { id: promptId, current_version_id: null, status: dbStatus };
    }
    else if (dbPrompt.status === 'removed_from_codebase') {
        db.prepare("UPDATE prompts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(dbStatus, dbPrompt.id);
        db.prepare(`
      INSERT INTO prompt_events (id, project_id, prompt_id, event_type, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), projectId, dbPrompt.id, 'prompt_restored', 'scanner');
    }
    let currentVersionHash = null;
    let currentVersionNumber = 0;
    if (dbPrompt.current_version_id) {
        const v = db.prepare('SELECT version_number, content_hash FROM prompt_versions WHERE id = ?')
            .get(dbPrompt.current_version_id);
        if (v) {
            currentVersionNumber = v.version_number;
            currentVersionHash = v.content_hash;
        }
    }
    if (currentVersionHash !== contentHash) {
        const versionId = uuidv4();
        const newVersionNumber = currentVersionNumber + 1;
        db.prepare(`
      INSERT INTO prompt_versions
        (id, prompt_id, version_number, raw_content, normalized_content, content_hash,
         source_file, start_line, end_line, source_language, source_kind,
         git_branch, git_commit, git_author, git_dirty_state, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, dbPrompt.id, newVersionNumber, prompt.content, normalizedContent, contentHash, relPath, prompt.start_line, prompt.end_line, prompt.language, prompt.detection_method, gitMeta?.branch ?? null, gitMeta?.commit ?? null, gitMeta?.author ?? null, gitMeta?.isDirty ? 1 : 0, 'active', 'scanner');
        const snapshotDir = path.join(projectRoot, '.promptlog', 'snapshots', 'prompts', dbPrompt.id);
        fs.mkdirSync(snapshotDir, { recursive: true });
        const snapshotPath = path.join(snapshotDir, `v${newVersionNumber}.prompt.txt`);
        fs.writeFileSync(snapshotPath, prompt.content, 'utf8');
        const relSnapshotPath = path.relative(projectRoot, snapshotPath).replace(/\\/g, '/');
        db.prepare('UPDATE prompt_versions SET snapshot_path = ? WHERE id = ?').run(relSnapshotPath, versionId);
        db.prepare('UPDATE prompts SET current_version_id = ?, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(versionId, dbPrompt.id);
        db.prepare(`
      INSERT INTO prompt_locations (id, prompt_id, version_id, file_path, start_line, end_line, language, confidence, symbol_name, function_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), dbPrompt.id, versionId, relPath, prompt.start_line, prompt.end_line, prompt.language, prompt.confidence, prompt.symbol_name || null, prompt.function_name || null);
        const eventType = isNewPrompt ? 'prompt_detected' : 'prompt_changed';
        db.prepare(`
      INSERT INTO prompt_events (id, project_id, prompt_id, version_id, event_type, event_payload_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), projectId, dbPrompt.id, versionId, eventType, JSON.stringify({
            classification: prompt.classification,
            confidence: prompt.confidence,
            detection_method: prompt.detection_method,
            prompt_score: prompt.prompt_score,
            code_score: prompt.code_score,
            evidence: prompt.evidence,
        }), 'scanner');
        broadcastSseEvent('prompt_version_created', {
            promptId: dbPrompt.id,
            stableName: prompt.stable_name,
            displayName: prompt.display_name,
            classification: prompt.classification,
            versionNumber: newVersionNumber,
            confidence: prompt.confidence,
            timestamp: new Date().toISOString(),
        });
        const tag = prompt.classification === 'confirmed' ? 'NEW' : 'CND';
        if (isNewPrompt) {
            console.log(`  [${tag}] ${prompt.stable_name} (v${newVersionNumber}) [${prompt.confidence}]`);
        }
        else {
            console.log(`  [CHG] ${prompt.stable_name} → v${newVersionNumber}`);
        }
    }
    else {
        db.prepare('UPDATE prompts SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(dbPrompt.id);
    }
}
