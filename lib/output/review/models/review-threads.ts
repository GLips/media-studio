// review-threads.ts: review/review.json, the one file a project's review lives in: its threads (notes on a render, a
// still, the script, a decision or the whole project, each with its replies), the decisions an agent posts for the
// reviewer to choose, and the reviewer's sign-offs.
//
// The file changes only through ops (review-ops.ts), each bumping `revision`, so the page and an agent's `watch` learn
// of a change by one number. Where a thread shows on a render is worked out on read (review-placement.ts), never stored.
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import type { ReviewMediaKind } from './review-context.ts';
import type { ReviewMoment } from './review-moment.ts';

export const REVIEW_FILE_VERSION = 1;

/** Set by the channel, never by the op: the page writes as the reviewer, the CLI as the agent. */
export type ReviewAuthor = 'reviewer' | 'agent';
export type ReviewThreadState = 'open' | 'addressed' | 'resolved' | 'reopened';
/** `keep` is a standing constraint: listed with every hand-off, but never work for the agent to address. */
export type ReviewThreadKind = 'fix' | 'question' | 'keep';

export type ReviewFile = {
  version: typeof REVIEW_FILE_VERSION;
  /** +1 per applied op: what `watch` keeps its cursor by and the page polls. */
  revision: number;
  /** Short ids, shared by threads and decisions, so `#12` names one thing. */
  nextId: number;
  threads: ReviewThread[];
  decisions: ReviewDecision[];
  signoffs: ReviewSignoff[];
};

export type ReviewThread = {
  id: number;
  kind: ReviewThreadKind;
  state: ReviewThreadState;
  /** The file revision this thread last changed at. */
  rev: number;
  anchor: ReviewAnchor;
  /** entries[0] is the note itself; its `rev` is when its text, kind or anchor last changed. */
  entries: ReviewEntry[];
};

/** A commit as the CLI resolves `--commit HEAD`: hashes, so it stays meaningful after the branch moves. */
export type ReviewEntryCommit = { engine: string; workspace?: string };

export type ReviewEntry = {
  author: ReviewAuthor;
  text: string;
  at: string;
  rev: number;
  commit?: ReviewEntryCommit;
  /**
   * The render the agent says shows the fix, by its path and the hash of its bytes then. A slice (render --scene) is
   * laid into the cut over its frames where it fits (render-splice.ts); a cut replaces the one open.
   */
  render?: ReviewEntryRender;
  transition?: Exclude<ReviewThreadState, 'open'>;
  /** An agent's question: the thread waits on the reviewer. */
  asks?: true;
};

/** A render a reply points at: its path in the project and its bytes' hash, as `writtenOn` names a note's. */
export type ReviewEntryRender = { path: string; hash: string };

/** 0–1 across the frame. */
export type ReviewPoint = { x: number; y: number };
/** A drawing on the frame, in 0–1 frame coordinates; `ellipse` radii are fractions of the frame's width and height. */
export type ReviewMark =
  | { kind: 'arrow'; from: ReviewPoint; to: ReviewPoint }
  | { kind: 'ellipse'; c: ReviewPoint; rx: number; ry: number }
  | { kind: 'path'; points: ReviewPoint[] };

/** One repository's commit, and whether its working tree had changes then: the render snapshot's `source` halves. */
export type ReviewSourceCommit = { commit: string; dirty: boolean };
/** What a render was made from, copied from its snapshot. */
export type ReviewRenderSource = { engine: ReviewSourceCommit; workspace: ReviewSourceCommit | null };

/** The render a note was written on. Never rewritten, so a carried note can't pass for one written on this render. */
export type ReviewWrittenOn = { path: string; hash: string; commit?: ReviewRenderSource };

/**
 * What a thread is about. `image` is the frame as the reviewer saw it, marks burned in (`review/frames/<id>.jpg|png`
 * in the project); a thread an agent opens has none. A video note's `frame` is on its `writtenOn` render's own clock.
 */
