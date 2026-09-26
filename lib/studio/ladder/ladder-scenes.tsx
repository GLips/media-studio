// ladder-scenes.tsx: a timed project's scene bound as a title card or a board frame until it's built, with its rung
// declared alongside, so the stand-in and the rung the snapshot records can't disagree. In video.tsx, a scene's
// binding is `(clock) => titleCardScene(clock, { note })` until it's drawn; the timeline doesn't change as it rises.

import type { ResolvedSceneClock } from '#models/timeline/timeline.ts';
import { FPS } from '#models/frame/frame.ts';
import type { SceneDef } from '../composition/timeline.ts';
import { sceneForTimelineClock } from '../composition/timeline-scene.tsx';
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
