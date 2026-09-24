// sfx.tsx: sound effects placed on a moment in scene time. The sounds are rendered from lib/sfx/'s recipes by
// `studio sfx`: the kit's into ./sfx/kit.ts, a project's own by `studio sfx render`.

import { Audio } from '@remotion/media';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { sfxSeedFromId } from '../sfx/dsp.ts';

export { SFX } from './sfx/kit.ts';

/** A rendered sound and where in it its event lands: 0 for a click, the pass of a whoosh, the end of a riser. */
export type SfxSound = { src: string; seconds: number; landsAt: number };

/**
 * Plays `sound` so that its landing point falls when the scene clock `t` reaches `at`: a riser ends on `at`, a whoosh
 * passes on it, a click starts on it. Given several takes, `id` picks one (the same one every render), so give each
 * event its own id. It works out its frame from where `t` stands now, so it needs no scene start: `frame − t·fps` is
 * the same every frame. It sounds only while mounted, so an effect inside a branch the scene has left stays quiet, as
 * the picture does.
 *
 * With `until`, it loops from `at` until then instead: for a bed, whose end runs seamlessly into its start.
 */
export function Sfx({ sound, at, t, id = 0, until, volume = 1, rate = 1 }: {
  sound: SfxSound | readonly SfxSound[]; at: number; t: number; id?: string | number; until?: number; volume?: number; rate?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const takes: readonly SfxSound[] = Array.isArray(sound) ? sound : [sound as SfxSound];
  const { src, seconds, landsAt } = takes[sfxSeedFromId(id) % takes.length];
  const start = at - landsAt / rate;
  const length = until === undefined ? seconds / rate : until - start;
  return (
    <Sequence from={frame + Math.round((start - t) * fps)} durationInFrames={Math.ceil(length * fps) + 1} layout="none" name="sfx">
      <Audio src={src} volume={volume} playbackRate={rate} loop={until !== undefined} />
    </Sequence>
  );
}
