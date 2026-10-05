#!/usr/bin/env node
// studio: the one entry point for making videos in this repo. Each verb lives in cli/commands/<verb>.ts and is
// imported only when run, so `studio home` doesn't load Remotion. Payload goes to stdout, progress to stderr.
import { defineCommand, runCommand, runMain } from 'citty';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runAsStudioGpuJob } from '#lib/platform/gpu/engine/gpu-lease.ts';
import { exitStudioProcessOnSignals } from '#lib/platform/process/engine/studio-signal-exit.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';

exitStudioProcessOnSignals();

const studioCommand = defineCommand({
  meta: {
    name: 'studio',
    description: 'Videos and stills made in code: capture, voice, music, compose, render. `studio <verb> --help` for each.',
  },
  subCommands: {
    workspace: () => import('./commands/workspace.ts').then((m) => m.default),
    brushes: () => import('./commands/brushes.ts').then((m) => m.default),
    new: () => import('./commands/new.ts').then((m) => m.default),
    capture: () => import('./commands/capture.ts').then((m) => m.default),
    probe: () => import('./commands/probe.ts').then((m) => m.default),
    voice: () => import('./commands/voice.ts').then((m) => m.default),
    audition: () => import('./commands/audition.ts').then((m) => m.default),
    music: () => import('./commands/music.ts').then((m) => m.default),
    sfx: () => import('./commands/sfx.ts').then((m) => m.default),
    preview: () => import('./commands/preview.ts').then((m) => m.default),
    look: () => import('./commands/look.ts').then((m) => m.default),
    clock: () => import('./commands/clock.ts').then((m) => m.default),
    still: () => import('./commands/still.ts').then((m) => m.default),
    check: () => import('./commands/check.ts').then((m) => m.default),
    mix: () => import('./commands/mix.ts').then((m) => m.default),
    gen: () => import('./commands/gen.ts').then((m) => m.default),
    render: () => import('./commands/render.ts').then((m) => m.default),
    remote: () => import('./commands/remote.ts').then((m) => m.default),
    repeatable: () => import('./commands/repeatable.ts').then((m) => m.default),
    profile: () => import('./commands/profile.ts').then((m) => m.default),
    study: () => import('./commands/study.ts').then((m) => m.default),
    paint: () => import('./commands/paint.ts').then((m) => m.default),
    review: () => import('./commands/review.ts').then((m) => m.default),
    home: () => import('./commands/home.ts').then((m) => m.default),
    hosts: () => import('./commands/hosts.ts').then((m) => m.default),
    api: () => import('./commands/api.ts').then((m) => m.default),
  },
});

runInEnclosingStudioCheckout();
// Made up front, not on first use, so every command sweeps what a crashed or killed one left in the temp dir.
studioTempRoot();

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
const wantsUsage = rawArgs.length === 0 || rawArgs.some((a) => a === '--help' || a === '-h') || (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v'));
// runMain prints help and the version, but prints any other error with its stack; a failed command is one line.
if (wantsUsage) {
  await runMain(studioCommand, { rawArgs });
} else {
  try {
    const gpuJob = { kind: INTERACTIVE_GPU_VERBS.has(rawArgs[0]) ? 'interactive' : 'batch', command: ['studio', ...rawArgs].join(' ') } as const;
    await runAsStudioGpuJob(gpuJob, () => runCommand(studioCommand, { rawArgs }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
  }
}
