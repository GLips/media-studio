import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';
import { FILE_SIZE_LIMIT } from './file-size.ts';

const lines = (count: number, trailing = '\n') => `${Array.from({ length: count }, (_, i) => `// ${i}`).join('\n')}${trailing}`;

test('a governed source file past the limit is reported wherever it sits; one at the limit is not', () => {
  const findings = runCheckOnFiles('file-size', {
    // Obvious: one line over, in lib.
    'lib/picture/reel/models/long.ts': lines(FILE_SIZE_LIMIT + 1),
    // Adversarial: comments and blank lines count; a project scene and a CLI file are governed like lib.
    'work/projects/p/scenes/intro.tsx': `${lines(FILE_SIZE_LIMIT)}\n\n`,
    'cli/long.ts': lines(FILE_SIZE_LIMIT + 1, ''),
    // Legal: exactly at the limit, with or without a trailing newline.
    'lib/picture/reel/models/at-limit.ts': lines(FILE_SIZE_LIMIT),
    'web/src/features/f/ui/at-limit.tsx': lines(FILE_SIZE_LIMIT, ''),
  });
  assert.deepEqual(caught(findings), ['cli/long.ts:size', 'lib/picture/reel/models/long.ts:size', 'work/projects/p/scenes/intro.tsx:size']);
});
