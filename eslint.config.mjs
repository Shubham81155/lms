import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/*.js', '**/*.d.ts', 'apps/web/next-env.d.ts', 'apps/web/src/lib/api-schema.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Existing code has many `any`s; surfaced as warnings so they can be burned down without blocking CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-namespace': 'off',
      'no-console': ['error', { allow: ['warn'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // Tests, seed scripts and the mail dev transport may print.
    files: ['**/test/**', '**/seed.ts', '**/scripts/**', 'apps/api/src/lib/mailer.ts', 'apps/api/src/openapi/build.ts', 'apps/api/src/openapi/missing.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  }
);
