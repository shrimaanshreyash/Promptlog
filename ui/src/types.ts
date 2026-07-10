export interface Project {
  id?: string;
  name: string;
}

export interface Prompt {
  id: string;
  project_id: string;
  stable_name: string;
  display_name: string;
  prompt_type: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id?: string;
  version_number: number;
  raw_content: string;
  source_file: string;
  git_branch: string | null;
  git_commit: string | null;
  git_author: string | null;
  git_dirty_state: number | null;
  created_at: string;
  start_line: number;
  end_line: number;
}

export interface DiffChunk {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffResponse {
  message?: string;
  from?: { versionNumber: number };
  to?: { versionNumber: number };
  diff?: {
    stats: { wordsAdded: number; wordsRemoved: number };
    wordDiff: DiffChunk[];
  };
  error?: string;
}

export interface ApiResult {
  success?: boolean;
  error?: string;
  message?: string;
  content?: string;
  patchPath?: string;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
