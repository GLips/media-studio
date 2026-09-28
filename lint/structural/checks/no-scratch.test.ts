import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('any tracked text file naming scratch/ is caught; .gitignore and look-alikes are not', () => {
  const findings = runCheckOnFiles('no-scratch', {
    // Obvious: code reading it.
    'web/src/features/review/ui/review-media.tsx': "const FOLDER = 'scratch/bakeoff';\n",
    // Adversarial: outside every TS import, in shell and Markdown, behind a variable.
    'bin/setup': '#!/bin/sh\n"$repo/scratch/setup.sh"\n',
    'README.md': 'Run `scratch/op-setup.sh` first.\n',
    // Adversarial: the segment with no trailing slash.
    'lib/paths.ts': "const dir = join(root, 'scratch', 'bakeoff');\n",
    'bin/clean': '#!/bin/sh\ncd "$repo/scratch"\n',
    // Legal neighbours: the ignore rule, a directory merely ending in "scratch", the word on its own.
    '.gitignore': 'scratch/\n',
    'lib/tool.ts': "const dir = 'my-scratch/out'; // start from scratch\n",
  });
  assert.deepEqual(caught(findings), [
    'README.md:Run `scratch/op-setup.sh` first.',
    'bin/clean:cd "$repo/scratch"',
    'bin/setup:"$repo/scratch/setup.sh"',
    "lib/paths.ts:const dir = join(root, 'scratch', 'bakeoff');",
    "web/src/features/review/ui/review-media.tsx:const FOLDER = 'scratch/bakeoff';",
  ]);
});

test('prose may name scratch/ as a workspace, but not a path to anything in it', () => {
  const findings = runCheckOnFiles('no-scratch', {
    // Legal: the workspace itself, and a placeholder for a folder of the reader's own.
    'skills/a.md': 'Work in `scratch/`, gitignored.\nPreview a bar from `scratch/<reel>-<bar>/video.tsx`.\n',
    'docs/b.md': 'A demo at `scratch/reel-<piece>/video.tsx`, then scratch/.\n',
    // Adversarial: a named folder or file in it, bare, in a link, and after a workspace mention on the same line.
    'skills/c.md': 'See scratch/three-test/video.tsx.\n',
    'skills/d.md': 'Open [the setup](scratch/op-setup.sh).\n',
    'skills/e.md': 'Use `scratch/` like `scratch/sfx-showcase/`.\n',
    // Adversarial: code keeps the strict rule, placeholder or not.
    'lib/f.ts': "const dir = 'scratch/<name>';\n",
  });
  assert.deepEqual(caught(findings), [
    "lib/f.ts:const dir = 'scratch/<name>';",
    'skills/c.md:See scratch/three-test/video.tsx.',
    'skills/d.md:Open [the setup](scratch/op-setup.sh).',
    'skills/e.md:Use `scratch/` like `scratch/sfx-showcase/`.',
  ]);
});
