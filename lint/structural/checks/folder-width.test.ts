import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const modules = (folder: string, count: number, extension = 'ts') =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/m${i}.${extension}`, 'export {};\n']));

test('a lib/ folder with more than 15 source files directly in it is reported; specs, subfolders and non-lib folders are not counted', () => {
  const findings = runCheckOnFiles('folder-width', {
    // Obvious: 16 modules in one folder.
    ...modules('lib/models/reel', 16),
    // Adversarial: 15 modules plus their specs, declaration files and assets stays at 15.
    ...modules('lib/studio/kit', 15, 'tsx'),
    ...modules('lib/studio/kit', 9, 'test.ts'),
    'lib/studio/kit/hosts.d.ts': 'export {};\n',
    'lib/studio/kit/click.wav': '',
    // Adversarial: 20 files split across a folder and its subfolder are two folders of 10.
    ...modules('lib/engine/render', 10),
    ...modules('lib/engine/render/slices', 10),
    // Outside lib/, width is a project's own business.
    ...modules('work/projects/p/tools', 20),
  });
  assert.deepEqual(caught(findings), ['lib/models/reel:width']);
});
