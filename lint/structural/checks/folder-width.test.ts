import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const modules = (folder: string, count: number, extension = 'ts') =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/m${i}.${extension}`, 'export {};\n']));

test('a lib/ folder with more than 15 source files directly in it is reported; specs, subfolders and non-lib folders are not counted', () => {
  const findings = runCheckOnFiles('folder-width', {
    // Obvious: 16 modules in one folder.
    ...modules('lib/picture/reel/models', 16),
    // Adversarial: 15 modules plus their specs, declaration files and assets stays at 15.
    ...modules('lib/picture/kit/studio', 15, 'tsx'),
    ...modules('lib/picture/kit/studio', 9, 'test.ts'),
    'lib/picture/kit/studio/hosts.d.ts': 'export {};\n',
    'lib/picture/kit/studio/click.wav': '',
    // Adversarial: 20 files split across a folder and its subfolder are two folders of 10.
    ...modules('lib/output/render/engine', 10),
    ...modules('lib/output/render/engine/slices', 10),
    // Outside lib/, width is a project's own business.
    ...modules('work/projects/p/tools', 20),
  });
  assert.deepEqual(caught(findings), ['lib/picture/reel/models:width']);
});
