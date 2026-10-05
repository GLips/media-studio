// studio-signal-exit.ts: how a studio entry point ends on SIGINT, SIGTERM or SIGHUP. It exits, with 128 plus the
// signal's number as a shell reports a death by signal, so its 'exit' listeners clean up: the temp root, the GPU lease,
// Remotion's browser. Node only.
//
// A listener for a signal replaces Node's default of dying by it, and Remotion's BrowserRunner listens for SIGTERM and
// SIGHUP only to close its browser. Without this policy a render outlives its kill, sees a dead browser and launches
// another, holding the GPU's slot.
//
// Negative space: nothing watches the parent's pid, so a run under nohup or setsid outlives its shell by design.

import { constants } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const STUDIO_EXIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Longest a signal's exit waits on the steps given to onStudioSignalExit. */
const STUDIO_SIGNAL_STEPS_MS = 5000;

const studioSignalSteps = new Set<() => Promise<void>>();

/**
 * Runs `step` when a signal ends the process, before it exits, beside every other step given: for work that waits on
 * something outside the process (a remote call's cancelling), which a synchronous 'exit' listener can't. Returns its
 * removal, for once there's nothing left for it to do.
 */
export function onStudioSignalExit(step: () => Promise<void>): () => void {
  studioSignalSteps.add(step);
  return () => {
    studioSignalSteps.delete(step);
  };
}

/**
 * Makes each of SIGINT, SIGTERM and SIGHUP exit this process with 128 plus its number (130, 143, 129), whatever
 * other listeners it has, once the steps given to onStudioSignalExit end or 5 s pass; a second signal exits at once.
 * An entry point calls it first, before anything else listens.
 */
export function exitStudioProcessOnSignals(): void {
  let ending = false;
  for (const signal of STUDIO_EXIT_SIGNALS) {
    process.on(signal, () => {
      const code = 128 + constants.signals[signal];
      if (ending || studioSignalSteps.size === 0) process.exit(code);
      ending = true;
      const steps = Promise.allSettled([...studioSignalSteps].map(async (step) => step()));
      void Promise.race([steps, sleep(STUDIO_SIGNAL_STEPS_MS)]).then(() => process.exit(code));
    });
  }
}
