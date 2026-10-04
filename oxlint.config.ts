// The studio's oxlint config: oxlint's built-in rules, sonarjs's, and the studio's own per-file rules (lint/oxlint/,
// the `arch/` prefix), over every TypeScript file. The arch rules are enabled for every file; each decides from the
// file's position in lint/policy/studio-tree.ts whether it has a subject there, so a web-only rule stays silent on a
// Remotion scene without any path glob here. What's found is judged against the baselines by `npm run lint`
// (lint/lint.ts), not here.
//
// Suppressing one line: `// oxlint-disable-next-line arch/<rule>`, with the reason beside it.

import { defineConfig } from 'oxlint';
import { DEFAULT_EXPORT_MODULE_GLOBS, TERMINAL_PROGRAM_GLOBS } from './lint/policy/studio-tree.ts';

export default defineConfig({
  jsPlugins: ['./lint/oxlint/plugin.ts', 'eslint-plugin-sonarjs'],

  // An explicit array REPLACES oxlint's default (unicorn, typescript, oxc) rather than adding to it, and a rule whose
  // plugin is missing here is dropped silently. `import` and `promise` carry the `import/` rules named below.
  plugins: ['react', 'unicorn', 'typescript', 'oxc', 'import', 'promise'],

  // Generated output, fixtures (which name violations on purpose), dependencies and build output.
  ignorePatterns: [
    '**/*.gen.ts',
    '**/generated/**',
    '**/out/**',
    '**/fixture/**',
    '**/fixtures/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/.output/**',
    '**/.tanstack/**',
  ],

  // Type-aware needs oxlint-tsgolint; its type information reaches the built-in `typescript/*` rules only.
  options: { typeAware: true, reportUnusedDisableDirectives: 'warn' },

  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
    pedantic: 'off',
    style: 'off',
  },

  rules: {
    'arch/require-safety-comment': 'error',
    // Off, as arch/require-safety-comment governs the same sites: an assertion is allowed when a SAFETY comment
    // names its invariant, which this rule, with no such escape, would refuse all the same.
    'typescript/no-unsafe-type-assertion': 'off',
    // Keys by index go wrong only when a stateful list reorders; a Remotion frame renders from scratch. On in web/.
    'react/no-array-index-key': 'off',
    'arch/no-chained-type-assertions': 'error',
    'arch/no-type-argument-assertion': 'error',
    'arch/no-reflect-access': 'error',
    'arch/no-long-comments': 'error',
    'arch/no-vacant-symbol-names': 'error',
    'arch/no-module-mocking': 'error',
    'arch/hook-count': 'warn',
    'arch/prop-count': 'warn',
    'arch/single-component-export': 'warn',
    'arch/no-async-effect': 'error',
    'arch/route-thinness': 'error',
    'arch/server-fn-placement': 'error',
    'arch/server-fn-validation': 'error',
    'arch/no-deprecated-input-validator': 'error',
    'arch/no-plain-export-in-server-fn-module': 'error',
    'arch/no-disable-validation': 'error',
    'arch/no-inline-color': 'error',
    'arch/no-inline-font-size': 'error',
    'arch/no-inline-style-prop': 'error',
    'arch/no-raw-primitives': 'error',
    'arch/no-stylex-border-shorthand': 'error',
    'arch/vendor-component-containment': 'error',
    'typescript/await-thenable': 'error',
    // node:test's test() and describe() return a promise the runner awaits itself.
    'typescript/no-floating-promises': ['error', { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it'] }] }],
    'typescript/no-misused-promises': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-return': 'error',
    'sonarjs/duplicates-in-character-class': 'error',
    'sonarjs/no-all-duplicated-branches': 'error',
    'sonarjs/no-duplicate-in-composite': 'error',
    'sonarjs/no-duplicate-test-title': 'error',
    'sonarjs/no-duplicated-branches': 'error',
    'sonarjs/no-identical-conditions': 'error',
    'sonarjs/no-identical-expressions': 'error',
    'sonarjs/no-identical-functions': 'error',
    'no-nested-ternary': 'error',
    'react/set-state-in-effect': 'error',
    'react/no-deriving-state-in-effects': 'error',
    'react/react-in-jsx-scope': 'off',
    'no-console': 'error',
    eqeqeq: 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/consistent-type-imports': 'error',
    'import/no-default-export': 'error',
    'import/no-duplicates': 'error',
    'import/no-cycle': 'error',
    'import/no-self-import': 'error',
    // An install sets what modules read as they load, so it's imported for its effect, before them.
    'import/no-unassigned-import': ['error', { allow: ['**/*-install.ts'] }],
    'no-underscore-dangle': 'off',
  },

  overrides: [
    {
      files: [
        '**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
        '**/__tests__/**',
        'test/**',
        '**/*.d.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
        '**/*.gen.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
        '**/scripts/**',
      ],
      rules: {
        'no-nested-ternary': 'off',
        'react/set-state-in-effect': 'off',
        'react/no-deriving-state-in-effects': 'off',
      },
    },
    {
      // TanStack's file routes and a tool's config (this one's included) are default exports by the tool's contract.
      files: ['**/*.config.ts', '**/routes/**', '**/*.tsx', 'web/**'],
      rules: {
        'import/no-default-export': 'off',
        'no-console': 'off',
      },
    },
    { files: ['web/**'], rules: { 'react/no-array-index-key': 'error' } },
    { files: [...TERMINAL_PROGRAM_GLOBS], rules: { 'no-console': 'off' } },
    { files: [...DEFAULT_EXPORT_MODULE_GLOBS], rules: { 'import/no-default-export': 'off' } },
  ],
});
