import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Disables stylistic rules that conflict with Prettier (formatting is owned
  // by Prettier, correctness by ESLint).
  prettier,
  {
    rules: {
      // `any` is pervasive in the JSONB-blob handling. Surface it as a warning
      // to pay down incrementally (PR-D types the worst clusters) rather than
      // failing the build on day one of linting.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Honor the `_`-prefix convention for intentionally-unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Tests legitimately declare fixture vars (tokens, ids) for clarity and
    // use dynamic require() for lazy/conditional loading.
    files: ['tests/**', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
