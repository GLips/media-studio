import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const POLICY = join(import.meta.dirname, 'studio-signal-exit.ts');
const TEMP = join(import.meta.dirname, '../../temp/engine/studio-temp.ts');

test('SIGTERM ends a studio process whose other SIGTERM listener stays, exiting 143 with its temp root removed', async () => {
  // The second listener is Remotion's BrowserRunner's: it closes its browser and lets the process run on.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { exitStudioProcessOnSignals } from ${JSON.stringify(POLICY)};
    import { studioTempRoot } from ${JSON.stringify(TEMP)};
    exitStudioProcessOnSignals();
    process.on('SIGTERM', () => {});
    console.log(studioTempRoot());
    setInterval(() => {}, 1000);
  `]);
  const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));
  const [chunk] = await once(child.stdout, 'data') as [Buffer];
  const root = chunk.toString().trim();
  assert.equal(existsSync(root), true);
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null });
  assert.equal(existsSync(root), false);
});
