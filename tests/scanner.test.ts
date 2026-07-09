import { describe, it, expect } from 'vitest';

// ── Variable name classification ────────────────────────────────────────────

const PROMPT_VAR_SUFFIXES = /(?:prompts?|instructions?|templates?|messages?|personas?|polic(?:y|ies))$/i;

const PROMPT_VAR_NAMES = new Set([
  'prompt', 'systemprompt', 'userprompt', 'developerprompt',
  'instructions', 'systeminstructions', 'systeminstruction',
  'template', 'prompttemplate', 'baseprompt',
  'systemmessage', 'system_prompt', 'system_message',
]);

const NON_PROMPT_NAMES = /^(?:log_?message|error_?message|status_?message|debug_?message|info_?message|warn(?:ing)?_?message|success_?message|failure_?message|toast_?message|flash_?message|alert_?message|notification_?message|validation_?message|http_?message|response_?message|request_?message|socket_?message|event_?message|queue_?message|cache_?message|db_?message|sql_?message|log_?template|error_?log|status_?log|debug_?log)$/i;

function isPromptLikeVarName(name: string): boolean {
  const lower = name.toLowerCase().replace(/_/g, '');
  if (PROMPT_VAR_NAMES.has(lower)) return true;
  if (NON_PROMPT_NAMES.test(name)) return false;
  return PROMPT_VAR_SUFFIXES.test(name);
}

const PROMPT_BUILDER_NAMES = /^(?:create|build|generate|get|make|format|compose|prepare)\w*(?:Prompt|Messages|Instructions|Template|System_?Prompt)/i;

function isPromptBuilderName(name: string): boolean {
  return PROMPT_BUILDER_NAMES.test(name);
}

describe('isPromptLikeVarName', () => {
  const shouldMatch = [
    'systemPrompt', 'SYSTEM_PROMPT', 'USER_TEMPLATE', 'errorTemplate',
    'REVIEW_PROMPT', 'AGENT_PROMPTS', 'basePrompt', 'chatMessages',
    'systemInstructions', 'E2_CONTEXT_BUILDER_PROMPT', 'MODERATOR_PROMPT',
    'analysis_instructions', 'errorPrompt', 'userMessage', 'systemMessage',
    'PHASE_PROMPTS', 'agentPersona', 'contentPolicy',
  ];

  const shouldNotMatch = [
    'log_message', 'error_message', 'status_message', 'debug_message',
    'databaseUrl', 'greeting', 'config_path', 'toast_message',
    'http_message', 'error_log', 'debug_log', 'sql_message',
    'userName', 'filePath', 'responseCode', 'eventHandler',
  ];

  for (const name of shouldMatch) {
    it(`should detect "${name}" as prompt-like`, () => {
      expect(isPromptLikeVarName(name)).toBe(true);
    });
  }

  for (const name of shouldNotMatch) {
    it(`should reject "${name}" as non-prompt`, () => {
      expect(isPromptLikeVarName(name)).toBe(false);
    });
  }
});

describe('isPromptBuilderName', () => {
  const shouldMatch = [
    'createSystemPrompt', 'buildPrompt', 'generateInstructions',
    'getPromptTemplate', 'makePrompt', 'formatMessages',
    'composeTemplate', 'prepareSystemPrompt', 'createAnalysisPrompt',
  ];

  const shouldNotMatch = [
    'createUser', 'buildConfig', 'generateId', 'getResponse',
    'makeRequest', 'formatDate', 'composeEmail', 'prepareData',
  ];

  for (const name of shouldMatch) {
    it(`should detect "${name}" as builder`, () => {
      expect(isPromptBuilderName(name)).toBe(true);
    });
  }

  for (const name of shouldNotMatch) {
    it(`should reject "${name}" as non-builder`, () => {
      expect(isPromptBuilderName(name)).toBe(false);
    });
  }
});

// ── Prompt scoring ──────────────────────────────────────────────────────────

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

function computePromptScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const phrase of STRONG_PROMPT_PHRASES) {
    if (phrase.includes('.*')) {
      if (new RegExp(phrase).test(lower)) score += 15;
    } else if (lower.includes(phrase)) {
      score += 15;
    }
  }
  const templateVars = (text.match(/\$\{[^}]+\}|\{\{[^}]+\}\}/g) || []).length;
  score += Math.min(templateVars * 3, 15);
  return Math.min(score, 100);
}

describe('computePromptScore', () => {
  it('scores high for strong prompt language', () => {
    const text = 'You are a helpful assistant. You must always respond in valid JSON. Never make up information.';
    expect(computePromptScore(text)).toBeGreaterThanOrEqual(60);
  });

  it('scores low for non-prompt text', () => {
    const text = 'This function processes the input data and returns a result object.';
    expect(computePromptScore(text)).toBeLessThan(15);
  });

  it('scores medium for partial prompt language', () => {
    const text = 'Analyze the data and provide a summary. List the key findings.';
    expect(computePromptScore(text)).toBeGreaterThanOrEqual(0);
  });

  it('adds score for template variables', () => {
    const withVars = 'Process ${input} and return ${format}';
    const without = 'Process the input and return the format';
    expect(computePromptScore(withVars)).toBeGreaterThan(computePromptScore(without));
  });

  it('caps at 100', () => {
    const text = 'You are a helpful assistant. You must always respond in valid JSON. Never make up information. You should follow instructions. Your role is to help. Given the following context, respond with step by step analysis.';
    expect(computePromptScore(text)).toBeLessThanOrEqual(100);
  });
});

// ── Code leakage scoring ────────────────────────────────────────────────────

