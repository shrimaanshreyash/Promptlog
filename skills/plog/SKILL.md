---
name: plog
description: Use PromptLog in the current project to initialize prompt history, scan and semantically audit LLM prompt surfaces, inspect changes, manage notes, export history, or run other PromptLog operations. Use when the user asks to find, scan, track, audit, diff, annotate, or roll back prompts.
argument-hint: "init | scan | audit | status | <other PromptLog command>"
---

# PromptLog

Run PromptLog from this plugin package. The user does not need a global `plog` installation.

## CLI runner

Use this exact runner for every CLI operation, preserving the current project as the working directory:

```text
node "${CLAUDE_PLUGIN_ROOT}/dist/index.js"
```

Never substitute a global `plog` command and never install PromptLog from inside this skill. If the runner fails because Node is older than 22.13, report the detected Node version and the minimum requirement.

Arguments: `$ARGUMENTS`

## Route the request

- No arguments: run `status` when `.promptlog/config.json` exists; otherwise run `init`, followed by the semantic audit below.
- `init`: run `init`, then perform the semantic audit when `intelligence.mode` is `host-agent`.
- `scan`: run `scan --json`, then perform the semantic audit when `intelligence.mode` is `host-agent`.
- `audit`: ensure the project is initialized, then perform only the semantic audit.
- `watch`: start the bundled `watch` command as a background process. Report how to stop it.
- `ui`: start the bundled `ui` command as a background process and report the localhost URL. Do not expose it on `0.0.0.0` unless the user explicitly requests that.
- Any other PromptLog subcommand: pass the arguments to the bundled runner unchanged. Supported commands include `status`, `inventory`, `diff`, `note`, `notes`, `note-delete`, `export`, `rollback`, `add`, `ignore`, `unignore`, and `config`.
- A plain-language phrase: map it to the closest action, state the action selected, and continue.

Do not leave foreground `watch` or `ui` processes blocking the session.

## Semantic audit

The deterministic scanner is the first pass. This audit is an independent, repository-aware second pass designed to find prompt surfaces that naming and syntax heuristics can miss.

1. Read `.promptlog/config.json`. Respect `scanner.include`, `scanner.exclude`, and `intelligence` settings. If `intelligence.mode` is `none`, skip this audit and say so.
2. Run `inventory --json`. This inventory intentionally contains locations and hashes but not prompt text.
3. Locate actual model invocation boundaries in the included source: provider SDK calls, agent/framework constructors, message arrays, prompt templates, completion/chat/generation calls, and project-specific model wrappers.
4. Trace prompt-bearing arguments backward through helpers, imports, object properties, arrays, joins, template functions, and configuration. Also inspect instruction files that are loaded into an agent or model at runtime.
5. Treat a value as a prompt when its text or assembled result is supplied to a model as instructions, system/user/assistant content, a template, examples, tool guidance, evaluation criteria, or agent policy.
6. Exclude UI copy, logs, ordinary documentation, tests/fixtures, generated output, dependencies, and historical `.promptlog` data unless the application actually sends that content to a model at runtime.
7. Compare every confirmed prompt surface with the inventory by normalized source path and overlapping line range. Do not call something missed merely because its stable name differs.
8. Report four concise groups: tracked, missed, uncertain, and excluded false positives. For each missed or uncertain item, provide source file, exact line range, symbol or purpose, and reasoning. Do not print full prompt content when `sendFullPromptByDefault` is false.
9. Never register a missed prompt silently. When `requireUserConfirmation` is true, present the proposed `add` operations and wait for explicit approval. After approval, run one bundled `add <file> --start <n> --end <n> --name <stable-name>` operation per accepted item, then rerun `inventory --json` and summarize the result.

If no missed prompts are found, say that the deterministic inventory and semantic audit agree. Do not claim mathematical completeness; state the files or runtime boundaries inspected.

## Result reporting

Summarize the command result and semantic audit separately. Include counts and changed prompt names, but avoid dumping long raw output. All project history remains under `.promptlog/`.
