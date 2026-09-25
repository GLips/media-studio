import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('any tracked text file naming scratch/ is caught; .gitignore and look-alikes are not', () => {
  const findings = runCheckOnFiles('no-scratch', {
    // Obvious: code reading it.
    'lab/media.tsx': "const FOLDER = 'scratch/bakeoff';\n",
    // Adversarial: outside every TS import, in shell and Markdown, behind a variable.
    'bin/setup': '#!/bin/sh\n"$repo/scratch/setup.sh"\n',
    'README.md': 'Run `scratch/op-setup.sh` first.\n',
    // Legal neighbours: the ignore rule, a directory merely ending in "scratch", the word on its own.
    '.gitignore': 'scratch/\n',
    'lib/tool.ts': "const dir = 'my-scratch/out'; // start from scratch\n",
  });
  assert.deepEqual(caught(findings), [
    'README.md:Run `scratch/op-setup.sh` first.',
    'bin/setup:"$repo/scratch/setup.sh"',
    "lab/media.tsx:const FOLDER = 'scratch/bakeoff';",
  ]);
});
