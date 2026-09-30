import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';
import { DOC_BUDGETS_MANIFEST } from './doc-budgets.ts';

const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ');

test('a doc over its ceiling, or under it by more than 5%, is reported; a bad entry is its own finding', () => {
  const findings = runCheckOnFiles('doc-budgets', {
    [DOC_BUDGETS_MANIFEST]: JSON.stringify({ 'docs/over.md': 100, 'docs/slack.md': 200, 'docs/fits.md': 105, 'docs/gone.md': 10, 'docs/bad.md': '50' }),
    // Obvious: over. Adversarial: a table and a code fence count; a ceiling left high after a cut.
    'docs/over.md': `| a | b |\n\`\`\`\n${words(97)}\n\`\`\`\n`,
    'docs/slack.md': words(100),
    // Legal: 100 words under a 105 ceiling is within 5%.
    'docs/fits.md': words(100),
    'docs/bad.md': words(10),
  });
  assert.deepEqual(caught(findings), [
    `${DOC_BUDGETS_MANIFEST}:ceiling:docs/bad.md`, 'docs/gone.md:missing', 'docs/over.md:over', 'docs/slack.md:slack',
  ]);
});

test('a manifest missing from the snapshot or not parsing is a finding, never an empty run; an empty one is clean', () => {
  assert.deepEqual(caught(runCheckOnFiles('doc-budgets', { 'docs/a.md': 'a' })), [`${DOC_BUDGETS_MANIFEST}:unreadable`]);
  assert.deepEqual(caught(runCheckOnFiles('doc-budgets', { [DOC_BUDGETS_MANIFEST]: '{ "docs/a.md": 1,' })), [`${DOC_BUDGETS_MANIFEST}:unreadable`]);
  assert.deepEqual(runCheckOnFiles('doc-budgets', { [DOC_BUDGETS_MANIFEST]: '{}' }), []);
});
