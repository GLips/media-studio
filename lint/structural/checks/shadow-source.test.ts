import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('only the shadow module writes a shadow in the web app', () => {
  const findings = runCheckOnFiles('shadow-source', {
    'web/src/shared/ui/shadows.ts': "export const shadows = { pinHalo: { boxShadow: '0 0 0 2px black' } };\n",
    'web/src/features/review/ui/review-stage.tsx': [
      "const styles = { pin: { boxShadow: '0 0 4px black' } };",
      // Adversarial: a computed key, a member write, and a shadow in a stylesheet.
      "const again = { ['boxShadow']: 'none' };",
      "document.body.style.boxShadow = 'none';",
      // Legal neighbours: a name that merely contains the word, and a comment.
      'const shadowRoot = document.body.shadowRoot; // boxShadow is in shadows.ts',
    ].join('\n'),
    'web/src/styles.css': '.panel { box-shadow: 0 0 1px black; }\n.x { /* box-shadow: none */ }\n',
    // Legal neighbour: a scene's shadow is the picture's, not the app's.
    'lib/picture/kit/studio/card.tsx': "export const card = { boxShadow: '0 0 4px black' };\n",
  });
  assert.deepEqual(caught(findings), [
    'web/src/features/review/ui/review-stage.tsx:boxShadow',
    'web/src/features/review/ui/review-stage.tsx:boxShadow',
    'web/src/features/review/ui/review-stage.tsx:boxShadow',
    'web/src/styles.css:box-shadow',
  ]);
});
