export const schema = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    promptlog_version TEXT,
    config_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    stable_name TEXT,
    display_name TEXT,
    prompt_type TEXT,
    status TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    current_version_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    prompt_id TEXT,
    version_number INTEGER,
    raw_content TEXT,
    normalized_content TEXT,
    content_hash TEXT,
    source_file TEXT,
    start_line INTEGER,
    end_line INTEGER,
    source_language TEXT,
    source_kind TEXT,
    git_branch TEXT,
    git_commit TEXT,
    git_author TEXT,
    git_dirty_state BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    status TEXT,
    snapshot_path TEXT
  );

  CREATE TABLE IF NOT EXISTS prompt_locations (
    id TEXT PRIMARY KEY,
    prompt_id TEXT,
    version_id TEXT,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    start_column INTEGER,
    end_column INTEGER,
    language TEXT,
    symbol_name TEXT,
    function_name TEXT,
    class_name TEXT,
    framework TEXT,
    confidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_diffs (
    id TEXT PRIMARY KEY,
    prompt_id TEXT,
    from_version_id TEXT,
    to_version_id TEXT,
    line_diff_json TEXT,
    word_diff_json TEXT,
    char_diff_json TEXT,
    stats_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_notes (
    id TEXT PRIMARY KEY,
    prompt_id TEXT,
    version_id TEXT,
    note_type TEXT,
    title TEXT,
    body TEXT,
    severity TEXT,
    confidence TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_events (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    prompt_id TEXT,
    version_id TEXT,
    event_type TEXT,
    event_payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS prompt_ai_suggestions (
    id TEXT PRIMARY KEY,
    prompt_id TEXT,
    version_id TEXT,
    source TEXT,
    model_name TEXT,
    suggestion_type TEXT,
    suggestion_json TEXT,
    accepted_by_user BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    key TEXT UNIQUE,
    value_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;
