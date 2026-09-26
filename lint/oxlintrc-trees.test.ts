// .oxlintrc.json and lint/catalog/policy/declared-trees.ts are one list wearing two hats: the `arch/` rules are
// scoped to the declared roots by the first override, and each tree's generated directory is ignored for the built-in
// rules. A root declared but not scoped is linted by no `arch/` rule, and nothing else would say so.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DECLARED_TREES } from './catalog/policy/declared-trees.ts';

type OxlintConfig = { ignorePatterns: string[]; overrides: { files: string[]; rules: Record<string, string> }[] };

// oxlint reads the file as JSONC; this config writes its comments on lines of their own.
const oxlintConfig = JSON.parse(
  readFileSync(new URL('../.oxlintrc.json', import.meta.url), 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n'),
) as OxlintConfig;

test('the arch/ override is scoped to exactly the declared trees', () => {
  const archOverride = oxlintConfig.overrides.find((override) => Object.keys(override.rules).some((rule) => rule.startsWith('arch/')));
  assert.deepEqual(archOverride?.files, DECLARED_TREES.map((tree) => `${tree.root}/**`));
});

test("every declared tree's generated directory is ignored by the built-in rules", () => {
  for (const tree of DECLARED_TREES) assert.ok(oxlintConfig.ignorePatterns.includes(`${tree.root}/${tree.vocabulary.generatedDir}/**`));
});
