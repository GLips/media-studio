// review-watch.ts: `studio review watch`, the call an agent leaves running in the background to be woken by the
// reviewer. It blocks until the reviewer changes something past the agent's cursor, waits for the burst to settle, and
// returns what changed. The agent's own writes and `keep` threads never wake it.
//
// One watcher per project. Its state is out/.review/watch.json (git-ignored with out/): the cursor, so a run never
// repeats or misses what the last showed, and a heartbeat the page reads as the agent's presence. Two agents watching
// one project would race on its replies, so there's no name to keep a second cursor by.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setInterval as every } from 'node:timers/promises';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import type { ReviewDecision, ReviewFile, ReviewThread } from '../models/review-threads.ts';
import { readReviewFile } from './review-file.ts';

const REVIEW_WATCH_POLL_MS = 300;
const REVIEW_WATCH_BEAT_MS = 5000;
/** A heartbeat older than this means the agent stopped watching. */
const REVIEW_WATCH_FRESH_MS = 15_000;

/** A watcher's saved state: its cursor (a file revision), when it began watching and its last heartbeat (ISO). */
type ReviewWatchState = { cursor: number; since: string; beat: string };

const reviewWatchFileOf = (projectDir: string) => join(projectDir, 'out', '.review', 'watch.json');

function readReviewWatchState(file: string): ReviewWatchState | undefined {
  // SAFETY: only this module writes watch files.
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as ReviewWatchState : undefined;
}

const beatIsFresh = (state: ReviewWatchState, now: number) => now - Date.parse(state.beat) < REVIEW_WATCH_FRESH_MS;

/** The agent watching the project now, with when it began; none when its heartbeat isn't fresh. */
export function readReviewWatchPresence(projectDir: string): { since: string } | undefined {
  const state = readReviewWatchState(reviewWatchFileOf(projectDir));
  return state && beatIsFresh(state, Date.now()) ? { since: state.since } : undefined;
}

/** Whether the reviewer touched `thread` after `cursor`: wrote it, edited it, replied, resolved or reopened. */
const reviewerChangedThread = (thread: ReviewThread, cursor: number) =>
  thread.kind !== 'keep' && thread.entries.some((entry) => entry.author === 'reviewer' && entry.rev > cursor);

// Verdicts and sign-off are the reviewer's alone; an agent re-posting a judged decision also moves its rev and keeps
// the verdicts, so that wakes the watch too, harmlessly.
const reviewerChangedDecision = (decision: ReviewDecision, cursor: number) =>
  decision.rev > cursor && (decision.state !== 'open' || decision.candidates.some((c) => c.verdict));

function reviewerChangesOf(file: ReviewFile, cursor: number) {
  return { threads: file.threads.filter((t) => reviewerChangedThread(t, cursor)), decisions: file.decisions.filter((d) => reviewerChangedDecision(d, cursor)) };
}

export type ReviewWatchOptions = {
  projectDir: string;
  /** Quiet after the first change before returning, so a burst of notes comes back as one. */
  settleMs: number;
  timeoutMs?: number;
};

/** What the reviewer changed: threads as stored, for the caller to place on the render it hands off. */
export type ReviewWatchChange = { revision: number; changed: ReviewThread[]; decisions: ReviewDecision[] };

/**
 * Waits for the reviewer's next change past the cursor, then for `settleMs` with none newer, and returns everything
 * they changed since the cursor, saving the cursor past it. On `timeoutMs` with no change, returns the cursor.
 */
export async function waitForReviewChange({ projectDir, settleMs, timeoutMs }: ReviewWatchOptions): Promise<ReviewWatchChange | { timeout: number }> {
  const stateFile = reviewWatchFileOf(projectDir), saved = readReviewWatchState(stateFile);
  const startedAt = Date.now();
  const watchingSince = saved && beatIsFresh(saved, startedAt) ? saved.since : new Date(startedAt).toISOString();
  const cursor = saved?.cursor ?? 0;
  const beat = (now: number, at: number) => {
    const state: ReviewWatchState = { cursor: at, since: watchingSince, beat: new Date(now).toISOString() };
    replaceFileWhole(stateFile, JSON.stringify(state));
    return now;
  };

  // `newest` is the newest reviewer revision seen and `newestAt` when: the burst has settled once nothing newer comes
  // for settleMs.
  let newest = 0, newestAt = 0, lastBeat = 0;
  const poll = (): ReviewWatchChange | { timeout: number } | undefined => {
    const now = Date.now(), file = readReviewFile(projectDir), { threads, decisions } = reviewerChangesOf(file, cursor);
    const latest = Math.max(0, ...threads.flatMap((t) => t.entries.map((e) => (e.author === 'reviewer' ? e.rev : 0))), ...decisions.map((d) => d.rev));
    if (latest > newest) [newest, newestAt] = [latest, now];
    const settled = newest > 0 && now - newestAt >= settleMs;
    if (settled && (threads.length || decisions.length)) {
      beat(now, file.revision);
      return { revision: file.revision, changed: threads, decisions };
    }
    // What woke it can be gone by the time the burst settles (a note resolved, then cleared): with nothing left to
    // hand off, it goes back to waiting rather than waking the agent for nothing.
    if (settled) [newest, newestAt] = [0, 0];
    if (!newest && timeoutMs !== undefined && now - startedAt >= timeoutMs) {
      beat(now, cursor);
      return { timeout: cursor };
    }
    if (now - lastBeat >= REVIEW_WATCH_BEAT_MS) lastBeat = beat(now, cursor);
    return undefined;
  };
  // A loop over a timer, not a poll that awaits itself: a watch left running for hours holds no growing promise chain.
  const first = poll();
  if (first) return first;
  for await (const _tick of every(REVIEW_WATCH_POLL_MS)) {
    const polled = poll();
    if (polled) return polled;
  }
  throw new Error('the watch timer ended');
}
