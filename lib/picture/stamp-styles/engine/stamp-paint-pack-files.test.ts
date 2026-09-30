import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { STAMP_PAINT_ASSETS_VERSION } from '../models/stamp-paint-pack.ts';
import { readStampPaintPackGeneration, replaceStampPaintPack } from './stamp-paint-pack-files.ts';

const manifest = (files: readonly string[]) => ({
  version: STAMP_PAINT_ASSETS_VERSION, app: 'procreate', files, brushes: {}, source: { archive: 'pack.zip', sha256: '' }, skipped: {}, previews: {}, palettes: {}, papers: {},
});

/** Publishes a generation holding `file`, failing after writing it when asked. */
function publish(root: string, file: string, fail = false) {
  const archive = join(root, 'pack.zip');
  writeFileSync(archive, '');
  return replaceStampPaintPack({ archive, stylesDir: root, style: 'wash', pack: 'vvds' }, (generation) => {
    mkdirSync(join(generation, 'tips'), { recursive: true });
    writeFileSync(join(generation, file), file);
    if (fail) throw new Error('the archive ran out');
    writeFileSync(join(generation, 'manifest.json'), JSON.stringify(manifest([file])));
    return {};
  });
}

test('a failed import leaves the previous one readable, and a finished one replaces it whole while fidelity/ stays', () => withStudioTemp('pack-publish', (root) => {
  const { dir } = publish(root, 'tips/a.png');
  mkdirSync(join(dir, 'fidelity'));
  writeFileSync(join(dir, 'fidelity', 'report.json'), '{}');
  const first = readStampPaintPackGeneration(dir);

  assert.throws(() => publish(root, 'tips/b.png', true), /the archive ran out/);
  const after = readStampPaintPackGeneration(dir);
  assert.equal(after.dir, first.dir);
  assert.deepEqual(after.manifest.files, ['tips/a.png']);
  assert.deepEqual(readdirSync(join(dir, 'generations')), [first.dir.split('/').at(-1)]);

  publish(root, 'tips/c.png');
  const replaced = readStampPaintPackGeneration(dir);
  assert.deepEqual(replaced.manifest.files, ['tips/c.png']);
  assert.equal(readFileSync(join(replaced.dir, 'tips/c.png'), 'utf8'), 'tips/c.png');
  assert.equal(existsSync(first.dir), false);
  assert.equal(readFileSync(join(dir, 'fidelity', 'report.json'), 'utf8'), '{}');
}));

test("an import takes over a dead import's lock and refuses a live one's", () => withStudioTemp('pack-lock', (root) => {
  const lock = join(root, 'wash', 'brushes', '.vvds.lock');
  mkdirSync(join(root, 'wash', 'brushes'), { recursive: true });
  writeFileSync(lock, `${spawnSync('true').pid} killed`);
  publish(root, 'tips/a.png');
  assert.equal(existsSync(lock), false);

  writeFileSync(lock, `${process.pid} importing`);
  assert.throws(() => publish(root, 'tips/b.png'), new RegExp(`process ${process.pid} is importing into vvds now`));
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid} importing`);
}));
