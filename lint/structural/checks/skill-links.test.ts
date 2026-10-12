import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test("a skill's plugin-root and relative links must resolve, and it names no checkout-only path or script", () => {
  const findings = runCheckOnFiles('skill-links', {
    'skills/a/SKILL.md': [
      // Legal: a plugin-root link, a relative one, a folder, a URL, an anchor, a studio-home path, a #lib import.
      'Read ${CLAUDE_PLUGIN_ROOT}/skills/b/references/x.md, then [y](references/y.md#part) and `${CLAUDE_PLUGIN_ROOT}/skills/b/references/`.',
      '[site](https://example.com) [top](#top) `$(studio home)/lib/paint/meadow.ts` `import { t } from \'#lib/timing/t.ts\'`',
      // Obvious: a moved file. Adversarial: a relative link climbing to the wrong folder; checkout-only paths and scripts.
      'See ${CLAUDE_PLUGIN_ROOT}/skills/b/references/gone.md and [z](../b/z.md).',
      'docs/painting.md has it; run `npm run trace`.',
    ].join('\n'),
    'skills/a/references/y.md': 'y',
    'skills/b/references/x.md': 'x',
  });
  assert.deepEqual(caught(findings), [
    'skills/a/SKILL.md:../b/z.md', 'skills/a/SKILL.md:docs/painting.md', 'skills/a/SKILL.md:npm run', 'skills/a/SKILL.md:skills/b/references/gone.md',
  ]);
});
