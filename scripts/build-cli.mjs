import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  banner: {
    js: "import { createRequire as __promptlogCreateRequire } from 'node:module'; const require = __promptlogCreateRequire(import.meta.url);",
  },
});
