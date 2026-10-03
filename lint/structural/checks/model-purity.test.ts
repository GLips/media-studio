import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCheckOnFiles } from '../spec-tree.ts';

test('a model reaching render, I/O or browser code is caught through any chain; erased types and math are not', () => {
  const findings = runCheckOnFiles('model-purity', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
    'lib/api.ts': "export const Scene = 'render';\nexport type Clock = number;\n",
    // Legal neighbour: a pure helper, three's math by name, an erased type from the render barrel and a DOM type.
    'lib/picture/motion/models/ease.ts': [
      "import { Vector3 } from 'three';", "import type { Clock } from '#studio';",
      'export const ease = (k: number, el?: HTMLElement) => k * 2;', 'export const v = new Vector3();',
    ].join('\n'),
    // Legal neighbour: a model's spec, its evaluator under node --test.
    'lib/picture/motion/models/ease.test.ts': "import { test } from 'node:test';\nimport { ease } from './ease.ts';\ntest('e', () => ease(1));\n",
    // Adversarial: a global read as a parameter's default, beside a parameter that shares a global's name.
    'lib/picture/motion/models/size.ts': 'export const size = (w = window) => w;\nexport const env = (process: number) => process;\n',
    // Obvious: a render package.
    'lib/timing/timeline/models/cues.ts': "import React from 'react';\nexport const c = React;\n",
    // Adversarial: two hops through lib code to the render barrel by alias, a require of a builtin, a global via globalThis.
    'lib/picture/reel/models/format.ts': "import { Scene } from '#studio';\nexport const f = Scene;\n",
    'lib/picture/reel/models/needle.ts': [
      "import { ease } from '#lib/picture/motion/models/ease.ts';", "import { f } from './format.ts';",
      "const fs = require('fs');", 'export const w = globalThis.document;',
      // A template-literal specifier and a computed one.
      'const os = require(`os`);', 'const m = await import(name);',
    ].join('\n'),
    // A project's timeline is a model too.
    'work/projects/p/timeline.ts': "import { Scene } from '../../../lib/api.ts';\nexport const t = Scene;\n",
    // So is a painting source, which `studio paint check` loads in plain Node.
    'work/projects/p/scenes/pond/pond.painting.ts': "import { Scene } from '#studio';\nexport default () => Scene;\n",
  });
  assert.deepEqual(findings.map((finding) => `${finding.path}: ${finding.message}`).toSorted(), [
    'lib/picture/motion/models/size.ts: a model reaches the global process',
    'lib/picture/motion/models/size.ts: a model reaches the global window',
    // Every lib file a chain passes through is a model now, so the middle hop is caught on its own too.
    'lib/picture/reel/models/format.ts: a model reaches studio code (lib/api.ts)',
    'lib/picture/reel/models/needle.ts: a model reaches a computed import(), whose module can\'t be read',
    'lib/picture/reel/models/needle.ts: a model reaches studio code (lib/api.ts) (via lib/picture/reel/models/format.ts)',
    'lib/picture/reel/models/needle.ts: a model reaches the builtin fs',
    'lib/picture/reel/models/needle.ts: a model reaches the builtin os',
    'lib/picture/reel/models/needle.ts: a model reaches the global document',
    'lib/timing/timeline/models/cues.ts: a model reaches the package react',
    'work/projects/p/scenes/pond/pond.painting.ts: a model reaches studio code (lib/api.ts)',
    'work/projects/p/timeline.ts: a model reaches studio code (lib/api.ts)',
  ]);
});
