import { defineConfig } from 'vitest/config';
import path from 'path';

// Mostly pure helpers (no DOM). Component tests (*.test.tsx) opt into jsdom with a `@vitest-environment jsdom` docblock.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['test/**/*.test.{ts,tsx}'] },
});
