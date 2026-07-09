import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Integration tests spawn the CLI + sqlite + git; cold starts on Windows CI
    // can exceed the 5s default, so give them generous headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
