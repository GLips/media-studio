// gpu-lease.ts: the studio's GPU lease. Every process that draws on the machine's one adapter takes it first, at
// inRenderBrowser (lib/platform/browser/engine/render-browser.ts), and keeps it until it gives it back or ends, so a
// command's passes run back to back. Node only.
//
// A process queues with a ticket file, `<arrived>-<pid>.json`, in the user's cache, shared by every checkout; who goes
// next is gpu-lease-queue.ts's rule. A ticket counts while its pid runs and started when the ticket says, so a killed
// job frees its slot at once. A slot is taken by writing it into the ticket, then reading the others': if another took
// it too, it's given back and asked for again. A holder's child draws inside its lease.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  studioGpuStanding, studioGpuSummaryLine, studioGpuTicketRunning, studioGpuWaitingLine, formatStudioGpuSpan,
  type StudioGpuJobKind, type StudioGpuTicket,
} from '../models/gpu-lease-queue.ts';

/** Names the ticket of the lease a parent holds, in the environment its children inherit. */
const STUDIO_GPU_PARENT_LEASE_ENV = 'STUDIO_GPU_LEASE_TICKET';
const STUDIO_GPU_POLL_MS = 500;
/** How often a holder notes who draws beside it, for its summary. */
const STUDIO_GPU_SHARING_SAMPLE_MS = 2000;
/** ps gives a process's start to the second, and Node's clock starts a little after the process does. */
const STUDIO_GPU_START_TOLERANCE_MS = 2500;

/** The user's cache: macOS's own, else XDG's. */
function userCacheDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache');
}

/** The ticket folder: STUDIO_GPU_LEASE_DIR when set (a test's own queue), else the user's cache. */
const studioGpuLeaseDir = () => process.env.STUDIO_GPU_LEASE_DIR || join(userCacheDir(), 'media-studio', 'gpu-lease');

type HeldStudioGpuLease = { file: string; ticket: StudioGpuTicket; waitedMs: number; grantedAt: number; sharedWith: Map<string, StudioGpuTicket>; sampler: NodeJS.Timeout };

// Until a command declares itself, a process is its script and arguments, interactive (a test, a project's tool).
let studioGpuJob: { kind: StudioGpuJobKind; command: string } = {
  kind: 'interactive', command: [basename(process.argv[1] ?? 'node'), ...process.argv.slice(2)].join(' '),
};
let queuedTicketFile: string | null = null;
let heldLease: HeldStudioGpuLease | 'inside-parent' | null = null;
let takingLease: Promise<void> | null = null;
let releasesAtExit = false;
const confirmedTicketIds = new Set<string>();

/** Names this process to the queue before its first GPU browser: its kind, and what other processes' waits call it. */
export function declareStudioGpuJob(kind: StudioGpuJobKind, command: string): void {
  studioGpuJob = { kind, command };
}

/**
 * Waits for this process's turn on the GPU, unless it holds the lease already, printing its place in the queue each
 * time it changes; returns the seconds this call waited. The lease is kept until releaseStudioGpuLease or exit.
 */
export async function acquireStudioGpuLease(): Promise<number> {
  if (heldLease) return 0;
  const asked = performance.now();
  takingLease ??= takeStudioGpuLease().finally(() => {
    takingLease = null;
  });
  await takingLease;
  return (performance.now() - asked) / 1000;
}

/** Gives the GPU back, and prints how long this process waited for it and drew, and whether anything drew beside it. */
export function releaseStudioGpuLease({ atExit = false }: { atExit?: boolean } = {}): void {
  if (heldLease && heldLease !== 'inside-parent') {
    const lease = heldLease;
    clearInterval(lease.sampler);
    noteStudioGpuSharing(lease);
    const line = `${studioGpuSummaryLine({ waitedMs: lease.waitedMs, ranMs: Date.now() - lease.grantedAt, sharedWith: [...lease.sharedWith.values()] })}\n`;
    // At exit only a synchronous write still reaches a pipe.
    if (atExit) writeSync(2, line);
    else process.stderr.write(line);
    delete process.env[STUDIO_GPU_PARENT_LEASE_ENV];
  }
  if (queuedTicketFile) rmSync(queuedTicketFile, { force: true });
  queuedTicketFile = null;
  heldLease = null;
}

async function takeStudioGpuLease(): Promise<void> {
  if (insideParentStudioGpuLease()) {
    heldLease = 'inside-parent';
    return;
  }
  const dir = studioGpuLeaseDir();
  mkdirSync(dir, { recursive: true });
  const arrived = Date.now();
  const ticket: StudioGpuTicket = {
    id: `${arrived}-${process.pid}`, pid: process.pid, started: Math.round(performance.timeOrigin), arrived,
    kind: studioGpuJob.kind, command: studioGpuJob.command, held: {},
  };
  const file = join(dir, `${ticket.id}.json`);
  writeStudioGpuTicket(file, ticket);
  queuedTicketFile = file;
  if (!releasesAtExit) {
    process.on('exit', () => releaseStudioGpuLease({ atExit: true }));
    releasesAtExit = true;
  }
  const granted = await askForStudioGpuSlots(file, ticket, '');
  const grantedAt = Date.now();
  if (granted.queued) process.stderr.write(`GPU: yours after ${formatStudioGpuSpan(grantedAt - arrived)}\n`);
  const lease: HeldStudioGpuLease = {
    file, ticket: granted.ticket, waitedMs: grantedAt - arrived, grantedAt, sharedWith: new Map(),
    sampler: setInterval(() => noteStudioGpuSharing(lease), STUDIO_GPU_SHARING_SAMPLE_MS).unref(),
  };
  noteStudioGpuSharing(lease);
  heldLease = lease;
  process.env[STUDIO_GPU_PARENT_LEASE_ENV] = file;
}

