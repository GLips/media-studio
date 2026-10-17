// review-handoff.ts: the review as the CLI hands it to an agent and takes its answers back. `studio review notes` and
// `watch` place threads on one render (the newest cut unless named, with the reply slices laid into it) and plan notes
// on the storyboard, and print them with everything needed to find and see each; `reply`, `ask` and `decide` turn the
// agent's flags into ops: a commit resolved to hashes, an anchor with the moment or quote it's at, a candidate with
// its file's hash. The page builds the same ops from what it has on screen.
//
// The storyboard is imported here because the CLI runs in a short-lived process; the app server never imports it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { readProjectStoryboard } from '#lib/output/render/engine/project-clock.ts';
import { formatRenderVersionName, newestProjectCut } from '#lib/output/render/engine/render-cuts.ts';
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { projectSceneSourceFile, STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';
import { formatReviewDecisionsMarkdown } from '../models/review-decision-markdown.ts';
import { formatReviewThreadsMarkdown, type ReviewMarkdownOptions, type ReviewMarkdownStill } from '../models/review-markdown.ts';
import { REVIEW_FALLBACK_FPS } from '../models/review-context.ts';
import type { NewAnchor, NewDecision } from '../models/review-ops.ts';
import { placeReviewThread, reviewVideoAnchorAt, type PlacedReviewThread, type ReviewPlacement, type ReviewPlacementTarget } from '../models/review-placement.ts';
import { reviewPlanNotePlacementOf, storyboardPlanHash } from '../models/review-plan.ts';
import type { ReviewCandidate, ReviewDecision, ReviewEntryCommit, ReviewPlanAnchor, ReviewPlanField, ReviewThread, ReviewThreadState } from '../models/review-threads.ts';
import { projectFolderNamed, projectMediaTypeOf, projectPathOf, resolveProjectMedia } from './project-media.ts';
import { readReviewArtifact, reviewPlacementTargetOf, reviewStillSizeOf } from './review-artifact.ts';
import { readReviewSplices } from './review-splices.ts';

/**
 * The file `--render` names (a path in the project), or the project's newest cut: never a slice, which shows only the
 * frames it was rendered for. Undefined when nothing is rendered yet: a plan's notes need no render.
 */
export function reviewHandoffRenderOf(project: string, render: string | undefined): string | undefined {
  if (render !== undefined) {
    resolveProjectMedia(project, render);
    return render;
  }
  return newestProjectCut(projectFolderNamed(project))?.path;
}

/** One render's hand-off: what threads are placed on and the markdown's options for it; no target before a render. */
export type ReviewHandoff = { project: string; target: ReviewPlacementTarget | null; markdown: ReviewMarkdownOptions };

/** Reads the render at `renderPath` in `project` (a folder name under work/projects/) for a hand-off, if there is one. */
export function openReviewHandoff(project: string, renderPath: string | undefined): ReviewHandoff {
  if (renderPath === undefined) return { project, target: null, markdown: { project, fps: REVIEW_FALLBACK_FPS, size: null } };
  const dir = projectFolderNamed(project), artifact = readReviewArtifact(project, renderPath);
  const fps = artifact.fps ?? REVIEW_FALLBACK_FPS;
  const sceneSources = Object.fromEntries((artifact.scenes ?? []).flatMap(({ id }) => {
    const source = projectSceneSourceFile(dir, id);
    return source ? [[id, source]] : [];
  }));
  const target = reviewPlacementTargetOf(resolveProjectMedia(project, renderPath), renderPath);
  // A note written on a slice laid into this cut is placed over that slice's picture.
  const splices = target.kind === 'video' ? readReviewSplices(project, { path: renderPath, hash: target.hash }).laid : [];
  return {
    project,
    target: { ...target, ...(splices.length && { splices }) },
    markdown: {
      project, renderPath, renderHash: artifact.render.hash, renderName: formatRenderVersionName(dir, { path: renderPath, hash: artifact.render.hash }), fps, size: artifact.frameSize, sceneSources, splices,
      sources: { fps, frameSize: artifact.frameSize, scenes: artifact.scenes, sounds: artifact.sounds, motion: artifact.motion, cells: artifact.cells, timing: artifact.timing },
    },
  };
}

/**
 * Every thread placed on the hand-off's render, and plan notes on the storyboard, which is imported and resolved only
 * when a thread is on the plan. A thread about something else (another still) is listed unplaced, saying so, never dropped.
 */
export async function placeReviewHandoff(handoff: ReviewHandoff, threads: readonly ReviewThread[]): Promise<PlacedReviewThread[]> {
  const plan = threads.some((t) => t.anchor.on === 'plan') ? await readProjectStoryboard(projectFolderNamed(handoff.project)) : undefined;
  const { target } = handoff;
  return threads.map((thread) => {
    const { anchor } = thread;
    if (anchor.on === 'plan') return { ...thread, placement: plan ? reviewPlanNotePlacementOf(anchor, plan.storyboard, plan.resolved) : { unplaced: 'the project has no storyboard.ts' } };
    return { ...thread, placement: (target && placeReviewThread(thread, target)) ?? placeAway(thread, target) };
  });
}

// A thread not shown on the hand-off's render is still placed when it stands on its own: one about the whole project,
// or a note on another still (read on that still). Only a video note on another render (or none) is unplaced.
const placeAway = (thread: ReviewThread, target: ReviewPlacementTarget | null): ReviewPlacement =>
  thread.anchor.on === 'project' || thread.anchor.on === 'still' ? { shifted: false } : { unplaced: target ? `not on ${target.path}` : 'nothing is rendered yet' };

/** The stills `threads` are on, other than the render itself, as they are now; a still since deleted is left out. */
function reviewHandoffStillsOf(project: string, renderPath: string | undefined, threads: readonly ReviewThread[]): Record<string, ReviewMarkdownStill> {
  const paths = new Set(threads.flatMap((t) => (t.anchor.on === 'still' && t.anchor.writtenOn.path !== renderPath ? [t.anchor.writtenOn.path] : [])));
  return Object.fromEntries([...paths].flatMap((path) => {
    const media = join(projectFolderNamed(project), ...path.split('/'));
    return existsSync(media) ? [[path, { hash: renderFileStamp(media).hash, size: reviewStillSizeOf(media) }]] : [];
  }));
}

/** The threads in `states` and the decisions given, as the agent reads them. */
export function formatReviewHandoff(handoff: ReviewHandoff, threads: readonly PlacedReviewThread[], decisions: readonly ReviewDecision[], states: readonly ReviewThreadState[]): string {
  const markdown = { ...handoff.markdown, stills: reviewHandoffStillsOf(handoff.project, handoff.markdown.renderPath, threads) };
  if (!decisions.length) return formatReviewThreadsMarkdown(threads, { ...markdown, states });
  // Only decisions changed: no `(no open notes)` line ahead of them.
  const notes = threads.length ? `${formatReviewThreadsMarkdown(threads, { ...markdown, states })}\n` : '';
  return `${notes}## Decisions\n\n${formatReviewDecisionsMarkdown(handoff.project, decisions)}\n`;
}

function gitCommitIn(dir: string, ref: string): string | undefined {
  const run = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: dir, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

/**
 * `--commit <ref>` as hashes in each repo it names a commit in. A ref only the workspace knows (a project's fix)
 * keeps the studio's HEAD as the engine it was made against.
 */
export function resolveReviewCommit(ref: string): ReviewEntryCommit {
  const workspace = isStudioWorkspaceRepo() ? gitCommitIn(STUDIO_WORKSPACE_DIR, ref) : undefined;
  const engine = gitCommitIn(STUDIO_ROOT, ref) ?? (workspace && gitCommitIn(STUDIO_ROOT, 'HEAD'));
  if (!engine) throw new Error(`--commit ${ref} isn't a commit in the studio or the workspace`);
  return { engine, ...(workspace && { workspace }) };
}

/**
 * Where `studio review ask` puts its question: frames on a render, the plan (a scene, its line or cell, a brief
 * section, the left-out list, and words quoted in it), a still, or the project.
 */
export type ReviewAskPlace =
  | { on: 'video'; render: string; frame: number; end?: number }
  | { on: 'plan'; field: ReviewPlanField; scene?: string; line?: string; section?: string; quote?: string }
  | { on: 'still'; still: string }
  | { on: 'project' };

/**
 * The anchor an agent's question is on: stamped with the render's hash and the moment its frame is at, or with the
 * plan's hash, its scene, line and quote checked against the storyboard so a typo fails here, not as an unplaced note.
 */
export async function reviewAskAnchorOf(project: string, place: ReviewAskPlace): Promise<NewAnchor> {
  switch (place.on) {
    case 'video': {
      const anchor = reviewVideoAnchorAt(readReviewArtifact(project, place.render), place.frame);
      return { ...anchor, ...(place.end !== undefined && { end: place.end }) };
    }
    case 'still': {
      const { hash } = renderFileStamp(resolveProjectMedia(project, place.still));
      return { on: 'still', writtenOn: { path: place.still, hash } };
    }
    case 'plan': return reviewAskPlanAnchorOf(project, place);
  }
  return { on: 'project' };
}

/** A plan question's anchor; a line's scene is found from the storyboard when the place leaves it out. */
async function reviewAskPlanAnchorOf(project: string, place: Extract<ReviewAskPlace, { on: 'plan' }>): Promise<ReviewPlanAnchor> {
  const plan = await readProjectStoryboard(projectFolderNamed(project));
  if (!plan) throw new Error(`${project} has no storyboard.ts to ask about`);
  const { storyboard, resolved } = plan;
  const { line } = place;
  const sceneOfLine = line === undefined ? undefined : Object.keys(storyboard.scenes).find((id) => line in (storyboard.scenes[id].lines ?? {}));
  const scene = place.scene ?? sceneOfLine;
  if (place.field === 'brief' && place.section === undefined) throw new Error(`a question on the brief names its section: ${Object.keys(storyboard.brief ?? {}).join(', ') || 'it has none'}`);
  if (place.field !== 'brief' && place.field !== 'leftOut' && scene === undefined) {
    throw new Error(place.line === undefined ? `name the scene: ${Object.keys(storyboard.scenes).join(', ')}` : `no scene has a line ${place.line}`);
  }
  const anchor: ReviewPlanAnchor = {
    on: 'plan', planHash: storyboardPlanHash(storyboard), field: place.field,
    ...(scene !== undefined && { scene }), ...(place.section !== undefined && { section: place.section }),
    ...(place.line !== undefined && { line: place.line }), ...(place.quote !== undefined && { text: place.quote }),
  };
  const placed = reviewPlanNotePlacementOf(anchor, storyboard, resolved);
  if ('unplaced' in placed) throw new Error(`can't ask there: ${placed.unplaced}`);
  return anchor;
}

/** A candidate as `--candidate` or a `--spec` file gives it: a file in the project or a text, a label, its meta. */
export type ReviewCandidateSpec = { path?: string; text?: string; label?: string; meta?: ReviewCandidate['meta'] };

/** The candidate keyed `key`, its file checked to be project media and hashed so a later change shows. */
export function reviewCandidateOf(project: string, key: string, spec: ReviewCandidateSpec): NewDecision['candidates'][number] {
  const meta = spec.meta ?? {};
  if (spec.text !== undefined) return { key, label: spec.label ?? spec.text.slice(0, 40), text: spec.text, meta };
  if (spec.path === undefined) throw new Error(`candidate ${key} needs a file or a text`);
  const dir = projectFolderNamed(project);
  // In the project, or from where the command runs (a path from the repo root, say).
  const inProject = resolve(dir, spec.path), fromHere = resolve(spec.path);
  if (!existsSync(inProject) && !existsSync(fromHere)) throw new Error(`candidate ${spec.path} isn't a file in ${project}`);
  const path = projectPathOf(dir, isAbsolute(spec.path) || !existsSync(inProject) ? fromHere : inProject);
  const file = resolveProjectMedia(project, path), kind = projectMediaTypeOf(file)?.kind;
  if (kind !== 'video' && kind !== 'still' && kind !== 'audio') throw new Error(`candidate ${spec.path} isn't a video, image or audio file`);
  return { key, label: spec.label ?? basename(path, extname(path)), media: { path, kind, hash: renderFileStamp(file).hash }, meta };
}
