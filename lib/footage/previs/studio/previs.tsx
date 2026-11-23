// previs.tsx: a previs scene playing its previs clip (see previs.ts) in place of its blockout.

import { Video } from '@remotion/media';
import { AbsoluteFill, Freeze, Sequence, useVideoConfig } from 'remotion';
import type { PrevisClip } from './previs.ts';
import { checkSourcePins, pinnedSourceTime } from '#lib/footage/capture/studio/take.ts';
import type { LaidScene } from '#lib/picture/video/studio/video.ts';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';

/** A previs scene's clip at the scene's clock, retimed by its `previs.retime` if it has one. */
export function PrevisClipPlayer({ scene, clip, clock }: { scene: LaidScene; clip: PrevisClip; clock: SceneClock }) {
  const { fps } = useVideoConfig();
  const previs = scene.previs!;
  const style = { width: '100%', height: '100%' };
  if (previs.audio) {
    // Unfrozen, so its sound plays. The scene's Sequence starts on its first visible frame now, which a changed
    // crossfade may have moved from where the clip starts.
    return (
      <Sequence from={Math.round(clip.from * fps) - (scene.visible.from - scene.from)} layout="none">
        <AbsoluteFill><Video src={clip.src} objectFit="cover" style={style} /></AbsoluteFill>
      </Sequence>
    );
  }
  const pins = previs.retime?.(clock).map(([sceneTime, blockout]) => [sceneTime, blockout - clip.from] as const);
  if (pins?.length) checkSourcePins('previs clip', pins, (i) => pins[i][1] + clip.from);
  const time = pins?.length ? pinnedSourceTime(pins, clock.t, clip.duration) : Math.min(clip.duration, Math.max(0, clock.t - clip.from));
  return (
    <AbsoluteFill>
      <Freeze frame={Math.min(Math.round(time * fps), Math.round(clip.duration * fps) - 1)}>
        <Video src={clip.src} muted objectFit="cover" style={style} />
      </Freeze>
    </AbsoluteFill>
  );
}
