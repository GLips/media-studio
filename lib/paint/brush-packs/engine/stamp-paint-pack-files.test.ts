import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { studioProcessName, thisStudioProcess } from '#lib/platform/process/engine/studio-process.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { STAMP_PAINT_ASSETS_VERSION } from '../models/stamp-paint-pack.ts';
import { readStampPaintPackGeneration, replaceStampPaintPack } from './stamp-paint-pack-files.ts';

const manifest = (files: readonly string[]) => ({
  version: STAMP_PAINT_ASSETS_VERSION, app: 'procreate', files, brushes: {}, source: { archive: 'pack.zip', sha256: '' }, skipped: {}, previews: {}, palettes: {}, papers: {},
});

/** Publishes a generation holding `file`, failing after writing it when asked. */
function publish(root: string, file: string, fail = false) {
  return replaceStampPaintPack({ stylesDir: root, style: 'wash', pack: 'vvds' }, (generation) => {
    mkdirSync(join(generation, 'tips'), { recursive: true });
    writeFileSync(join(generation, file), file);
    if (fail) throw new Error('the archive ran out');
    writeFileSync(join(generation, 'manifest.json'), JSON.stringify(manifest([file])));
    return {};
  });
}

test('a failed import leaves the previous one readable, and a finished one replaces it whole while fidelity/ stays', () => withStudioTemp('pack-publish', async (root) => {
  const { dir } = await publish(root, 'tips/a.png');
  mkdirSync(join(dir, 'fidelity'));
  writeFileSync(join(dir, 'fidelity', 'report.json'), '{}');
  const first = readStampPaintPackGeneration(dir);

  await assert.rejects(publish(root, 'tips/b.png', true), /the archive ran out/);
  const after = readStampPaintPackGeneration(dir);
  assert.equal(after.dir, first.dir);
  assert.deepEqual(after.manifest.files, ['tips/a.png']);
  assert.deepEqual(readdirSync(join(dir, 'generations')), [first.dir.split('/').at(-1)]);

  await publish(root, 'tips/c.png');
  const replaced = readStampPaintPackGeneration(dir);
  assert.deepEqual(replaced.manifest.files, ['tips/c.png']);
  assert.equal(readFileSync(join(replaced.dir, 'tips/c.png'), 'utf8'), 'tips/c.png');
  assert.equal(existsSync(first.dir), false);
  assert.equal(readFileSync(join(dir, 'fidelity', 'report.json'), 'utf8'), '{}');
}));

test("an import takes over a dead import's lock, and one whose pid now runs another process, and waits out a live one's", () => withStudioTemp('pack-lock', async (root) => {
  const lock = join(root, 'wash', 'brushes', '.vvds.lock');
  mkdirSync(join(root, 'wash', 'brushes'), { recursive: true });
  writeFileSync(lock, `${studioProcessName({ pid: spawnSync('true').pid, started: Date.now() })} killed`);
  await publish(root, 'tips/a.png');
  assert.equal(existsSync(lock), false);

  // This process's pid, but a process that started an hour before it: the pid was handed on.
  writeFileSync(lock, `${studioProcessName({ ...thisStudioProcess(), started: thisStudioProcess().started - 3_600_000 })} killed`);
  await publish(root, 'tips/b.png');
  assert.equal(existsSync(lock), false);

  const live = `${studioProcessName(thisStudioProcess())} importing`;
  writeFileSync(lock, live);
  let published = false;
  const waiting = publish(root, 'tips/c.png').then(() => void (published = true));
  await sleep(50);
  assert.equal(published, false);
  assert.equal(readFileSync(lock, 'utf8'), live);
  // The live import finishes, and the waiting one goes.
  rmSync(lock);
  await waiting;
  assert.deepEqual(readStampPaintPackGeneration(join(root, 'wash', 'brushes', 'vvds')).manifest.files, ['tips/c.png']);
}));