export type ReviewAnchor =
  | {
    on: 'video'; writtenOn: ReviewWrittenOn; frame: number; end?: number; point?: ReviewPoint; marks?: ReviewMark[];
    cue?: string; moment?: ReviewMoment; image?: string;
  }
  | { on: 'still'; writtenOn: ReviewWrittenOn; point?: ReviewPoint; marks?: ReviewMark[]; cell?: string; image?: string }
  | { on: 'script'; scriptHash: string; line: string; word?: number; wordEnd?: number; text?: string; take?: string }
  /** `at`: seconds into a sound or video candidate on the decision's shared transport, where the note was written. */
  | { on: 'decision'; decision: number; candidate?: string; at?: number }
  | { on: 'project' };

export type ReviewCandidate = {
  /** 'a', 'b', … */
  key: string;
  label: string;
  /** Project-relative; `hash` is its bytes' when posted, so a file changed since shows as stale. */
  media?: { path: string; kind: ReviewMediaKind | 'audio'; hash: string };
  text?: string;
  /** Model, seed, cost, voice, prompt: shown as is. */
  meta: Readonly<Record<string, string | number>>;
  verdict?: 'pick' | 'reject';
};

export type ReviewDecision = {
  id: number;
  topic: string;
  question: string;
  choose: 'one' | 'many';
  state: 'open' | 'decided';
  rev: number;
  at: string;
  about?: { scene?: string; moment?: ReviewMoment; line?: string };
  candidates: ReviewCandidate[];
  /** The reviewer's sign-off. */
  decided?: { picks: string[]; at: string };
};

/** A script sign-off holds the script's hash (review-script.ts), so an edited script reads as unsigned. */
export type ReviewSignoff =
  | { on: 'script'; hash: string; at: string }
  | { on: 'render'; path: string; hash: string; rung?: SceneRung; at: string };

export const emptyReviewFile = (): ReviewFile => ({ version: REVIEW_FILE_VERSION, revision: 0, nextId: 1, threads: [], decisions: [], signoffs: [] });

/**
 * Every render hash the review points at: the renders notes were written on, the renders replies say show a fix, and
 * decision candidates' files. A render archive keeps these whatever its age.
 */
export function reviewReferencedHashes(file: ReviewFile): Set<string> {
  return new Set([
    ...file.threads.flatMap(({ anchor }) => (anchor.on === 'video' || anchor.on === 'still' ? [anchor.writtenOn.hash] : [])),
    ...file.threads.flatMap(({ entries }) => entries.flatMap((e) => (e.render ? [e.render.hash] : []))),
    ...file.decisions.flatMap((d) => d.candidates.flatMap((c) => (c.media ? [c.media.hash] : []))),
  ]);
}

/**
 * A thread's state as every surface marks it, one tone per thread: resolved and `keep` wait on no one; an agent's
 * question (even on an addressed note) and a fix to verify wait on the reviewer; open and reopened on the agent.
 */
export type ReviewThreadTone = 'open' | 'addressed' | 'asks' | 'keep' | 'resolved';

export function reviewThreadTone(thread: Pick<ReviewThread, 'kind' | 'state' | 'entries'>): ReviewThreadTone {
  if (thread.state === 'resolved') return 'resolved';
  if (thread.kind === 'keep') return 'keep';
  if (thread.entries.at(-1)?.asks) return 'asks';
  return thread.state === 'addressed' ? 'addressed' : 'open';
}

/** Each tone's glyph and the word its tooltip says, the same on every surface. */
export const REVIEW_THREAD_TONES: Readonly<Record<ReviewThreadTone, { glyph: string; word: string }>> = {
  open: { glyph: '●', word: 'open' },
  addressed: { glyph: '◐', word: 'addressed, to verify' },
  asks: { glyph: '?', word: 'agent asks' },
  keep: { glyph: '◇', word: 'keep' },
  resolved: { glyph: '✓', word: 'resolved' },
};

/** How many of `threads` are in each tone. */
export function countReviewThreadTones(threads: readonly Pick<ReviewThread, 'kind' | 'state' | 'entries'>[]): Record<ReviewThreadTone, number> {
  const counts: Record<ReviewThreadTone, number> = { open: 0, addressed: 0, asks: 0, keep: 0, resolved: 0 };
  for (const thread of threads) counts[reviewThreadTone(thread)]++;
  return counts;
}
