// review-dashboard.ts: a project as the studio's front page, its own page and quick-open show it: its places (each
// file, each decision, the plan), the threads on each that wait on someone, and which places wait on the reviewer.
// Pure: the engine reads the files (engine/review-dashboard.ts) and hands the facts here.
//
// Negative space: the plan row carries its sign-offs, never which scenes are left to sign. That needs the storyboard
// resolved, which the long-running server never does: the browser works it out with reviewPlanSignoffs and hands it
// to reviewRowAwaitsYou.
import type { ProjectArtifact } from './review-artifact.ts';
import { reviewDecisionTopics } from './review-decisions.ts';
import type { ReviewPlanSignoffState } from './review-plan.ts';
import { reviewThreadTone, type ReviewDecision, type ReviewFile, type ReviewSignoff, type ReviewThread } from './review-threads.ts';

/**
 * Threads waiting on the agent (`open`: open or reopened), on the reviewer to verify a fix (`addressed`), and agent
 * questions (`asks`). Resolved and `keep` threads wait on no one and aren't counted.
 */
export type ReviewThreadCounts = { open: number; addressed: number; asks: number };

/** A file's picture: a still as it is, or a video's frame, which the review server cuts from those exact bytes. */
export type ReviewProjectThumbnail =
  | { kind: 'still'; path: string }
  | { kind: 'video'; path: string; hash: string; frame: number; fps: number };

/** Something in a project a reviewer opens. `project` gathers threads about the whole project or a place now gone. */
export type ReviewProjectPlace =
  | { on: 'file'; artifact: ProjectArtifact; thumbnail: ReviewProjectThumbnail }
  /** `at`: when it was signed off, or when the agent last posted it while it's open. */
  | { on: 'decision'; id: number; topic: string; question: string; state: ReviewDecision['state']; at: string }
  /** The plan's scene sign-offs, the last on each scene; `modified`: when storyboard.ts was last written. */
  | { on: 'plan'; signoffs: ReviewPlanSignoff[]; modified: string }
  | { on: 'project' };

export type ReviewProjectRow = ReviewProjectPlace & { threads: ReviewThreadCounts };

export type ReviewProjectSummary = {
  project: string;
  /** Its files newest first, then its decisions (open first), its plan, and threads with no place of their own. */
  rows: ReviewProjectRow[];
  /** Every thread in the project. */
  threads: ReviewThreadCounts;
  /** When review/review.json last changed (ISO), or null with no review yet. */
  reviewedAt: string | null;
  /** The later of its newest file and its last review: the dashboard's order. Null for a project with neither. */
  activeAt: string | null;
};

/** What the engine reads off disk for one project. */
export type ReviewProjectFacts = {
  project: string;
  /** Newest first, as listProjectArtifacts lists them. */
  files: readonly { artifact: ProjectArtifact; thumbnail: ReviewProjectThumbnail }[];
  review: ReviewFile;
  /** When storyboard.ts last changed (ISO); null for a project with no storyboard.ts. */
  plan: { modified: string } | null;
  reviewedAt: string | null;
};

const noThreads = (): ReviewThreadCounts => ({ open: 0, addressed: 0, asks: 0 });

function countThread(counts: ReviewThreadCounts, thread: ReviewThread) {
  const tone = reviewThreadTone(thread);
  if (tone === 'open' || tone === 'addressed' || tone === 'asks') counts[tone]++;
}

export type ReviewPlanSignoff = Extract<ReviewSignoff, { on: 'plan' }>;

function planRowOf(review: ReviewFile, { modified }: NonNullable<ReviewProjectFacts['plan']>): ReviewProjectRow {
  // ops.ts keeps one sign-off a scene, the newest.
  const signoffs = review.signoffs.filter((s): s is ReviewPlanSignoff => s.on === 'plan');
  return { on: 'plan', signoffs, modified, threads: noThreads() };
}

/**
 * The project's places with their threads. A video note counts on the newest video, where it places by its moment; a
 * still note on its still. A note whose place is gone counts on the project, so no waiting thread drops off.
 */
export function summarizeReviewProject({ project, files, review, plan, reviewedAt }: ReviewProjectFacts): ReviewProjectSummary {
  const fileRows: ReviewProjectRow[] = files.map((file) => ({ on: 'file', ...file, threads: noThreads() }));
  // A topic is one row, its threads gathered from every decision posted on it.
  const decisionRows = new Map<string, ReviewProjectRow>(reviewDecisionTopics(review.decisions)
    .map(({ id, topic, question, state, at, decided }): [string, ReviewProjectRow] => [topic, { on: 'decision', id, topic, question, state, at: decided?.at ?? at, threads: noThreads() }]));
  const topicOf = new Map(review.decisions.map((d) => [d.id, d.topic]));
  const planRow: ReviewProjectRow | null = plan === null ? null : planRowOf(review, plan);
  const projectRow: ReviewProjectRow = { on: 'project', threads: noThreads() };
  const newestVideo = fileRows.find((row) => row.on === 'file' && row.artifact.kind === 'video');
  const rowOf = (thread: ReviewThread): ReviewProjectRow => {
    const { anchor } = thread;
    switch (anchor.on) {
      case 'video': return newestVideo ?? projectRow;
      case 'still': return fileRows.find((row) => row.on === 'file' && row.artifact.path === anchor.writtenOn.path) ?? projectRow;
      case 'plan': return planRow ?? projectRow;
      case 'decision': return decisionRows.get(topicOf.get(anchor.decision) ?? '') ?? projectRow;
      default: return projectRow;
    }
  };
  const threads = noThreads();
  for (const thread of review.threads) {
    countThread(threads, thread);
    countThread(rowOf(thread).threads, thread);
  }
  const { open, addressed, asks } = projectRow.threads;
  const rows = [...fileRows, ...decisionRows.values(), ...(planRow ? [planRow] : []), ...(open + addressed + asks ? [projectRow] : [])];
  const newest = files[0]?.artifact.modified ?? null;
  const activeAt = [newest, reviewedAt].filter((at) => at !== null).toSorted().at(-1) ?? null;
  return { project, rows, threads, reviewedAt, activeAt };
}

/** A plan scene's sign-off state, as reviewPlanSignoffs works it out from the resolved storyboard. */
export type ReviewPlanSceneSignoff = { state: ReviewPlanSignoffState };

/**
 * True when the row waits on the reviewer: a fix to verify, an agent's question, an open decision, or a plan scene
 * unsigned or changed since signed off. `planSignoffs` are the plan's scenes (see the header), null until its
 * storyboard resolves or when it can't: a plan with no known scenes waits on no one.
 */
export function reviewRowAwaitsYou(row: ReviewProjectRow, planSignoffs: readonly ReviewPlanSceneSignoff[] | null): boolean {
  if (row.threads.addressed + row.threads.asks > 0) return true;
  if (row.on === 'decision') return row.state === 'open';
  if (row.on !== 'plan') return false;
  return planSignoffs?.some((s) => s.state === 'unsigned' || s.state === 'stale') ?? false;
}
