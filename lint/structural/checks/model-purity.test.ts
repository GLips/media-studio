import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCheckOnFiles } from '../spec-tree.ts';

test('a model reaching render, I/O or browser code is caught through any chain; erased types and math are not', () => {
  const findings = runCheckOnFiles('model-purity', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*', '#library/*': './work/library/items/*', '#styles/*': './work/styles/*' } }),
    'lib/api.ts': "export const Scene = 'render';\nexport type Clock = number;\n",
    // Legal neighbour: a pure helper, three's math and scene graph by name, TSL, an erased type and a DOM type.
    'lib/picture/motion/models/ease.ts': [
      "import { Vector3 } from 'three';", "import { Mesh } from 'three/webgpu';", "import { vec3 } from 'three/tsl';", "import type { Clock } from '#studio';",
      'export const ease = (k: number, el?: HTMLElement) => k * 2;', 'export const v = new Vector3();',
    ].join('\n'),
    // Legal neighbour: a model's spec, its evaluator under node --test.
    'lib/picture/motion/models/ease.test.ts': "import { test } from 'node:test';\nimport { ease } from './ease.ts';\ntest('e', () => ease(1));\n",
    // Adversarial: a global read as a parameter's default, beside a parameter, a local and a later function
    // that share a global's name, and a local in a nested block that shadows nothing outside it.
    'lib/picture/motion/models/size.ts': [
      'export const size = (w = window) => w;', 'export const env = (process: number) => process;',
      'export const early = () => fetch();', 'function fetch() { return 1; }',
      'export const outer = () => { { const document = 1; void document; } return document; };',
      'const self = { navigator: 1 };', 'export const own = self.navigator;',
      // An overload's parameter is a type's, erased: it reads nothing.
      'export class Meter { read(process: number): number; read(process: string): number; read(v: number | string) { return Number(v); } }',
    ].join('\n'),
    // A model's own window over time, named as the browser's is.
    'lib/picture/motion/models/rub.ts': 'const window = { at: 0, over: 1 };\nexport const rub = window.at + window.over;\n',
    // Obvious: a render package.
    'lib/timing/timeline/models/cues.ts': "import React from 'react';\nimport { WebGPURenderer } from 'three/webgpu';\nexport const c = [React, WebGPURenderer];\n",
    // Adversarial: two hops through lib code to the render barrel by alias, a require of a builtin, a global via globalThis.
    'lib/picture/reel/models/format.ts': "import { Scene } from '#studio';\nexport const f = Scene;\n",
    'lib/picture/reel/models/needle.ts': [
      "import { ease } from '#lib/picture/motion/models/ease.ts';", "import { f } from './format.ts';",
      "const fs = require('fs');", 'export const w = globalThis.document;',
      // A template-literal specifier and a computed one.
      'const os = require(`os`);', 'const m = await import(name);',
    ].join('\n'),
    // A project's storyboard is a model too.
    'work/projects/p/storyboard.ts': "import { Scene } from '../../../lib/api.ts';\nexport const t = Scene;\n",
    // Legal: a project's shared model reading a library item's metadata, for its storyboard.
    'work/projects/q/project.ts': "export default { capability: 'silent', shared: ['take.ts'] };\n",
    'work/projects/q/take.ts': "import item from '#library/take/item.json' with { type: 'json' };\nexport const take = item;\n",
    'work/projects/q/storyboard.ts': "import { take } from './take.ts';\nexport const t = take;\n",
    'work/library/items/take/item.json': '{ "id": "take" }\n',
    // So is a painting source, which `studio paint check` loads in plain Node.
    'work/projects/p/scenes/pond/pond.painting.ts': "import { Scene } from '#studio';\nexport default () => Scene;\n",
    // A style's painter is followed as the painting source's own code: one reaching the render barrel is caught.
    'work/projects/p/scenes/pond/lily.painting.ts': "import { lily } from '#styles/ink/painter.ts';\nexport default lily;\n",
    'work/styles/ink/painter.ts': "import { Scene } from '#studio';\nexport const lily = () => Scene;\n",
  });
  assert.deepEqual(findings.map((finding) => `${finding.path}: ${finding.message}`).toSorted(), [
    'lib/picture/motion/models/size.ts: a model reaches the global document',
    'lib/picture/motion/models/size.ts: a model reaches the global window',
    // Every lib file a chain passes through is a model now, so the middle hop is caught on its own too.
    'lib/picture/reel/models/format.ts: a model reaches studio code (lib/api.ts)',
    'lib/picture/reel/models/needle.ts: a model reaches a computed import(), whose module can\'t be read',
    'lib/picture/reel/models/needle.ts: a model reaches studio code (lib/api.ts) (via lib/picture/reel/models/format.ts)',
    'lib/picture/reel/models/needle.ts: a model reaches the builtin fs',
    'lib/picture/reel/models/needle.ts: a model reaches the builtin os',
    'lib/picture/reel/models/needle.ts: a model reaches the global document',
    'lib/timing/timeline/models/cues.ts: a model reaches WebGPURenderer from three/webgpu',
    'lib/timing/timeline/models/cues.ts: a model reaches the package react',
    'work/projects/p/scenes/pond/lily.painting.ts: a model reaches studio code (lib/api.ts) (via work/styles/ink/painter.ts)',
    'work/projects/p/scenes/pond/pond.painting.ts: a model reaches studio code (lib/api.ts)',
    'work/projects/p/storyboard.ts: a model reaches studio code (lib/api.ts)',
  ]);
});
