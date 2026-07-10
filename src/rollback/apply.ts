import fs from 'fs';
import path from 'path';

export interface RollbackVersion {
  raw_content: string;
  source_file: string;
  start_line?: number | null;
  end_line?: number | null;
}

export interface RollbackApplyResult {
  sourceFile: string;
  relativeSourceFile: string;
  startLine: number;
  endLine: number;
}

interface MatchRange {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

export class RollbackApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackApplyError';
  }
}

function resolveProjectFile(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (!relativePath || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new RollbackApplyError(`Source file is outside the project root: ${relativePath}`);
  }
  return resolved;
}

function lineAt(content: string, index: number): number {
  return (content.slice(0, index).match(/\n/g) || []).length + 1;
}

function exactMatches(content: string, needle: string): MatchRange[] {
  const matches: MatchRange[] = [];
  let from = 0;
  while (from <= content.length - needle.length) {
    const start = content.indexOf(needle, from);
    if (start === -1) break;
    const end = start + needle.length;
    matches.push({
      start,
      end,
      startLine: lineAt(content, start),
      endLine: lineAt(content, end),
    });
    from = start + Math.max(needle.length, 1);
  }
  return matches;
}

function normalizeWithOffsets(content: string): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  for (let i = 0; i < content.length; i++) {
    offsets.push(i);
    if (content[i] === '\r') {
      if (content[i + 1] === '\n') i++;
      text += '\n';
    } else {
      text += content[i];
    }
  }
  offsets.push(content.length);
  return { text, offsets };
}

function findMatches(content: string, currentPrompt: string): MatchRange[] {
  const exact = exactMatches(content, currentPrompt);
  if (exact.length > 0) return exact;

  const normalizedFile = normalizeWithOffsets(content);
  const normalizedPrompt = currentPrompt.replace(/\r\n?|\n/g, '\n');
  return exactMatches(normalizedFile.text, normalizedPrompt).map(match => {
    const start = normalizedFile.offsets[match.start];
    const end = normalizedFile.offsets[match.end];
    return {
      start,
      end,
      startLine: lineAt(content, start),
      endLine: lineAt(content, end),
    };
  });
}

function chooseMatch(matches: MatchRange[], expectedLine?: number | null): MatchRange {
  if (matches.length === 0) {
    throw new RollbackApplyError('Current prompt content was not found. Re-scan before applying a rollback.');
  }
  if (matches.length === 1) return matches[0];
  if (!expectedLine) {
    throw new RollbackApplyError('Current prompt content appears multiple times and cannot be located safely.');
  }

  const ranked = matches
    .map(match => ({ match, distance: Math.abs(match.startLine - expectedLine) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked[0].distance === ranked[1].distance) {
    throw new RollbackApplyError('Current prompt content appears multiple times at equally likely locations.');
  }
  return ranked[0].match;
}

function preferredEol(content: string): '\n' | '\r\n' {
  const crlf = (content.match(/\r\n/g) || []).length;
  const allLf = (content.match(/\n/g) || []).length;
  return crlf > allLf / 2 ? '\r\n' : '\n';
}

export function safePatchFileName(stableName: string, versionNumber: number): string {
  const safeName = stableName.replace(/[^a-z0-9._-]/gi, '-');
  return `${safeName}-v${versionNumber}.patch`;
}

export function applyPromptRollback(
  projectRoot: string,
  currentVersion: RollbackVersion,
  targetVersion: RollbackVersion,
): RollbackApplyResult {
  if (!currentVersion.raw_content) {
    throw new RollbackApplyError('Current prompt version has no content to locate.');
  }

  const sourceFile = resolveProjectFile(projectRoot, currentVersion.source_file);
  if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw new RollbackApplyError(`Source file not found: ${currentVersion.source_file}`);
  }

  const fileContent = fs.readFileSync(sourceFile, 'utf8');
  const match = chooseMatch(findMatches(fileContent, currentVersion.raw_content), currentVersion.start_line);
  const eol = preferredEol(fileContent);
  const replacement = targetVersion.raw_content.replace(/\r\n?|\n/g, eol);
  const updated = fileContent.slice(0, match.start) + replacement + fileContent.slice(match.end);

  fs.writeFileSync(sourceFile, updated, 'utf8');

  return {
    sourceFile,
    relativeSourceFile: path.relative(path.resolve(projectRoot), sourceFile).replace(/\\/g, '/'),
    startLine: match.startLine,
    endLine: match.startLine + (replacement.match(/\n/g) || []).length,
  };
}
