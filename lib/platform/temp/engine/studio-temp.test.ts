import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { studioTempRoot, withStudioTemp } from './studio-temp.ts';

const MODULE = join(import.meta.dirname, 'studio-temp.ts');

/** A studio process that makes its root, prints it, and waits to be stopped. */
async function startHoldingProcess() {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { studioTempRoot } from ${JSON.stringify(MODULE)}; console.log(studioTempRoot()); setInterval(() => {}, 1000);`]);
  const [chunk] = await once(child.stdout, 'data') as [Buffer];
  return { child, root: chunk.toString().trim() };
}

test('a step that throws leaves no folder, sync or async', async () => {
  let seen = '';
  assert.throws(() => withStudioTemp('sync', (dir) => { seen = dir; throw new Error('mid-step'); }), /mid-step/);
  assert.equal(existsSync(seen), false);
  await assert.rejects(withStudioTemp('async', async (dir) => { seen = dir; await Promise.resolve(); throw new Error('mid-step'); }), /mid-step/);
  assert.equal(existsSync(seen), false);
  assert.equal(dirname(seen), studioTempRoot());
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`a process stopped with ${signal} removes its root, and still dies by the signal`, async () => {
    const { child, root } = await startHoldingProcess();
    assert.equal(existsSync(root), true);
    child.kill(signal);
    const [, stoppedBy] = await once(child, 'exit');
    assert.equal(stoppedBy, signal);
    assert.equal(existsSync(root), false);
  });
}

test("after a kill -9, the next studio process sweeps the dead process's root", async () => {
  const { child, root } = await startHoldingProcess();
  child.kill('SIGKILL');
  await once(child, 'exit');
  assert.equal(existsSync(root), true);
  const next = spawnSync(process.execPath, ['--input-type=module', '-e', `import { studioTempRoot } from ${JSON.stringify(MODULE)}; studioTempRoot();`]);
  assert.equal(next.status, 0, next.stderr.toString());
  assert.equal(existsSync(root), false);
});
