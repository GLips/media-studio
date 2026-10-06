// The one way a harness entry point runs its command, as cli/studio.ts runs studio's: help and usage through citty's
// runMain, any other failure as one line on stderr and exit 1, not a stack. The command runs as a GPU job of kind
// `gpu` (lib/platform/gpu/models/gpu-lease-queue.ts), which gives the GPU back when it ends. A signal exits it, as it
// does studio (lib/platform/process/engine/studio-signal-exit.ts).
import { runCommand, runMain, type CommandDef } from 'citty';
import { relative } from 'node:path';
import { runAsStudioGpuJob } from '#lib/platform/gpu/engine/gpu-lease.ts';
import type { StudioGpuJobKind } from '#lib/platform/gpu/models/gpu-lease-queue.ts';
import { exitStudioProcessOnSignals } from '#lib/platform/process/engine/studio-signal-exit.ts';

export async function runHarnessCommand(command: CommandDef, gpu: StudioGpuJobKind) {
  exitStudioProcessOnSignals();
  const rawArgs = process.argv.slice(2);
  const job = { kind: gpu, command: ['node', relative(process.cwd(), process.argv[1]), ...rawArgs].join(' ') };
  // With no arguments, a command with a default verb (the GPU gate's run) runs it here.
  if (rawArgs.length === 0 || rawArgs.some((a) => a === '--help' || a === '-h')) {
    await runAsStudioGpuJob(job, () => runMain(command, { rawArgs }));
    return;
  }
  try {
    await runAsStudioGpuJob(job, () => runCommand(command, { rawArgs }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
  }
}
