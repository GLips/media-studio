#!/usr/bin/env node
// studio: the one entry point for making videos in this repo. The command tree is studio-command.ts; each verb is
// imported only when run, so `studio home` doesn't load Remotion. Payload goes to stdout, progress to stderr.
import { runCommand } from 'citty';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { STUDIO_VERB_GROUPS, studioCommand } from './studio-command.ts';

runInEnclosingStudioCheckout();

/**
 * The PATH's `studio` is one checkout's file. Started inside another checkout (a worktree, a clone), this process
 * becomes that checkout's cli/studio.ts with the same arguments, so an agent there runs its own code on its own
 * projects. It's replaced, not spawned: signals reach the command, and its exit code is the run's.
 */
function runInEnclosingStudioCheckout() {
  const checkout = enclosingStudioCheckout(process.cwd());
  if (checkout === null || realpathSync(checkout) === realpathSync(STUDIO_ROOT)) return;
  // Node leaves execve out only on Windows, where the studio doesn't run.
  process.execve!(process.execPath, [process.execPath, ...process.execArgv, join(checkout, 'cli/studio.ts'), ...process.argv.slice(2)]);
}

/** The nearest folder at or above `from` holding a studio checkout (its cli/studio.ts and lib/api.ts), or null. */
function enclosingStudioCheckout(from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'cli/studio.ts')) && existsSync(join(dir, 'lib/api.ts'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Verbs someone waits at the screen for: they take the GPU's interactive slot, and every other verb that draws (render,
 * profile, check, mix…) the batch slot (lib/platform/gpu/models/gpu-lease-queue.ts).
 */
const INTERACTIVE_GPU_VERBS: ReadonlySet<string> = new Set(['look', 'still', 'paint']);

const rawArgs = process.argv.slice(2);
const help = await import('./command-help.ts');
const stray = await help.strayStudioCommandWord(studioCommand, rawArgs);
if (stray !== null) {
  process.stderr.write(`${stray}\n`, () => process.exit(1));
  // Help reads only the command definitions: no temp sweep (it lists processes), no GPU queue, no workspace.
} else if (rawArgs.some((a) => a === '--help' || a === '-h') || (await help.namesStudioCommandGroup(studioCommand, rawArgs))) {
  await help.printStudioHelp(studioCommand, STUDIO_VERB_GROUPS, rawArgs);
} else {
  const { exitStudioProcessOnSignals } = await import('#lib/platform/process/engine/studio-signal-exit.ts');
  const { studioTempRoot } = await import('#lib/platform/temp/engine/studio-temp.ts');
  const { runAsStudioGpuJob } = await import('#lib/platform/gpu/engine/gpu-lease.ts');
  exitStudioProcessOnSignals();
  // Made up front, not on first use, so every command sweeps what a crashed or killed one left in the temp dir.
  studioTempRoot();
  try {
    const gpuJob = { kind: INTERACTIVE_GPU_VERBS.has(rawArgs[0]) ? 'interactive' : 'batch', command: ['studio', ...rawArgs].join(' ') } as const;
    await runAsStudioGpuJob(gpuJob, () => runCommand(studioCommand, { rawArgs }));
  } catch (error) {
    // A failed command is one line, not a stack, without the colour citty puts in its usage errors. Exits once both
    // streams drain: a piped stdout would lose its tail.
    const { stripVTControlCharacters } = await import('node:util');
    const message = stripVTControlCharacters(error instanceof Error ? error.message : String(error));
    process.stderr.write(`${message}\n`, () => process.stdout.write('', () => process.exit(1)));
  }
}
