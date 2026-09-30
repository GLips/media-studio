import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a barrel lists each name it offers under its own name; other modules may re-export as they like', () => {
  const findings = runCheckOnFiles('barrel-discoverability', {
    'lib/picture/reel/models/bounce.ts': 'export const bounce = 1;\nexport default function spin() {}\n',
    // Obvious: a wildcard in the studio's barrel. Adversarial: a namespace wildcard, a default renamed, a type renamed.
    'lib/api.ts': [
      "export * from '#lib/picture/reel/models/bounce.ts';",
      "export * as reel from '#lib/picture/reel/models/bounce.ts';",
      "export { default as Spin } from '#lib/picture/reel/models/bounce.ts';",
      "export { type Pose as ReelPose, bounce } from '#lib/picture/reel/models/bounce.ts';",
      '// export * from "./commented-out.ts";',
    ].join('\n'),
    // Obvious: a web feature's barrel renaming a local.
    'web/src/features/f/index.ts': "import { Page } from './ui/page.tsx';\nexport { Page as FeaturePage };\n",
    'web/src/features/f/ui/page.tsx': 'export const Page = () => null;\n',
    // Legal: a module that isn't a barrel, and a same-name re-export.
    'lib/picture/reel/studio/bounce.tsx': "export * from '../models/bounce.ts';\nexport { bounce as b } from '../models/bounce.ts';\n",
    'web/src/features/g/index.ts': "export { Page } from '../f/ui/page.tsx';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/api.ts:* as reel from #lib/picture/reel/models/bounce.ts',
    'lib/api.ts:* from #lib/picture/reel/models/bounce.ts',
    'lib/api.ts:ReelPose',
    'lib/api.ts:Spin',
    'web/src/features/f/index.ts:FeaturePage',
  ]);
});
