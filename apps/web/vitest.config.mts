import { defineConfig } from 'vitest/config';
import path from 'path';

// Pure helpers only (no DOM): the screens themselves are covered by type-checking and the build.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['test/**/*.test.ts'] },
});
