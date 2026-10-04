// studio-process.ts: whether the process that left something behind (a temp root, a pack's import lock, a GPU lease
// ticket) still runs. A pid alone can't say: once a process ends, the OS may give its pid to another. So whatever a
// process leaves records its identity, its pid and when it started, and a pid now running a process that started at
// another time is gone. Node only.

import { spawnSync } from 'node:child_process';

/** A process as what it leaves behind records it: its pid, and when it started (ms since the epoch). */
export type StudioProcessIdentity = { readonly pid: number; readonly started: number };

/** ps gives a process's start to the second, and Node's clock starts a little after the process does. */
const STUDIO_PROCESS_START_TOLERANCE_MS = 2500;

/** This process, as anything it leaves behind should record it. */
export const thisStudioProcess = (): StudioProcessIdentity => ({ pid: process.pid, started: Math.round(performance.timeOrigin) });

/** `identity` as a file or folder name, `<pid>-<started>`; parseStudioProcessName reads it back. */
export const studioProcessName = ({ pid, started }: StudioProcessIdentity) => `${pid}-${started}`;

/** The identity in a name studioProcessName wrote, or undefined for any other name. */
export function parseStudioProcessName(name: string): StudioProcessIdentity | undefined {
  const match = /^(\d+)-(\d+)$/.exec(name);
  return match ? { pid: Number(match[1]), started: Number(match[2]) } : undefined;
}

// Identities ps has confirmed, by name. From then on signal 0 alone tells: macOS and Linux hand pids out in order, so
// a pid runs another process only once its own has ended and the OS has gone round every other pid.
const confirmedStudioProcesses = new Set<string>();

/**
 * Those of `identities` whose process still runs: its pid is alive and ps says it started when the identity says. One
 * ps call asks after all those not yet confirmed.
 */
export function runningStudioProcesses<T extends StudioProcessIdentity>(identities: readonly T[]): T[] {
  const alive = identities.filter(({ pid }) => pidAlive(pid));
  const asking = alive.filter((identity) => !confirmedStudioProcesses.has(studioProcessName(identity)));
  const starts = asking.length ? processStartTimes(asking.map(({ pid }) => pid)) : new Map<number, number>();
  return alive.filter((identity) => {
    const name = studioProcessName(identity);
    if (confirmedStudioProcesses.has(name)) return true;
    const started = starts.get(identity.pid);
    if (started === undefined || Math.abs(started - identity.started) > STUDIO_PROCESS_START_TOLERANCE_MS) return false;
    confirmedStudioProcesses.add(name);
    return true;
  });
}

/** Whether `identity`'s process still runs, as runningStudioProcesses decides it. */
export const studioProcessRunning = (identity: StudioProcessIdentity): boolean => runningStudioProcesses([identity]).length > 0;

/** Signal 0 checks a pid without signalling it: ESRCH is no such process, EPERM one that isn't ours but runs. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: process.kill throws ErrnoExceptions.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When each of `pids` that runs started, ms since the epoch, as ps tells it (to the second). */
function processStartTimes(pids: readonly number[]): Map<number, number> {
  // ps lists the pids it finds and exits 1 when it finds none, so its listing is read whatever its status.
  const { stdout } = spawnSync('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return new Map(stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    return match ? [[Number(match[1]), Date.parse(match[2])] as const] : [];
  }));
}
