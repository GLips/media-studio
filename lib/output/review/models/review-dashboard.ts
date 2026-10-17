// review-dashboard.ts: a project as the studio's front page, its own page and quick-open show it: its places (each
// file, each decision, the plan), the threads on each that wait on someone, and which places wait on the reviewer.
// Pure: the engine reads the files (engine/review-dashboard.ts) and hands the facts here.
//
// Negative space: the plan row carries its sign-offs, never which scenes are left to sign. That needs the storyboard
// resolved, which the long-running server never does: the browser works it out with reviewPlanSignoffs and hands it
// to reviewRowAwaitsYou. A plan never handed over (`studio review open --plan`) waits only on its stale scenes.
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
  /**
   * The plan's scene sign-offs, the last on each scene; `modified`: when storyboard.ts was last written;
   * `handedOverAt`: when the agent last handed it over, null until it has.
   */
  | { on: 'plan'; signoffs: ReviewPlanSignoff[]; modified: string; handedOverAt: string | null }
  | { on: 'project' };

export type ReviewProjectRow = ReviewProjectPlace & { threads: ReviewThreadCounts };

/** Where a thread is read: the file, decision topic or plan it places on, or the project for notes with no place. */
export type ReviewThreadPlace = { on: 'file'; path: string } | { on: 'decision'; topic: string } | { on: 'plan' } | { on: 'project' };

/** A waiting state's first thread (the lowest id) and where it's read, which the project header's count links to. */
export type ReviewFirstThread = { id: number; place: ReviewThreadPlace };

export type ReviewProjectSummary = {
  project: string;
  /** Its files newest first, then its decisions (open first), its plan, and threads with no place of their own. */
  rows: ReviewProjectRow[];
  /** Every thread in the project. */
  threads: ReviewThreadCounts;
  /** Each waiting state's first thread; a state with none is absent. */
  firstThreads: Partial<Record<keyof ReviewThreadCounts, ReviewFirstThread>>;
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

const waitingToneOf = (thread: ReviewThread): keyof ReviewThreadCounts | null => {
  const tone = reviewThreadTone(thread);
  return tone === 'open' || tone === 'addressed' || tone === 'asks' ? tone : null;
};

function placeOfRow(row: ReviewProjectRow): ReviewThreadPlace {
  switch (row.on) {
    case 'file': return { on: 'file', path: row.artifact.path };
    case 'decision': return { on: 'decision', topic: row.topic };
    case 'plan': return { on: 'plan' };
    default: return { on: 'project' };
  }
}

export type ReviewPlanSignoff = Extract<ReviewSignoff, { on: 'plan' }>;

function planRowOf(review: ReviewFile, { modified }: NonNullable<ReviewProjectFacts['plan']>): ReviewProjectRow {
  // ops.ts keeps one sign-off a scene, the newest.
  const signoffs = review.signoffs.filter((s): s is ReviewPlanSignoff => s.on === 'plan');
  return { on: 'plan', signoffs, modified, handedOverAt: review.planHandover?.at ?? null, threads: noThreads() };
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
  const firstThreads: ReviewProjectSummary['firstThreads'] = {};
  for (const thread of review.threads.toSorted((a, b) => a.id - b.id)) {
    const tone = waitingToneOf(thread);
    if (tone === null) continue;
    const row = rowOf(thread);
    threads[tone]++;
    row.threads[tone]++;
    firstThreads[tone] ??= { id: thread.id, place: placeOfRow(row) };
  }
  const { open, addressed, asks } = projectRow.threads;
  const rows = [...fileRows, ...decisionRows.values(), ...(planRow ? [planRow] : []), ...(open + addressed + asks ? [projectRow] : [])];
  const newest = files[0]?.artifact.modified ?? null;
  const activeAt = [newest, reviewedAt].filter((at) => at !== null).toSorted().at(-1) ?? null;
  return { project, rows, threads, firstThreads, reviewedAt, activeAt };
}

/** A plan scene's sign-off state, as reviewPlanSignoffs works it out from the resolved storyboard. */
export type ReviewPlanSceneSignoff = { state: ReviewPlanSignoffState };

type ReviewPlanRow = Extract<ReviewProjectRow, { on: 'plan' }>;

/**
 * True when the plan's scenes wait on the reviewer: one changed since signed off, or, once the agent has handed the
 * plan over, one not yet signed. `planSignoffs` are the plan's scenes, null until its storyboard resolves or when it
 * can't: a plan with no known scenes waits on no one.
 */
export function reviewPlanScenesAwaitYou(row: ReviewPlanRow, planSignoffs: readonly ReviewPlanSceneSignoff[] | null): boolean {
  return planSignoffs?.some((s) => s.state === 'stale' || (row.handedOverAt !== null && s.state === 'unsigned')) ?? false;
}

/**
 * False when the plan's scenes can't wait whatever its storyboard says: never handed over and nothing signed. The
 * browser skips resolving such a storyboard.
 */
export const reviewPlanMayAwaitYou = (row: ReviewPlanRow): boolean => row.handedOverAt !== null || row.signoffs.length > 0;

/**
 * True when the row waits on the reviewer: a fix to verify, an agent's question, an open decision, or a plan whose
 * scenes do (reviewPlanScenesAwaitYou).
 */
export function reviewRowAwaitsYou(row: ReviewProjectRow, planSignoffs: readonly ReviewPlanSceneSignoff[] | null): boolean {
  if (row.threads.addressed + row.threads.asks > 0) return true;
  if (row.on === 'decision') return row.state === 'open';
  return row.on === 'plan' && reviewPlanScenesAwaitYou(row, planSignoffs);
}

/**
 * How many things in the project wait on the reviewer, as the tab title counts them: agent questions, addressed notes,
 * open decisions, and the plan when its scenes wait. A plan waiting only on its threads counts them, not itself.
 */
export function reviewProjectWaitingCount(summary: ReviewProjectSummary, planSignoffs: readonly ReviewPlanSceneSignoff[] | null): number {
  const decisions = summary.rows.filter((row) => row.on === 'decision' && row.state === 'open').length;
  const plan = summary.rows.find((row) => row.on === 'plan');
  const planWaits = plan?.on === 'plan' && reviewPlanScenesAwaitYou(plan, planSignoffs) ? 1 : 0;
  return summary.threads.asks + summary.threads.addressed + decisions + planWaits;
}

/**
 * The project page's rungs, in its order after the plan, decisions and project notes: a video made as the animatic
 * (named `animatic` in out/wip/), a cut (`out/video*`), a delivered still (out/stills/, out/still-sheets/). The rest
 * is `older`: check frames, probes and test renders, which the page folds away.
 */
export type ProjectPageRung = 'animatic' | 'cut' | 'stills' | 'older';

/** A file's rung on its project's page, by its path in the project. */
export function projectPageRungOf(path: string): ProjectPageRung {
  const slash = path.lastIndexOf('/'), folder = path.slice(0, slash + 1), name = path.slice(slash + 1);
  const video = /\.(mp4|webm|mov)$/i.test(name);
  if (folder === 'out/wip/' && video && name.includes('animatic')) return 'animatic';
  if (folder === 'out/' && video && name.startsWith('video')) return 'cut';
  if (folder === 'out/stills/' || folder === 'out/still-sheets/') return 'stills';
  return 'older';
}
