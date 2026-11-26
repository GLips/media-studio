import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFixtureGit } from '#lib/platform/git/engine/fixture-git.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { withFrozenEngine } from './frozen-engine-checkout.ts';

const commit = (cwd: string) => {
  runFixtureGit(cwd, ['init', '-q']);
  runFixtureGit(cwd, ['add', '.']);
  runFixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=test@invalid', 'commit', '-qm', 'Fixture']);
  return runFixtureGit(cwd, ['rev-parse', 'HEAD']).trim();
};

test('a live project imports its pinned engine and brand from a reused checkout after both sources change', async (t) => {
  await withStudioTemp('frozen-project', async (dir) => {
    const studio = join(dir, 'studio'), work = join(studio, 'work'), project = join(work, 'projects/probe');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(work, 'brands'));
    mkdirSync(join(studio, 'node_modules/test-package'), { recursive: true });
    writeFileSync(join(studio, '.gitignore'), 'work/\nnode_modules/\n');
    writeFileSync(join(studio, 'package.json'), JSON.stringify({ type: 'module', imports: { '#studio': './engine.js', '#brand': './work/brands/brand.js' } }));
    writeFileSync(join(studio, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' } } }));
    writeFileSync(join(studio, 'engine.js'), 'export default "engine A";');
    writeFileSync(join(work, 'brands/brand.js'), 'export default "brand A";');
    const record = { engine: commit(studio), workspace: commit(work) };
    writeFileSync(join(studio, 'engine.js'), 'throw Error("loaded current engine");');
    writeFileSync(join(work, 'brands/brand.js'), 'throw Error("loaded current brand");');
    const before = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(dir, 'cache');
    t.after(() => { if (before === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = before; });
    const read = async (revision: number) => {
      writeFileSync(join(project, 'entry.js'), `import e from '#studio'; import b from '#brand'; console.log(e, b, ${revision});`);
      return withFrozenEngine({ project, record, studio }, async (root) => {
        const entry = join(root, 'work/projects/probe/entry.js');
        assert.equal(execFileSync(process.execPath, [entry], { cwd: root, encoding: 'utf8' }).trim(), `engine A brand A ${revision}`);
        assert.equal(realpathSync(join(root, 'node_modules/test-package')), realpathSync(join(studio, 'node_modules/test-package')));
        assert.ok(!existsSync(join(root, 'work/projects/probe/frozen.json')));
        writeFileSync(join(root, 'work/projects/probe/out/result'), String(revision));
        return root;
      });
    };
    assert.equal(await read(1), await read(2));
    assert.equal(readFileSync(join(project, 'out/result'), 'utf8'), '2');
    writeFileSync(join(studio, 'package-lock.json'), '{}');
    const installed = () => withFrozenEngine({ project, record, studio }, async (root) => {
      assert.ok(!existsSync(join(root, 'node_modules/test-package')));
      return statSync(join(root, 'node_modules')).ino;
    });
    assert.equal(await installed(), await installed());
  });
});
