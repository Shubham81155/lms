import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.d.ts',
      'apps/web/next-env.d.ts',
      'apps/web/src/lib/api-schema.ts',
    ],
  },
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
    // Accessibility rules that the web app passes today, as errors so it keeps passing. Left out on purpose:
    // label-has-for (deprecated, wants both nesting and id), control-has-associated-label (cannot see through
    // components), media-has-caption (lesson videos are uploaded by teachers), no-autofocus (dialogs focus their first field).
    files: ['apps/web/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: Object.fromEntries(
      Object.keys(jsxA11y.configs.recommended.rules)
        .filter(
          (r) =>
            ![
              'jsx-a11y/label-has-for',
              'jsx-a11y/control-has-associated-label',
              'jsx-a11y/media-has-caption',
              'jsx-a11y/no-autofocus',
            ].includes(r)
        )
        .map((r) => [r, 'error'])
    ),
  },
  {
    // Tests, seed scripts and the mail dev transport may print.
    files: [
      '**/test/**',
      '**/seed.ts',
      '**/scripts/**',
      'apps/api/src/lib/mailer.ts',
      'apps/api/src/openapi/build.ts',
      'apps/api/src/openapi/missing.ts',
    ],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  }
);
