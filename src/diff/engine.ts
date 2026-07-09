import * as diffLib from 'diff';
import { v4 as uuidv4 } from 'uuid';

export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
  wordsAdded: number;
  wordsRemoved: number;
  charsAdded: number;
  charsRemoved: number;
}

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface ComputedDiff {
  lineDiff: DiffPart[];
  wordDiff: DiffPart[];
  charDiff: DiffPart[];
  stats: DiffStats;
}

export function computeDiff(oldContent: string, newContent: string): ComputedDiff {
  const lineDiff = diffLib.diffLines(oldContent, newContent).map(p => ({
    value: p.value,
    added: p.added,
    removed: p.removed,
  }));

  const wordDiff = diffLib.diffWords(oldContent, newContent).map(p => ({
    value: p.value,
    added: p.added,
    removed: p.removed,
  }));

  const charDiff = diffLib.diffChars(oldContent, newContent).map(p => ({
    value: p.value,
    added: p.added,
    removed: p.removed,
  }));

  const stats: DiffStats = {
    linesAdded: lineDiff.filter(p => p.added).length,
    linesRemoved: lineDiff.filter(p => p.removed).length,
    wordsAdded: wordDiff.filter(p => p.added).reduce((sum, p) => sum + p.value.split(/\s+/).filter(Boolean).length, 0),
    wordsRemoved: wordDiff.filter(p => p.removed).reduce((sum, p) => sum + p.value.split(/\s+/).filter(Boolean).length, 0),
    charsAdded: charDiff.filter(p => p.added).reduce((sum, p) => sum + p.value.length, 0),
    charsRemoved: charDiff.filter(p => p.removed).reduce((sum, p) => sum + p.value.length, 0),
  };

  return { lineDiff, wordDiff, charDiff, stats };
}

export function getOrComputeDiff(
  db: any,
  promptId: string,
  fromVersionId: string,
  toVersionId: string,
  fromContent: string,
  toContent: string
): ComputedDiff {
  // Check cache first
  const cached = db.prepare(
    'SELECT * FROM prompt_diffs WHERE from_version_id = ? AND to_version_id = ?'
  ).get(fromVersionId, toVersionId) as any;

  if (cached) {
    return {
      lineDiff: JSON.parse(cached.line_diff_json),
      wordDiff: JSON.parse(cached.word_diff_json),
      charDiff: JSON.parse(cached.char_diff_json),
      stats: JSON.parse(cached.stats_json),
    };
  }

  // Compute fresh
  const result = computeDiff(fromContent, toContent);

  // Cache it
  try {
    db.prepare(`
      INSERT INTO prompt_diffs (id, prompt_id, from_version_id, to_version_id, line_diff_json, word_diff_json, char_diff_json, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      promptId,
      fromVersionId,
      toVersionId,
      JSON.stringify(result.lineDiff),
      JSON.stringify(result.wordDiff),
      JSON.stringify(result.charDiff),
      JSON.stringify(result.stats)
    );
  } catch {
    // Ignore caching failures, result is still valid
  }

  return result;
}
