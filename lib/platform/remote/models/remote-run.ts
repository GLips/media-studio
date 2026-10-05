// remote-run.ts: which of package.json's scripts `studio remote run` runs in a container, and what each container
// reserves. Pure.
//
// A script that runs `node --test` gets a test runner's container. The runner runs a test file on each processor it
// sees but one, and the container shows it the cores it reserved: 16, so 15 files run at once (the Mac runs 9 on 10).
// Tests render fixtures in the render browser, which refuses software GL, so a test runner has a T4 too. Every other
// script (tsc, oxlint, check:arch) is one program with a helper thread or two, on 4 cores. Reservation and limit are
// the same: a check uses what it has, and is billed for it either way.
import type { RemoteContainerSize } from './remote-settings.ts';

export const REMOTE_TEST_RUNNER_SIZE: RemoteContainerSize = { gpu: 'T4', cpu: { request: 16, limit: 16 }, memoryMiB: { request: 16384, limit: 32768 } };
export const REMOTE_PROGRAM_SIZE: RemoteContainerSize = { gpu: null, cpu: { request: 4, limit: 4 }, memoryMiB: { request: 8192, limit: 16384 } };

/** What a script's container reserves, by its package.json command. */
export const remoteRunSizeOf = (command: string): RemoteContainerSize => (/\bnode\s+--test\b/.test(command) ? REMOTE_TEST_RUNNER_SIZE : REMOTE_PROGRAM_SIZE);

/** Why `script` doesn't run remotely, or undefined when it does. `command` is its line in package.json, if it has one. */
export function remoteRunRefusal(script: string, command: string | undefined): string | undefined {
  if (command === undefined) return `${script} isn't a script in package.json`;
  if (script === 'stamp:gate') {
    return 'stamp:gate judges paint against baselines drawn on this Mac\'s GPU, pixel for pixel, and another GPU rounds paint its own way: run it here, as pre-push does';
  }
  if (/\bharness\//.test(command)) return `${script} runs harness/ (${command}), which paints on this Mac's GPU or drives Photoshop: run it here`;
  return undefined;
}
