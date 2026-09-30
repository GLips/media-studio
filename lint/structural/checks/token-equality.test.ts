import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const THEME = [
  "import * as stylex from '@stylexjs/stylex';",
  "export const spacing = stylex.defineVars({ hairline: '2px', gap: '0.75rem', inset: '1rem' });",
  "export const radius = stylex.defineVars({ surface: '10px' });",
].join('\n');

test('a web value equal to a theme token names the token, on every surface', () => {
  const findings = runCheckOnFiles('token-equality', {
    'web/src/shared/ui/theme.stylex.ts': THEME,
    'web/src/features/review/ui/review-card.tsx': [
      'export const Card = () => <Stack gap={16} p="12px" radius={10} mt={7}>x</Stack>;',
      "const styles = { card: { padding: 16, borderRadius: '10px', marginTop: 12.5 } };",
      // Legal neighbours: off-scale values, a token by name, a zero, and a key the check doesn't read.
      "const fine = { gap: 13, padding: 0, width: 16, margin: spacing.inset };",
    ].join('\n'),
    // Legal neighbour: a scene's numbers are the picture's.
    'lib/picture/kit/studio/card.tsx': 'export const card = { padding: 16 };\n',
  });
  assert.deepEqual(caught(findings), [
    'web/src/features/review/ui/review-card.tsx:borderRadius=10',
    'web/src/features/review/ui/review-card.tsx:gap=16',
    'web/src/features/review/ui/review-card.tsx:p=12',
    'web/src/features/review/ui/review-card.tsx:padding=16',
    'web/src/features/review/ui/review-card.tsx:radius=10',
  ]);
});

test('a theme with no scale to read fails loudly rather than passing everything', () => {
  assert.throws(() => runCheckOnFiles('token-equality', {
    'web/src/shared/ui/theme.stylex.ts': "export const spacing = stylex.defineVars({ inset: spacingBase });\n",
  }), /no "spacing" scale/);
});
