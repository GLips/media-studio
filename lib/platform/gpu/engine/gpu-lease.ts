// gpu-lease.ts: the studio's GPU lease. Every process that draws on the machine's one adapter takes it first, at
// inRenderBrowser (lib/platform/browser/engine/render-browser.ts), and keeps it until its job ends (runAsStudioGpuJob)
// or it gives it back early, so a command's passes run back to back. Node only.
//
// A process queues with a ticket file, `<arrived>-<pid>.json`, in the studio's user cache, shared by every checkout;
// who goes next is gpu-lease-queue.ts's rule. A ticket counts while its process runs (lib/platform/process), so a
// killed job frees its slot at once. A slot is taken by writing it into the ticket, then reading the others': if
// another took it too, it's given back and asked for again. A holder's child draws inside its lease.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runningStudioProcesses, studioProcessRunning, thisStudioProcess } from '#lib/platform/process/engine/studio-process.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import {
  studioGpuStanding, studioGpuSummaryLine, studioGpuTicketRunning, studioGpuWaitingLine, formatStudioGpuSpan,
  type StudioGpuJobKind, type StudioGpuTicket,
} from '../models/gpu-lease-queue.ts';

/** Names the ticket of the lease a parent holds, in the environment its children inherit. */
const STUDIO_GPU_PARENT_LEASE_ENV = 'STUDIO_GPU_LEASE_TICKET';
const STUDIO_GPU_POLL_MS = 500;
/** How often a holder notes who draws beside it, for its summary. */
const STUDIO_GPU_SHARING_SAMPLE_MS = 2000;

/** The ticket folder: STUDIO_GPU_LEASE_DIR when set (a test's own queue), else the studio's user cache. */
const studioGpuLeaseDir = () => process.env.STUDIO_GPU_LEASE_DIR || studioUserCacheDir('gpu-lease');

type HeldStudioGpuLease = { file: string; ticket: StudioGpuTicket; waitedMs: number; grantedAt: number; sharedWith: Map<string, StudioGpuTicket>; sampler: NodeJS.Timeout };

/** What a process is to the queue: its kind, and what other processes' waits call it. */
export type StudioGpuJob = { readonly kind: StudioGpuJobKind; readonly command: string };

// Outside runAsStudioGpuJob, a process is its script and arguments, interactive: a test, a project's tool.
let studioGpuJob: StudioGpuJob = {
  kind: 'interactive', command: [basename(process.argv[1] ?? 'node'), ...process.argv.slice(2)].join(' '),
};
let queuedTicketFile: string | null = null;
let heldLease: HeldStudioGpuLease | 'inside-parent' | null = null;
let takingLease: Promise<void> | null = null;
let releasesAtExit = false;

/**
 * Runs `run` as `job`: whatever it draws queues as `job`, and the GPU goes back when `run` ends, however it ends. Each
 * entry point runs its whole command in one (cli/studio.ts, harness/run-harness-command.ts).
 */
export async function runAsStudioGpuJob<T>(job: StudioGpuJob, run: () => Promise<T>): Promise<T> {
  studioGpuJob = job;
  try {
    return await run();
  } finally {
    giveBackStudioGpuLease(false);
  }
}

/**
 * Waits for this process's turn on the GPU, unless it holds the lease already, printing its place in the queue each
 * time it changes; returns the seconds this call waited. The lease is kept until the job ends, releaseStudioGpuLease or
 * exit.
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

/**
 * Gives the GPU back before the job ends, for a command whose last stretch doesn't draw (a render session's doneDrawing).
 * It prints how long this process waited for the GPU and drew, and whether anything drew beside it.
 */
export const releaseStudioGpuLease = (): void => giveBackStudioGpuLease(false);

/** Gives the lease back, printing the holder's summary, or leaves the queue. */
function giveBackStudioGpuLease(atExit: boolean): void {
  if (heldLease && heldLease !== 'inside-parent') {
    const lease = heldLease;
    clearInterval(lease.sampler);
    noteStudioGpuSharing(lease);
    const line = `${studioGpuSummaryLine({ waitedMs: lease.waitedMs, ranMs: Date.now() - lease.grantedAt, sharedWith: [...lease.sharedWith.values()] })}\n`;
    if (atExit) writeStudioGpuSummaryAtExit(line);
    else process.stderr.write(line);
    delete process.env[STUDIO_GPU_PARENT_LEASE_ENV];
  }
  if (queuedTicketFile) rmSync(queuedTicketFile, { force: true });
  queuedTicketFile = null;
  heldLease = null;
}

/**
 * At exit only a synchronous write still reaches a pipe. One whose reader has gone (EPIPE) or a hung-up terminal (EIO)
 * throws, and a throwing 'exit' listener stops those after it, Remotion's browser kill among them; the summary is lost.
 */
function writeStudioGpuSummaryAtExit(line: string): void {
  try {
    writeSync(2, line);
  } catch {
    // Nothing reads stderr any more.
  }
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
    id: `${arrived}-${process.pid}`, ...thisStudioProcess(), arrived, kind: studioGpuJob.kind, command: studioGpuJob.command, held: {},
  };
  const file = join(dir, `${ticket.id}.json`);
  writeStudioGpuTicket(file, ticket);
  queuedTicketFile = file;
  if (!releasesAtExit) {
    process.on('exit', () => giveBackStudioGpuLease(true));
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
  const tickets = readdirSync(dir).flatMap((name) => {
    if (!name.endsWith('.json') || name === `${mine}.json`) return [];
    const file = join(dir, name), ticket = readStudioGpuTicket(file);
    return ticket ? [{ file, ticket }] : [];
  });
  const live = new Set(runningStudioProcesses(tickets.map(({ ticket }) => ticket)));
  for (const { file, ticket } of tickets) if (!live.has(ticket)) rmSync(file, { force: true });
  return [...live];
}

/** Whether a parent holding the lease started this process (its ticket in the environment, holding all it needs). */
function insideParentStudioGpuLease(): boolean {
  const file = process.env[STUDIO_GPU_PARENT_LEASE_ENV];
  const ticket = file ? readStudioGpuTicket(file) : null;
  return ticket !== null && studioProcessRunning(ticket) && studioGpuTicketRunning(ticket);
}
