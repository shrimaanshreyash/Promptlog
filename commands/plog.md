---
description: Run PromptLog (plog) in the current project — scan for LLM prompts, track versions, diff changes, and manage human notes. Pass a subcommand as arguments.
---

# /plog

Runs the PromptLog CLI (`plog`) against the current working project and reports results.

Arguments: `$ARGUMENTS`

## What to do

1. **Check the CLI is installed.** Run `plog --version`.
   - If it is missing (command not found), tell the user to install it once and stop:
     ```
     npm install -g @srimaanshreyas/plog
     ```
     Do not attempt any other install method.

2. **Run the requested action.** Interpret `$ARGUMENTS`:
   - Empty → run `plog status` if `.promptlog/` exists, otherwise run `plog init` (which also does the first scan).
   - Starts with a known subcommand (`init`, `scan`, `status`, `watch`, `diff`, `note`, `notes`, `note-delete`, `export`, `rollback`, `add`, `ignore`, `unignore`, `config`, `ui`) → run `plog $ARGUMENTS` verbatim.
   - A plain phrase (e.g. "check what changed", "find my prompts") → map it to the closest subcommand and run that, telling the user which command you chose.

3. **Never run `plog watch` or `plog ui` in the foreground** — they are long-running servers that block. If the user asks for the dashboard, tell them to run `plog ui` themselves in a terminal (it binds to localhost:4319 by default).

4. **Report the result** concisely: how many prompts were found, what changed, or the diff/notes output. Do not dump raw output if it is long — summarize and offer to show detail.

## Notes

- All state lives in `.promptlog/` in the project root. `plog init` creates it.
- Prompts are identified by stable name, not line number, so they survive refactors.
- If the scanner misses a prompt, the user can register it manually with `plog add <file> --start <n> --end <n> --name <name>`.
