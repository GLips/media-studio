import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { reviewPlanSignoffs } from '#lib/output/review/models/review-plan.ts';
import { storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import type { ReviewFile, ReviewThread } from '#lib/output/review/models/review-threads.ts';
import { useProjectPulse, type ProjectPulse } from '#web/features/projects/index.ts';
import { reviewArtifactQueryOptions, reviewFileQueryOptions, useReviewDraft, useReviewFileRevision, useReviewOps } from '#web/features/review/index.ts';
import type { ProjectStoryboard } from '#web/features/storyboard/index.ts';
import { usePlanSearch } from '../controllers/plan-search.ts';
import { placePlanThreads, type PlanTarget } from './plan-notes.ts';
import { createPlanPlayback } from './plan-playback.ts';
import type { PlanRender, PlanScreenValue } from './plan-screen-context.tsx';
import { planTimingOf } from './plan-timing.ts';

/** The render the plan links to: the newest animatic (out/wip/animatic.mp4) or delivered video (out/*.mp4). */
const PLAN_RENDER_PATH = /^out\/(?:wip\/animatic|[^/]+)\.mp4$/;

/** The newest render on disk, by the pulse, which lists the project's files newest first. */
const newestPlanRenderOf = (pulse: ProjectPulse) => pulse.files.find((f) => f.kind === 'video' && PLAN_RENDER_PATH.test(f.path));

/**
 * The video review's notes by the scene each sits in: by the moment it carries, or, on the newest render itself, by
 * the scene its frame is in. A note in no scene of the plan is left out (it's the video review's alone).
 */
function planVideoNotesByScene(file: ReviewFile | undefined, render: PlanRender | null): Map<string, ReviewThread[]> {
  const byScene = new Map<string, ReviewThread[]>();
  for (const thread of file?.threads ?? []) {
    const { anchor } = thread;
    if (anchor.on !== 'video' || thread.state === 'resolved') continue;
    const onRender = render && anchor.writtenOn.hash === render.hash ? render.artifact?.timing?.scenes.find((s) => s.from <= anchor.frame && anchor.frame < s.to)?.id : undefined;
    const scene = anchor.moment?.scene ?? onRender;
    if (scene !== undefined) byScene.set(scene, [...(byScene.get(scene) ?? []), thread]);
  }
  return byScene;
}

/** Everything the plan page's parts share: the resolved plan on its frames, its clock, its notes and sign-offs, and the URL. */
export function usePlanScreenValue(project: string, plan: ProjectStoryboard): PlanScreenValue {
  const pulse = useProjectPulse(project);
  const [search, setSearch] = usePlanSearch();
  const ops = useReviewOps(project);
  const draft = useReviewDraft(`${project}/plan`);
  const file = useQuery(reviewFileQueryOptions(project, useReviewFileRevision(project, pulse.revision))).data;
  const newest = newestPlanRenderOf(pulse);
  const artifact = useQuery({ ...reviewArtifactQueryOptions(project, newest?.path ?? ''), enabled: newest !== undefined }).data;
  const render: PlanRender | null = newest ? { path: newest.path, hash: newest.hash, artifact: artifact?.render.hash === newest.hash ? artifact : undefined } : null;
  const timing = useMemo(() => planTimingOf(plan), [plan]);
  const [playback] = useState(createPlanPlayback);
  useEffect(() => {
    playback.setProgramme({ fps: timing?.fps ?? 30, end: timing?.end ?? 1, audio: timing?.audio ?? [] });
  }, [playback, timing]);
  useEffect(() => () => playback.dispose(), [playback]);
  const [target, setTarget] = useState<PlanTarget | null>(null);
  const threads = useMemo(() => file && placePlanThreads(file, plan), [file, plan]);
  const signoffList = useMemo(() => reviewPlanSignoffs(plan.storyboard, plan.resolved, file?.signoffs ?? []), [plan, file?.signoffs]);
  const sceneIds = Object.keys(plan.storyboard.scenes);
  return {
    project, pulse, plan, timing, playback, search, setSearch, draft, ops, threads, render, target, setTarget,
    videoNotes: planVideoNotesByScene(file, render),
    signoffs: new Map(signoffList.map(({ scene, ...state }) => [scene, state])),
    focusedScene: sceneIds.find((id) => id === search.scene) ?? sceneIds[0] ?? null,
    signOff: (scene) => {
      const hash = storyboardSceneHash(plan.storyboard, plan.resolved, scene);
      if (hash !== null) void ops.apply([{ op: 'signoff', signoff: { on: 'plan', scene, hash, at: new Date().toISOString() } }]);
    },
  };
}
