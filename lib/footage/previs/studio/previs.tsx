// previs.tsx: a previs scene playing its generated footage (see previs.ts) in place of its blockout.

import { Video } from '@remotion/media';
import { AbsoluteFill, Freeze, Sequence, useVideoConfig } from 'remotion';
import type { PrevisFootage } from './previs.ts';
import { checkSourcePins, pinnedSourceTime } from '#lib/footage/capture/studio/take.ts';
import type { LaidScene } from '#lib/picture/composition/studio/timeline.ts';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';

/** A previs scene's footage at the scene's clock, retimed by its `previs.retime` if it has one. */
export function PrevisFootagePlayer({ scene, footage, clock }: { scene: LaidScene; footage: PrevisFootage; clock: SceneClock }) {
  const { fps } = useVideoConfig();
  const previs = scene.previs!;
  const style = { width: '100%', height: '100%' };
  if (previs.audio) {
    // Unfrozen, so its sound plays. The scene's Sequence starts on its first visible frame now, which a changed
    // crossfade may have moved from where the footage starts.
    return (
      <Sequence from={Math.round(footage.from * fps) - (scene.visible.from - scene.from)} layout="none">
        <AbsoluteFill><Video src={footage.src} objectFit="cover" style={style} /></AbsoluteFill>
      </Sequence>
    );
  }
  const pins = previs.retime?.(clock).map(([sceneTime, blockout]) => [sceneTime, blockout - footage.from] as const);
  if (pins?.length) checkSourcePins('footage', pins, (i) => pins[i][1] + footage.from);
  const time = pins?.length ? pinnedSourceTime(pins, clock.t, footage.duration) : Math.min(footage.duration, Math.max(0, clock.t - footage.from));
  return (
    <AbsoluteFill>
      <Freeze frame={Math.min(Math.round(time * fps), Math.round(footage.duration * fps) - 1)}>
        <Video src={footage.src} muted objectFit="cover" style={style} />
      </Freeze>
    </AbsoluteFill>
  );
}
