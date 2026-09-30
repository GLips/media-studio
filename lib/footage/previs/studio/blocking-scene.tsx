// blocking-scene.tsx: a timed project's flat scene bound as a 2D blockout (flat-blockout.tsx), with its `blocking` rung
// declared alongside so the picture and the rung the snapshot records can't disagree. Every scene starts here; raising
// it to final changes its binding in video.tsx, never timeline.ts.

import type { ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';
import type { SceneDef, ScenePrevis } from '#lib/picture/composition/studio/timeline.ts';
import { sceneForTimelineClock } from '#lib/picture/composition/studio/timeline-scene.tsx';
import { FlatBlockout, type FlatPiece, type FlatViewMoves } from './flat-blockout.tsx';

type FlatPrevis = ScenePrevis extends infer P ? P extends unknown ? Omit<P, 'blockout'> : never : never;

/**
 * The `blocking` rung for a flat scene: its pieces as a 2D blockout (flat-blockout.tsx), keyed to the frames of its
 * clock (`at: clock.cues.land`). Given `previs`, the blockout is also what `studio gen video` sends as the motion reference.
 */
export function blockingScene(
  clock: ResolvedSceneClock,
  { note, pieces, view, previs }: { note: string; pieces: readonly FlatPiece[]; view?: FlatViewMoves; previs?: FlatPrevis },
): SceneDef {
  return sceneForTimelineClock(clock, {
    note, rung: 'blocking', ...(previs && { previs: { ...previs, blockout: '2d' } }),
    // `s.t` counts seconds from the cut, which is frame `clock.from` of the scene's own clock.
    render: (s) => <FlatBlockout pieces={pieces} view={view} frame={clock.from + s.t * clock.fps} />,
  });
}
