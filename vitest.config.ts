import { defineConfig } from 'vitest/config';

// Only the vendored engine's specs run here. The mod's own tests are
// *.test.tsx files run by `claude plugin test`, inside Claude Code's engine.
export default defineConfig({
  test: {
    include: ['engine/tests/**/*.spec.ts'],
  },
});
