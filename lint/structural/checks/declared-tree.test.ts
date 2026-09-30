import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a source file or stylesheet no position covers is a finding; declared ones and non-source files are not', () => {
  const findings = runCheckOnFiles('declared-tree', {
    // Obvious: a module directly in lib/, and a web helper outside every place.
    'lib/helpers.ts': 'export const h = 1;\n',
    'web/src/helpers.ts': 'export const h = 1;\n',
    // Adversarial: a stylesheet beside a feature's barrel, which no style check could read.
    'web/src/features/review/review.css': '.x { color: red; }\n',
    // Legal neighbours: declared positions, the app's global stylesheet, and a doc.
    'lib/picture/kit/studio/kit.tsx': 'export const Kit = 1;\n',
    'web/src/styles.css': 'body { margin: 0; }\n',
    'web/src/features/review/ui/review.css': '.y { margin: 0; }\n',
    'docs/notes.md': '# notes\n',
  });
  assert.deepEqual(caught(findings), [
    'lib/helpers.ts:undeclared',
    'web/src/features/review/review.css:undeclared',
    'web/src/helpers.ts:undeclared',
  ]);
});
