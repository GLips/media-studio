// previs.tsx: a previs scene's two faces. `studio gen video` renders the scene's blockout alone (BlockoutSolo in
// Video.tsx) and sends it to the video model; the footage that comes back is listed in the project's
// generated/footage.ts, and from then on the scene plays that footage in place of its blockout.
//
// The footage covers the scene's whole time on screen, crossfades included, so it starts at the scene time the
// blockout render started (`from`, negative when the scene fades in). Retiming maps scene time to blockout time, and
// footage time is blockout time less `from`.

import { Video } from '@remotion/media';
import { AbsoluteFill, Freeze, useVideoConfig } from 'remotion';
import { pinnedSourceTime } from './take.ts';
import { visibleSpan, type SceneClock, type ScenePrevis, type Timeline } from './timeline.ts';

/** The whole seconds Seedance 2.5 renders: a footage request is the scene's time on screen, rounded up into these. */
export const PREVIS_SECONDS = { min: 4, max: 30 } as const;

/** One scene's generated footage, as generated/footage.ts lists it. */
export type PrevisFootage = { src: string; from: number; duration: number };

/** Where a scene's blockout render starts, in scene seconds, and how many whole seconds it runs. */
export function previsSpan(tl: Timeline, sceneId: string): { from: number; duration: number } {
  const i = tl.scenes.findIndex((scene) => scene.id === sceneId);
  if (i < 0) throw new Error(`no scene "${sceneId}"; the scenes are ${tl.scenes.map((scene) => scene.id).join(', ')}`);
  const scene = tl.scenes[i], span = visibleSpan(tl, i);
  const seconds = Math.max(PREVIS_SECONDS.min, Math.ceil(span.end - span.start - 1e-6));
  if (seconds > PREVIS_SECONDS.max) throw new Error(`scene ${sceneId} is on screen ${(span.end - span.start).toFixed(1)}s, past the ${PREVIS_SECONDS.max}s a generated shot can run: split it`);
  return { from: span.start - scene.start, duration: seconds };
}

/** A previs scene playing its footage, retimed by `previs.retime` if it has one. */
export function PrevisFootagePlayer({ clip, previs, clock }: { clip: PrevisFootage; previs: ScenePrevis; clock: SceneClock }) {
  const { fps } = useVideoConfig();
  const style = { width: '100%', height: '100%' };
  if (previs.audio) {
    if (previs.retime) throw new Error('a previs scene with audio can\'t be retimed: the sound would stretch with it');
    // Unfrozen, so its sound plays: the scene's Sequence starts where the footage does.
    return <AbsoluteFill><Video src={clip.src} objectFit="cover" style={style} /></AbsoluteFill>;
  }
  const pins = previs.retime?.(clock).map(([scene, blockout]) => [scene, blockout - clip.from] as const);
  const time = pins?.length ? pinnedSourceTime(pins, clock.t, clip.duration) : Math.min(clip.duration, Math.max(0, clock.t - clip.from));
  return (
    <AbsoluteFill>
      <Freeze frame={Math.min(Math.round(time * fps), Math.round(clip.duration * fps) - 1)}>
        <Video src={clip.src} muted objectFit="cover" style={style} />
      </Freeze>
    </AbsoluteFill>
  );
}
