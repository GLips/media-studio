import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { judgeArchitecture } from './arch-verdict.ts';
import { caught } from './spec-tree.ts';

const writeFiles = (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

test('the workspace scope judges what work/ has staged, through the studio\'s barrel, against the baseline it has staged', () => {
  withStudioTemp('arch-verdict-spec', (root) => {
    runFixtureGit(root, ['init', '-q']);
    writeFiles(root, {
      '.gitignore': '/work/\n',
      'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
      'lib/timing/timeline/models/timeline.ts': 'export const fixedSpan = (s: number) => s;\n',
      'lib/api.ts': "export { fixedSpan } from '#lib/timing/timeline/models/timeline.ts';\n",
    });
    runFixtureGit(root, ['add', '-A']);

    const workspace = join(root, 'work');
    mkdirSync(workspace);
    runFixtureGit(workspace, ['init', '-q']);
    writeFiles(workspace, { 'arch-baseline.json': '{}\n', 'projects/p/video.tsx': "import { fixedSpan } from '#studio';\n" });
    runFixtureGit(workspace, ['add', '-A']);
    // Unstaged: the fix, and a baseline excusing the violation. Neither is what the commit holds.
    const excused = JSON.stringify({ 'timing-ownership': { 'work/projects/p/video.tsx': { 'fixedSpan from #studio': 1 } } });
    writeFiles(workspace, { 'arch-baseline.json': excused, 'projects/p/video.tsx': 'export {};\n' });

    const timing = () => caught(judgeArchitecture(root, { scope: 'workspace' }).fresh.filter((finding) => finding.check === 'timing-ownership'));
    assert.deepEqual(timing(), ['work/projects/p/video.tsx:fixedSpan from #studio']);
    runFixtureGit(workspace, ['add', 'arch-baseline.json']);
    assert.deepEqual(timing(), []);
  });
});
