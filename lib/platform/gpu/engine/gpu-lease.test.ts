// Processes contending for the GPU through the lease, in a queue of their own (STUDIO_GPU_LEASE_DIR): a render and a
// still hold its two slots; the gate queues, then a look. Each holder is killed with its ticket left behind, and its
// slot frees at once. The gate takes the batch slot after the look queued, so the look draws first; `studio gpu`'s
// listing says so meanwhile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { studioGpuQueueLines } from '../models/gpu-lease-queue.ts';
import { readStudioGpuTickets } from './gpu-lease.ts';

const LEASE_MODULE = new URL('./gpu-lease.ts', import.meta.url).href;

/** A process whose job, of `kind`, takes the lease, prints `granted`, and ends with its stdin. */
function spawnLeaseHolder(dir: string, kind: 'interactive' | 'batch' | 'exclusive', command: string) {
  // Never inside a lease this test's runner might hold.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'STUDIO_GPU_LEASE_TICKET')), STUDIO_GPU_LEASE_DIR: dir };
  const child = spawn(process.execPath, ['--input-type=module', '-e', [
    `import { acquireStudioGpuLease, runAsStudioGpuJob } from ${JSON.stringify(LEASE_MODULE)};`,
    `await runAsStudioGpuJob(${JSON.stringify({ kind, command })}, async () => {`,
    '  await acquireStudioGpuLease();',
    "  console.log('granted');",
    "  await new Promise((ended) => process.stdin.on('end', ended).resume());",
    '});',
  ].join('\n')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const said = { out: '', err: '' };
  child.stdout.on('data', (chunk: Buffer) => { said.out += chunk; });
  child.stderr.on('data', (chunk: Buffer) => { said.err += chunk; });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return { child, said, exited, granted: () => said.out.includes('granted') };
}

async function waitUntil(what: string, holds: () => boolean, deadline = Date.now() + 15_000): Promise<void> {
  if (holds()) return;
  if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
  await sleep(50);
  return waitUntil(what, holds, deadline);
}

test('a killed holder frees its slot, and a look queued before the gate took the batch slot draws before it', { timeout: 60_000 }, () => withStudioTemp('gpu-lease', async (dir) => {
  const started: ReturnType<typeof spawnLeaseHolder>[] = [];
  const queue = (kind: 'interactive' | 'batch' | 'exclusive', command: string) => started[started.push(spawnLeaseHolder(dir, kind, command)) - 1];
  try {
    const render = queue('batch', 'render');
    await waitUntil('the render has the batch slot', render.granted);
    const still = queue('interactive', 'still');
    await waitUntil('the still has the interactive slot', still.granted);
    const gate = queue('exclusive', 'gate');
    await waitUntil('the gate queues', () => gate.said.err.includes('GPU: next for the batch slot; held by render'));
    const look = queue('interactive', 'look');
    await waitUntil('the look queues', () => look.said.err.includes('GPU: next for the interactive slot; held by still'));

    // Killed, their tickets stay behind: the next process to read them finds their pids gone.
    render.child.kill('SIGKILL');
    await render.exited;
    await waitUntil('the gate takes the batch slot, behind the look', () => /GPU: 2nd in line for the interactive slot, behind look \(pid \d+\); held by still/.test(gate.said.err));
    // What `studio gpu` lists, reading this test's queue: the gate in both slots, holding one and waiting for the other.
    process.env.STUDIO_GPU_LEASE_DIR = dir;
    assert.match(studioGpuQueueLines(readStudioGpuTickets(), Date.now()).join('\n'), new RegExp([
      String.raw`^interactive slot: held by still \(pid \d+\) for \d+s`,
      String.raw`  1\. look \(pid \d+\), waiting \d+s`,
      String.raw`  2\. gate \(pid \d+\), waiting \d+s`,
      String.raw`batch slot: held by gate \(pid \d+\) for \d+s, no one waiting$`,
    ].join('\n')));
    still.child.kill('SIGKILL');
    await still.exited;
    await waitUntil('the look has the GPU', look.granted);
    // Long enough for the gate to ask several times.
    await sleep(2000);
    assert.equal(gate.granted(), false, gate.said.err);

    look.child.stdin.end();
    await look.exited;
    assert.match(look.said.err, /GPU: yours after \d+s\nGPU: waited \d+s, ran \d+s, alone\n$/);
    await waitUntil('the gate has the GPU', gate.granted);
    gate.child.stdin.end();
    await gate.exited;
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    delete process.env.STUDIO_GPU_LEASE_DIR;
    for (const { child } of started) child.kill('SIGKILL');
  }
}));
