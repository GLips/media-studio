// ladder-scenes.tsx: a timed project's scene bound as a title card, a board frame or a 2D blockout until it's built,
// with its rung declared alongside, so the stand-in and the rung the snapshot records can't disagree. In video.tsx, a
// scene's binding is `(clock) => titleCardScene(clock, { note })` until it's drawn; the timeline doesn't change as it rises.

import type { ResolvedSceneClock } from '#models/timeline/timeline.ts';
import { FPS } from '#models/frame/frame.ts';
import type { SceneDef, ScenePrevis } from '../composition/timeline.ts';
import { sceneForTimelineClock } from '../composition/timeline-scene.tsx';
import { FlatBlockout, type FlatPiece, type FlatViewMoves } from '../previs/flat-blockout.tsx';
import { BoardFrame, type BoardMove } from './board-frame.tsx';
import { TitleCard, type TitleCardCue } from './title-card.tsx';

/** A scene's cues, and each line where it starts, in its own seconds: what its title card lights. */
function titleCardCues(clock: ResolvedSceneClock): TitleCardCue[] {
  const at = (frame: number) => (frame - clock.from) / FPS;
  return [
    ...Object.entries(clock.cues).map(([name, frame]) => ({ name, at: at(frame as number) })),
    ...clock.lines.map((line) => ({ name: `“${line.id}”`, at: at(line.frame) })),
  ];
}

/** The `card` rung: the scene's id, note and cues on a plain ground. */
export const titleCardScene = (clock: ResolvedSceneClock, { note }: { note: string }): SceneDef => sceneForTimelineClock(clock, {
  note, rung: 'card', render: () => <TitleCard id={clock.id} n={clock.n} note={note} cues={titleCardCues(clock)} />,
});

/** The `board` rung: `src` held, its one move over the timeline's move `over` if named, else the whole scene. */
export function boardFrameScene<Move extends string>(
  clock: ResolvedSceneClock<string, string, Move>,
  { note, src, caption, move, over }: { note: string; src: string; caption?: string; move?: BoardMove; over?: NoInfer<Move> },
): SceneDef {
  const span = over && clock.moves[over];
  const during = span ? { start: (span.from - clock.from) / FPS, end: (span.to - clock.from) / FPS } : undefined;
  return sceneForTimelineClock(clock, { note, rung: 'board', render: () => <BoardFrame src={src} caption={caption} move={move} during={during} /> });
}

type FlatPrevis = ScenePrevis extends infer P ? P extends unknown ? Omit<P, 'blockout'> : never : never;

/**
 * The `blocking` rung for a flat scene: its pieces as a 2D blockout (flat-blockout.tsx), keyed to the frames of its
 * clock (`at: clock.cues.land`). Given `previs`, the blockout is also what `studio gen video` sends as the motion reference.
 */
export function blockingScene(
  clock: ResolvedSceneClock,
  { note, pieces, view, previs }: { note: string; pieces: readonly FlatPiece[]; view?: FlatViewMoves; previs?: FlatPrevis },
): SceneDef {
  // `s.t` counts seconds from the cut, which is frame `clock.from` of the scene's own clock.
  const scene = sceneForTimelineClock(clock, { note, rung: 'blocking', render: (s) => <FlatBlockout pieces={pieces} view={view} frame={clock.from + s.t * FPS} /> });
  return previs ? { ...scene, previs: { ...previs, blockout: '2d' } as ScenePrevis } : scene;
}
