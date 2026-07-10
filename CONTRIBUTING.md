# Contributing to PromptLog

Thanks for your interest in improving PromptLog! Contributions of all kinds are welcome — bug reports, feature ideas, docs, and code.

## Getting started

```bash
git clone https://github.com/shrimaanshreyash/Promptlog.git
cd Promptlog
npm install
npm test
```

Build the CLI and UI:

```bash
npm run build        # builds CLI (tsc) + dashboard (Vite)
node dist/index.js --help
```

## Development workflow

1. Fork the repo and create a branch: `git checkout -b my-feature`.
2. Make your change. Keep it focused — one concern per pull request.
3. Add or update tests under `tests/`. The suite runs with `npm test` (Vitest).
4. Make sure `npm test` and `npm run build` both pass.
5. Commit with a clear message and open a pull request against `main`.

## Guidelines

- **Requirements:** Node.js >= 22.13.
- **Tests:** New behavior needs coverage. Bug fixes should add a regression test.
- **Style:** Match the surrounding code. Run `npm run build` to catch type errors.
- **Scope:** Prompt detection lives in `src/scanner/`, the CLI in `src/`, the dashboard in `ui/`.
- **CI:** All pull requests run against Node 22 on Linux, macOS, and Windows. Keep it green.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened. Include your OS and Node version.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
