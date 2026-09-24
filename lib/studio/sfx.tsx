// sfx.tsx: short sound effects placed at a moment in scene time. The sounds are synthesized by `studio sfx`.

import { Audio } from '@remotion/media';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import click from './sfx/click.wav';
import key from './sfx/key.wav';

export const SFX = { click, key } as const;

/**
 * Plays `src` when the scene clock `t` reaches `at`. It works out its frame from where `t` stands now, so it needs no
 * scene start: `frame − t·fps` is the same every frame. It sounds only while mounted, so an effect inside a branch
 * the scene has left stays quiet, as the picture does.
 */
export function Sfx({ src, at, t, volume = 0.5, rate = 1 }: { src: string; at: number; t: number; volume?: number; rate?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Sequence from={frame + Math.round((at - t) * fps)} durationInFrames={Math.ceil(0.2 * fps)} layout="none" name="sfx">
      <Audio src={src} volume={volume} playbackRate={rate} />
    </Sequence>
  );
}
