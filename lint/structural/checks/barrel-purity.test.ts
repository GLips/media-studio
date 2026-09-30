import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a web feature barrel reaches nothing server-only, except behind a server function', () => {
  const findings = runCheckOnFiles('barrel-purity', {
    'package.json': JSON.stringify({ imports: { '#web/*': './web/src/*' } }),
    'web/src/infrastructure/media-response.server.ts': "import { statSync } from 'node:fs';\nexport const fileResponse = statSync;\n",
    // Legal neighbour: the server-only import sits in a module whose server function Start strips from the client.
    'web/src/features/review/controllers/review-still-response.ts': [
      "import { createServerOnlyFn } from '@tanstack/react-start';",
      "import { fileResponse } from '#web/infrastructure/media-response.server.ts';",
      'export const respond = createServerOnlyFn(() => fileResponse);',
    ].join('\n'),
    // Adversarial: the same import behind a look-alike that shadows the constructor.
    'web/src/features/review/controllers/review-shadow.ts': [
      "import { createServerOnlyFn } from '@tanstack/react-start';",
      "import { fileResponse } from '#web/infrastructure/media-response.server.ts';",
      'const wrap = (createServerOnlyFn: (f: unknown) => unknown) => createServerOnlyFn(fileResponse);',
      'export const respond = createServerOnlyFn(() => 1);',
    ].join('\n'),
    // Adversarial: a server-only package two hops down, through a relative re-export.
    'web/src/features/review/controllers/review-render.ts': "export { bundle } from './review-bundle.ts';\n",
    'web/src/features/review/controllers/review-bundle.ts': "export { bundle } from '@remotion/bundler';\n",
    // Legal neighbour: a type-only import carries no code.
    'web/src/features/review/ui/review-screen.tsx': "import type { Stats } from 'node:fs';\nexport const ReviewScreen = 1;\n",
    'web/src/features/review/index.ts': [
      "export { ReviewScreen } from './ui/review-screen.tsx';",
      "export { respond } from './controllers/review-still-response.ts';",
      "export { respond as shadowed } from './controllers/review-shadow.ts';",
      "export { bundle } from './controllers/review-render.ts';",
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'web/src/features/review/index.ts:@remotion/bundler',
    'web/src/features/review/index.ts:node:fs',
  ]);
  assert.equal(findings.find((finding) => finding.key === 'node:fs')?.line, 3);
});
