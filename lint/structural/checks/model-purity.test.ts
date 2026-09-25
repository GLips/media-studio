import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCheckOnFiles } from '../spec-tree.ts';

test('a model reaching render, I/O or browser code is caught through any chain; erased types and math are not', () => {
  const findings = runCheckOnFiles('model-purity', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts', '#models/*': './lib/models/*' } }),
    'lib/studio/api.ts': "export const Scene = 'render';\nexport type Clock = number;\n",
    // Legal neighbour: a pure helper, three's math by name, an erased type from the render barrel and a DOM type.
    'lib/models/motion/ease.ts': [
      "import { Vector3 } from 'three';", "import type { Clock } from '#studio';",
      'export const ease = (k: number, el?: HTMLElement) => k * 2;', 'export const v = new Vector3();',
    ].join('\n'),
    // Adversarial: a global read as a parameter's default, beside a parameter that shares a global's name.
    'lib/models/motion/size.ts': 'export const size = (w = window) => w;\nexport const env = (process: number) => process;\n',
    // Obvious: a render package.
    'lib/models/timeline/cues.ts': "import React from 'react';\nexport const c = React;\n",
    // Adversarial: two hops through lib code to the render barrel by alias, a require of a builtin, a global via globalThis.
    'lib/helpers/format.ts': "import { Scene } from '#studio';\nexport const f = Scene;\n",
    'lib/models/reel/needle.ts': [
      "import { ease } from '#models/motion/ease.ts';", "import { f } from '../../helpers/format.ts';",
      "const fs = require('fs');", 'export const w = globalThis.document;',
      // A template-literal specifier and a computed one.
      'const os = require(`os`);', 'const m = await import(name);',
    ].join('\n'),
    // A project's timeline is a model too.
    'projects/p/timeline.ts': "import { Scene } from '../../lib/studio/api.ts';\nexport const t = Scene;\n",
  });
  assert.deepEqual(findings.map((finding) => `${finding.path}: ${finding.message}`).sort(), [
    'lib/models/motion/size.ts: a model reaches the global process',
    'lib/models/motion/size.ts: a model reaches the global window',
    'lib/models/reel/needle.ts: a model reaches a computed import(), whose module can\'t be read',
    'lib/models/reel/needle.ts: a model reaches studio code (lib/studio/api.ts) (via lib/helpers/format.ts)',
    'lib/models/reel/needle.ts: a model reaches the builtin fs',
    'lib/models/reel/needle.ts: a model reaches the builtin os',
    'lib/models/reel/needle.ts: a model reaches the global document',
    'lib/models/timeline/cues.ts: a model reaches the package react',
    'projects/p/timeline.ts: a model reaches studio code (lib/studio/api.ts)',
  ]);
});
