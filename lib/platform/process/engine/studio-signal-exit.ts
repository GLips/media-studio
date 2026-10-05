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

const STUDIO_EXIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/**
 * Makes each of SIGINT, SIGTERM and SIGHUP exit this process with 128 plus its number (130, 143, 129), whatever
 * other listeners it has. An entry point calls it first, before anything else listens.
 */
export function exitStudioProcessOnSignals(): void {
  for (const signal of STUDIO_EXIT_SIGNALS) process.on(signal, () => process.exit(128 + constants.signals[signal]));
}