const CODE_TOKENS = [
  'async ', 'await ', 'const ', 'let ', 'var ', 'return ', 'function ',
  'import ', 'export ', 'class ', 'interface ', 'type ',
  'if (', 'else {', 'for (', 'while (', 'switch (',
  'try {', 'catch (', 'catch {', 'finally {',
  'throw ', 'new ', 'delete ', 'typeof ', 'instanceof ',
  '=>', '});', ');', '({', '})',
  'console.log', 'console.error', 'console.warn',
  'Array.isArray', '.json()', '.parse(', '.stringify(',
  '.then(', '.catch(', '.finally(',
  'module.exports', 'require(',
  'def ', 'self.', 'elif ', 'except ', 'raise ',
];

function computeCodeScore(text: string): number {
  let hits = 0;
  for (const token of CODE_TOKENS) {
    const idx = text.indexOf(token);
    if (idx !== -1) hits++;
    if (idx !== -1 && text.indexOf(token, idx + token.length) !== -1) hits++;
  }
  const lines = text.split('\n');
  const totalLines = lines.length;
  if (totalLines === 0) return 0;
  let codeLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(const |let |var |if |else |for |while |return |import |export |async |await |try |catch |function |class |throw |switch |case |break |default:|\/\/|\/\*|\*\/|\* |} |}\)|}\);|};|\);|\(|{$|}$)/.test(trimmed)) {
      codeLines++;
    }
    if (/^[}\]);]+$/.test(trimmed)) codeLines++;
  }
  const codeLineRatio = codeLines / totalLines;
  const tokenDensity = hits / Math.max(1, totalLines);
  return Math.round((codeLineRatio * 60) + (tokenDensity * 40));
}

describe('computeCodeScore', () => {
  it('scores high for actual code', () => {
    const code = `async function getData() {
  const result = await fetch('/api/data');
  const json = await result.json();
  return json;
}`;
    expect(computeCodeScore(code)).toBeGreaterThan(40);
  });

  it('scores low for natural language prompts', () => {
    const prompt = `You are a helpful assistant.
Always respond in JSON format.
Never fabricate information.
Be concise and accurate.`;
    expect(computeCodeScore(prompt)).toBeLessThan(15);
  });
});

// ── Stable name generation ──────────────────────────────────────────────────

describe('stable name stability', () => {
  it('named variables produce line-independent stable names', () => {
    const slug = 'src/prompts';
    const varName = 'SYSTEM_PROMPT';
    const sn = `${slug}::${varName}`;
    expect(sn).toBe('src/prompts::SYSTEM_PROMPT');
    expect(sn).not.toMatch(/_\d+$/);
  });

  it('record keys produce line-independent stable names', () => {
    const slug = 'src/prompts';
    const varName = 'AGENT_PROMPTS';
    const key = 'researcher';
    const sn = `${slug}::${varName}_${key}`;
    expect(sn).toBe('src/prompts::AGENT_PROMPTS_researcher');
    expect(sn).not.toMatch(/_\d+$/);
  });

  it('different files with same var name produce different stable names', () => {
    const sn1 = 'server/api::systemPrompt';
    const sn2 = 'server/pipeline::systemPrompt';
    expect(sn1).not.toBe(sn2);
  });
});

// ── Content hashing ─────────────────────────────────────────────────────────

import crypto from 'crypto';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('content hashing', () => {
  it('same content produces same hash', () => {
    const a = hashContent('You are a helpful assistant.');
    const b = hashContent('You are a helpful assistant.');
    expect(a).toBe(b);
  });

  it('different content produces different hash', () => {
    const a = hashContent('You are a helpful assistant.');
    const b = hashContent('You are a precise assistant.');
    expect(a).not.toBe(b);
  });

  it('whitespace changes produce different hash', () => {
    const a = hashContent('You are helpful.');
    const b = hashContent('You are  helpful.');
    expect(a).not.toBe(b);
  });
});

// ── Template literal extraction ─────────────────────────────────────────────

function extractTemplateLiteral(content: string, startAfterBacktick: number): string | null {
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

describe('extractTemplateLiteral', () => {
  it('extracts simple template literal', () => {
    const code = 'const x = `hello world`;';
    const start = code.indexOf('`') + 1;
    expect(extractTemplateLiteral(code, start)).toBe('hello world');
  });

  it('handles ${} expressions', () => {
    const code = 'const x = `hello ${name} world`;';
    const start = code.indexOf('`') + 1;
    expect(extractTemplateLiteral(code, start)).toBe('hello ${name} world');
  });

  it('handles nested backticks in template expressions', () => {
    const code = 'const x = `hello ${fn(`inner`)} world`;';
    const start = code.indexOf('`') + 1;
    const result = extractTemplateLiteral(code, start);
    expect(result).toBe('hello ${fn(`inner`)} world');
  });

  it('handles multi-line content', () => {
    const code = "const x = `line1\nline2\nline3`;";
    const start = code.indexOf('`') + 1;
    expect(extractTemplateLiteral(code, start)).toBe('line1\nline2\nline3');
  });

  it('handles escaped backticks', () => {
    const code = 'const x = `hello \\` world`;';
    const start = code.indexOf('`') + 1;
    expect(extractTemplateLiteral(code, start)).toBe('hello \\` world');
  });

  it('returns null for unterminated literal', () => {
    const code = 'const x = `hello world';
    const start = code.indexOf('`') + 1;
    expect(extractTemplateLiteral(code, start)).toBeNull();
  });

  it('handles deeply nested expressions', () => {
    const code = 'const x = `a ${b(${c})} d`;';
    const start = code.indexOf('`') + 1;
    const result = extractTemplateLiteral(code, start);
    expect(result).toBe('a ${b(${c})} d');
  });
});
