// studio-lock-file.ts: a file one process of this machine holds at a time (a brush pack's import lock, a kept render
// browser's loan), taken over from a holder that ended without letting go. The file names its holder and a token,
// `<pid>-<started> <uuid>`, so a process lets go only of a lock that's still its own. Node only.
import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { parseStudioProcessName, studioProcessName, studioProcessRunning, thisStudioProcess, type StudioProcessIdentity } from '#lib/platform/process/engine/studio-process.ts';

/** A lock this process holds: its file, and the text it put there. */
export type StudioLockFileHold = { readonly lock: string; readonly text: string };

/** What trying a lock came to: this process holds it now, or the running process `holder` does. */
export type StudioLockFileTry = { readonly held: StudioLockFileHold } | { readonly holder: StudioProcessIdentity };

/** The text of the file at `path`, or undefined when there's none. */
function readLockText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    // SAFETY: node:fs throws ErrnoExceptions.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The process a lock's `text` names, while it runs; undefined once it's gone, and for text naming none. */
function runningLockHolder(text: string): StudioProcessIdentity | undefined {
  const holder = parseStudioProcessName(text.split(' ')[0]);
  return holder && studioProcessRunning(holder) ? holder : undefined;
}

/**
 * Clears `lock` when its holder has ended, or returns the running one. Renamed away first, so of two takers one rename
 * wins. What was renamed may turn out live (taken between our read and rename): it's linked back, which fails rather
 * than overwrite a lock taken since, leaving that one's holder the lock's.
 */
function clearEndedLock(lock: string): StudioProcessIdentity | undefined {
  const text = readLockText(lock);
  if (text === undefined) return undefined;
  const holding = runningLockHolder(text);
  if (holding) return holding;
  const taken = `${lock}.ended-${randomUUID()}`;
  try {
    renameSync(lock, taken);
  } catch (error) {
    // SAFETY: node:fs throws ErrnoExceptions.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const holder = runningLockHolder(readFileSync(taken, 'utf8'));
    if (!holder) return undefined;
    try {
      linkSync(taken, lock);
    } catch (error) {
      // SAFETY: node:fs throws ErrnoExceptions.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return holder;
  } finally {
    rmSync(taken, { force: true });
  }
}

/**
 * Takes `lock` for this process unless a running process holds it; one whose holder ended is taken over. The lock is
 * linked in whole from a file of this process's own, so a reader never finds it empty.
 */
export function tryStudioLockFile(lock: string): StudioLockFileTry {
  const text = `${studioProcessName(thisStudioProcess())} ${randomUUID()}`, mine = `${lock}.${randomUUID()}`;
  writeFileSync(mine, text);
  try {
    for (;;) {
      try {
        linkSync(mine, lock);
        return { held: { lock, text } };
      } catch (error) {
        // SAFETY: node:fs throws ErrnoExceptions.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const holder = clearEndedLock(lock);
      if (holder) return { holder };
    }
  } finally {
    rmSync(mine, { force: true });
  }
}

/** Lets go of `hold`'s lock, unless it's no longer this hold's: another process took it over, thinking its holder ended. */
export function releaseStudioLockFile({ lock, text }: StudioLockFileHold): void {
  if (readLockText(lock) === text) rmSync(lock, { force: true });
}
