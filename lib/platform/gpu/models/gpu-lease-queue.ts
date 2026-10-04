// gpu-lease-queue.ts: who takes the machine's one GPU next, from the tickets queued or holding processes wrote
// (lib/platform/gpu/engine/gpu-lease.ts). Pure, so every process reading the same tickets decides alike.
//
// Two slots, interactive (a look, a still, a paint solve) and batch (a render, a profile): two renders never share the
// adapter, and a look never waits for a render. Each slot goes to its queue in arrival order, never preempted. The
// GPU gate takes the batch slot in turn, then queues for the interactive one from then: looks queued earlier go first,
// later ones wait, so looks can't starve it.

/** What a job is to the queue: interactive and batch take one slot each; exclusive (the GPU gate) takes both. */
export type StudioGpuJobKind = 'interactive' | 'batch' | 'exclusive';
export type StudioGpuSlot = 'interactive' | 'batch';

/** One process's place in the queue, as its ticket file holds it. */
export type StudioGpuTicket = {
  /** `<arrived>-<pid>`, its file's name. */
  readonly id: string;
  readonly pid: number;
  /** When the process started, ms since the epoch: a later process given the same pid isn't this one. */
  readonly started: number;
  /** When it joined the queue, ms since the epoch. */
  readonly arrived: number;
  readonly kind: StudioGpuJobKind;
  /** What it is, as another process's wait names it: `studio render heron-at-dusk`. */
  readonly command: string;
  /** Each slot it holds, by when it took it (ms since the epoch). */
  readonly held: Readonly<Partial<Record<StudioGpuSlot, number>>>;
};

/** Where a ticket stands: holding all it needs, free to take its next slot, or waiting on holders and those ahead. */
export type StudioGpuStanding =
  | { readonly kind: 'running' }
  | { readonly kind: 'claim'; readonly slot: StudioGpuSlot }
  | { readonly kind: 'waiting'; readonly slot: StudioGpuSlot; readonly holders: readonly StudioGpuTicket[]; readonly ahead: readonly StudioGpuTicket[] };

// The gate's order matters: it takes the batch slot first, then queues for the interactive one.
const STUDIO_GPU_SLOTS_OF_KIND: Readonly<Record<StudioGpuJobKind, readonly StudioGpuSlot[]>> = {
  interactive: ['interactive'],
  batch: ['batch'],
  exclusive: ['batch', 'interactive'],
};

/** The slot `ticket` asks for next, or null once it holds every slot its kind needs. */
export const studioGpuNextSlot = (ticket: StudioGpuTicket): StudioGpuSlot | null =>
  STUDIO_GPU_SLOTS_OF_KIND[ticket.kind].find((slot) => ticket.held[slot] === undefined) ?? null;

/** Whether `ticket` holds every slot its kind needs: it's drawing, or free to. */
export const studioGpuTicketRunning = (ticket: StudioGpuTicket) => studioGpuNextSlot(ticket) === null;

/** When `ticket` joined `slot`'s queue, or undefined when it isn't queued for it. */
function queuedForSlotSince(ticket: StudioGpuTicket, slot: StudioGpuSlot): number | undefined {
  if (studioGpuNextSlot(ticket) !== slot) return undefined;
  return slot === 'interactive' && ticket.kind === 'exclusive' ? ticket.held.batch : ticket.arrived;
}

/** `ticket`'s standing among `others`, the other live tickets. Ties in arrival go by id, so every reader agrees. */
export function studioGpuStanding(others: readonly StudioGpuTicket[], ticket: StudioGpuTicket): StudioGpuStanding {
  const slot = studioGpuNextSlot(ticket);
  if (slot === null) return { kind: 'running' };
  const mine = queuedForSlotSince(ticket, slot)!;
  const holders = others.filter((other) => other.held[slot] !== undefined);
  const ahead = others.flatMap((other) => {
    const since = queuedForSlotSince(other, slot);
    return since !== undefined && (since < mine || (since === mine && other.id < ticket.id)) ? [{ other, since }] : [];
  }).toSorted((a, b) => a.since - b.since || (a.other.id < b.other.id ? -1 : 1)).map(({ other }) => other);
  return holders.length || ahead.length ? { kind: 'waiting', slot, holders, ahead } : { kind: 'claim', slot };
}

/** A span as the lease prints it: `52s`, `4m10s`, `1h02m`. */
export function formatStudioGpuSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

const STUDIO_GPU_COMMAND_WIDTH = 72;

/** A ticket as another process's line names it: its command, cut to a line's share, and its pid. */
export function studioGpuTicketName({ command, pid }: StudioGpuTicket): string {
  const shown = command.length > STUDIO_GPU_COMMAND_WIDTH ? `${command.slice(0, STUDIO_GPU_COMMAND_WIDTH - 1)}…` : command;
  return `${shown} (pid ${pid})`;
}

const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'];
const ordinal = (n: number) => `${n}${(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 'th' : ORDINAL_SUFFIXES[n % 10]}`;

/** What a waiting process prints: its place in its slot's queue, who's ahead, and who holds the slot since when. */
export function studioGpuWaitingLine(standing: Extract<StudioGpuStanding, { kind: 'waiting' }>, now: number): string {
  const { slot, holders, ahead } = standing;
  const place = ahead.length ? `${ordinal(ahead.length + 1)} in line for the ${slot} slot, behind ${ahead.map(studioGpuTicketName).join(', ')}` : `next for the ${slot} slot`;
  const held = holders.map((holder) => `${studioGpuTicketName(holder)} for ${formatStudioGpuSpan(now - holder.held[slot]!)}`);
  return `GPU: ${place}${held.length ? `; held by ${held.join(', ')}` : ''}`;
}

/** What a process prints when it gives the GPU back: how long it waited and drew, and whether anything drew beside it. */
export function studioGpuSummaryLine({ waitedMs, ranMs, sharedWith }: { waitedMs: number; ranMs: number; sharedWith: readonly StudioGpuTicket[] }): string {
  const beside = sharedWith.length ? `sharing with ${sharedWith.map(studioGpuTicketName).join(', ')}` : 'alone';
  return `GPU: waited ${formatStudioGpuSpan(waitedMs)}, ran ${formatStudioGpuSpan(ranMs)}, ${beside}`;
}