/**
 * Asks for `ticket`'s slots in turn until it holds every one its kind needs, printing its place in the queue each time
 * it changes (`told` keys the standing it last printed); returns the ticket holding them, and whether it queued.
 */
async function askForStudioGpuSlots(file: string, ticket: StudioGpuTicket, told: string): Promise<{ ticket: StudioGpuTicket; queued: boolean }> {
  const dir = dirname(file);
  const standing = studioGpuStanding(readOtherStudioGpuTickets(dir, ticket.id), ticket);
  if (standing.kind === 'running') return { ticket, queued: told !== '' };
  let telling = told;
  if (standing.kind === 'claim') {
    const claimed: StudioGpuTicket = { ...ticket, held: { ...ticket.held, [standing.slot]: Date.now() } };
    writeStudioGpuTicket(file, claimed);
    if (!readOtherStudioGpuTickets(dir, ticket.id).some((other) => other.held[standing.slot] !== undefined)) return askForStudioGpuSlots(file, claimed, told);
    // Another process took the slot as this one did: both give it back, and the queue's order picks one next time.
    writeStudioGpuTicket(file, ticket);
  } else {
    telling = [standing.slot, ...standing.ahead.map((t) => t.id), 'held', ...standing.holders.map((t) => t.id)].join(' ');
    if (telling !== told) process.stderr.write(`${studioGpuWaitingLine(standing, Date.now())}\n`);
  }
  // Jittered, so two processes that raced for a slot don't race again in step.
  await sleep(STUDIO_GPU_POLL_MS * (0.5 + Math.random()));
  return askForStudioGpuSlots(file, ticket, telling);
}

/** Notes each other process drawing now, holding every slot it needs, beside this one. */
function noteStudioGpuSharing(lease: HeldStudioGpuLease) {
  for (const other of readOtherStudioGpuTickets(dirname(lease.file), lease.ticket.id)) {
    if (studioGpuTicketRunning(other)) lease.sharedWith.set(other.id, other);
  }
}

// Written whole, then renamed over the ticket, so a reader never sees half of one.
function writeStudioGpuTicket(file: string, ticket: StudioGpuTicket) {
  const written = join(dirname(file), `.${basename(file)}.tmp`);
  writeFileSync(written, JSON.stringify(ticket));
  renameSync(written, file);
}

/** The ticket at `file`, or null when its process has just removed it. */
function readStudioGpuTicket(file: string): StudioGpuTicket | null {
  try {
    // SAFETY: a ticket file is only ever a whole StudioGpuTicket, written by writeStudioGpuTicket and renamed into place.
    return JSON.parse(readFileSync(file, 'utf8')) as StudioGpuTicket;
  } catch (error) {
    // SAFETY: node:fs throws ErrnoExceptions.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Every live ticket but `mine`. A dead process's ticket is removed as it's found. */
function readOtherStudioGpuTickets(dir: string, mine: string): StudioGpuTicket[] {
  return readdirSync(dir).flatMap((name) => {
    if (!name.endsWith('.json') || name === `${mine}.json`) return [];
    const file = join(dir, name), ticket = readStudioGpuTicket(file);
    if (!ticket) return [];
    if (studioGpuTicketProcessAlive(ticket)) return [ticket];
    rmSync(file, { force: true });
    return [];
  });
}

/** Whether a parent holding the lease started this process (its ticket in the environment, holding all it needs). */
function insideParentStudioGpuLease(): boolean {
  const file = process.env[STUDIO_GPU_PARENT_LEASE_ENV];
  const ticket = file ? readStudioGpuTicket(file) : null;
  return ticket !== null && processRunning(ticket.pid) && studioGpuTicketRunning(ticket);
}

/** Whether the process that wrote `ticket` still runs: its pid is alive, and started when the ticket says. */
function studioGpuTicketProcessAlive(ticket: StudioGpuTicket): boolean {
  if (!processRunning(ticket.pid)) return false;
  if (confirmedTicketIds.has(ticket.id)) return true;
  const started = processStartedAt(ticket.pid);
  if (started === null || Math.abs(started - ticket.started) > STUDIO_GPU_START_TOLERANCE_MS) return false;
  confirmedTicketIds.add(ticket.id);
  return true;
}

/** Signal 0 checks a pid without signalling it: ESRCH is no such process, EPERM one that isn't ours but runs. */
function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: process.kill throws ErrnoExceptions.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When `pid` started, ms since the epoch, as ps tells it (to the second); null once it's gone. */
function processStartedAt(pid: number): number | null {
  let started: string;
  try {
    started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  } catch {
    return null;
  }
  return started ? Date.parse(started) : null;
}
