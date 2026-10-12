import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';
import { DOC_BUDGETS_MANIFEST, ratchetDocBudgets } from './doc-budgets.ts';

const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ');

const BUDGETED_FIXTURE = {
  [DOC_BUDGETS_MANIFEST]: JSON.stringify({
    'docs/over.md': 100, 'docs/slack.md': 2000, 'docs/fits.md': 140, 'docs/gone.md': 10, 'docs/bad.md': '50', 'skills/s/references/': 150,
  }),
  // Obvious: over. Adversarial: a table and a code fence count; a ceiling left high after a cut.
  'docs/over.md': `| a | b |\n\`\`\`\n${words(97)}\n\`\`\`\n`,
  'docs/slack.md': words(1000),
  // Legal: within the 40-word floor of a short doc.
  'docs/fits.md': words(100),
  'docs/bad.md': words(10),
  // A folder key sums its .md files: 160 words over 150.
  'skills/s/references/a.md': words(80),
  'skills/s/references/deep/b.md': words(80),
  'skills/s/references/c.png': words(500),
  // Standing docs the manifest leaves out.
  'skills/s/SKILL.md': words(30),
  'cli/CLAUDE.md': words(20),
  'work/projects/p/CLAUDE.md': words(20),
};

test('a doc or folder over its ceiling, past its slack, or a standing doc unbudgeted is reported; a bad entry is its own finding', () => {
  assert.deepEqual(caught(runCheckOnFiles('doc-budgets', BUDGETED_FIXTURE)), [
    'cli/CLAUDE.md:unbudgeted', `${DOC_BUDGETS_MANIFEST}:ceiling:docs/bad.md`, 'docs/gone.md:missing', 'docs/over.md:over', 'docs/slack.md:slack',
    'skills/s/SKILL.md:unbudgeted', 'skills/s/references/:over',
  ]);
});

test('the ratchet lowers slack and budgets the unbudgeted, and leaves over, missing and bad entries for someone to decide', () => {
  const files = new Map(Object.entries(BUDGETED_FIXTURE));
  const tree = { paths: new Set(files.keys()), readTexts: (paths: readonly string[]) => paths.map((path) => files.get(path) ?? '') };
  assert.deepEqual(JSON.parse(ratchetDocBudgets(tree)?.manifestText ?? '{}'), {
    'cli/CLAUDE.md': 60, 'docs/bad.md': '50', 'docs/fits.md': 140, 'docs/gone.md': 10, 'docs/over.md': 100, 'docs/slack.md': 1050,
    'skills/s/SKILL.md': 70, 'skills/s/references/': 150,
  });
});

test('a manifest missing from the snapshot or not parsing is a finding, never an empty run; an empty one is clean', () => {
  assert.deepEqual(caught(runCheckOnFiles('doc-budgets', { 'docs/a.md': 'a' })), [`${DOC_BUDGETS_MANIFEST}:unreadable`]);
  assert.deepEqual(caught(runCheckOnFiles('doc-budgets', { [DOC_BUDGETS_MANIFEST]: '{ "docs/a.md": 1,' })), [`${DOC_BUDGETS_MANIFEST}:unreadable`]);
  assert.deepEqual(runCheckOnFiles('doc-budgets', { [DOC_BUDGETS_MANIFEST]: '{}' }), []);
});
