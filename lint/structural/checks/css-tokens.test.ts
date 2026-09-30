import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a web stylesheet writes colors and absolute font sizes as tokens', () => {
  const findings = runCheckOnFiles('css-tokens', {
    'web/src/styles.css': [
      ':root { --panel: #16161a; }',
      '#abcdef { color: var(--panel); }',
      '.note { color: #fff; background: rgb(var(--panel-channels)); }',
      // Adversarial: a value wrapped onto the next line, and a color function with its own channels.
      '.hint { font-size:',
      '  13px; border-color: rgba(0, 0, 0, 0.4); }',
      // Legal neighbours: a relative size, and a raw value only in a comment.
      '.lede { font-size: 1.2em; /* was #000 */ }',
    ].join('\n'),
    // Legal neighbour: a stylesheet outside the web app isn't this check's subject.
    'lib/picture/kit/studio/kit.css': '.card { color: #fff; }\n',
  });
  assert.deepEqual(caught(findings), [
    'web/src/styles.css:#fff',
    'web/src/styles.css:font-size',
    'web/src/styles.css:rgba(0, 0, 0, 0.4',
  ]);
  assert.deepEqual(findings.map((finding) => finding.line).toSorted(), [3, 4, 5]);
});
