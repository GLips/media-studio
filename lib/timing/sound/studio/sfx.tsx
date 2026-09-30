// sfx.tsx: sound effects placed on a moment in scene time, and a video's cue list played over the whole video. The
// sounds are rendered from lib/timing/sound/models/recipes.ts: the kit's into ./sfx/kit.ts by `studio sfx kit`, a project's own by
// `studio sfx render`, and a cue list's on every bundle (lib/timing/sound/engine/cue-module.ts).

import { Audio } from '@remotion/media';
import { createContext, useContext } from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SfxMarkAttr, SfxMarkedEvent } from '../models/cue-events.ts';
import { randomSeedFromKey } from '#lib/picture/motion/models/random.ts';
import type { SfxRequest } from '../models/library.ts';

export { SFX } from './kit.ts';

/**
 * A rendered sound and where in it its event lands: 0 for a click, the pass of a whoosh, the end of a riser. `request`
 * is what rendered it, so a cue list can take the sound over.
 */
export type SfxSound = { src: string; seconds: number; landsAt: number; request: SfxRequest };

/** A cue list's cue, rendered, landing `at` video seconds: what `@sfx-cues` exports. */
export type SfxCueSound = { id: string; at: number; volume: number } & Omit<SfxSound, 'request'>;

/** True while the video plays a cue list (`defineVideo({ sfxCueList })`), which plays the clicks and keys itself. */
export const SfxCueListPlaying = createContext(false);

/**
 * Where a sound whose file starts on (fractional) frame `start` plays from: the frame at or after it, with the fraction
 * between them trimmed off its front. Every rendered sound opens with over a frame of silence (SFX_PRE_ROLL_SECONDS),
 * so the trim only takes silence and the sound lands to the sample.
 */
function sfxPlacement(start: number): { from: number; trimBefore: number } {
  // Float noise must not tip a start that sits on a frame onto the next one.
  const from = Math.ceil(start - 1e-6);
  return { from, trimBefore: Math.max(0, from - start) };
}

/**
 * Plays `sound` so it lands when the scene clock `t` reaches `at`: a riser peaks there, a whoosh passes. `id`
 * picks one of several takes, the same every render. It needs no scene start: `frame − t·fps` is constant.
 *
 * Its hidden mark is the event `studio check` reads. Under a cue list a `click` or `key` leaves only the mark.
 */
export function Sfx({ sound, at, t, id = 0, volume = 1, event = 'placed' }: {
  sound: SfxSound | readonly SfxSound[]; at: number; t: number; id?: string | number; volume?: number; event?: SfxMarkedEvent;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cueList = useContext(SfxCueListPlaying);
  const takes: readonly SfxSound[] = Array.isArray(sound) ? sound : [sound as SfxSound];
  const { src, seconds, landsAt, request } = takes[randomSeedFromKey(id) % takes.length];
  const { from, trimBefore } = sfxPlacement(frame + (at - landsAt - t) * fps);
  // `useCurrentFrame` is the scene Sequence's frame, so the probe, which knows the video's, turns this into video time.
  const mark: SfxMarkAttr = { event, fromNow: at - t, request, volume };
  return (
    <>
      <span hidden data-sfx-event={JSON.stringify(mark)} />
      {!(cueList && event !== 'placed') && (
        <Sequence from={from} durationInFrames={Math.ceil(seconds * fps) + 1} layout="none" name="sfx">
          <Audio src={src} volume={volume} trimBefore={trimBefore} />
        </Sequence>
      )}
    </>
  );
}

/** A cue list over the whole video, each cue landing on its `at` in video seconds. */
export function SfxCueListAudio({ cues }: { cues: readonly SfxCueSound[] }) {
  const { fps } = useVideoConfig();
  return cues.map((cue) => {
    const { from, trimBefore } = sfxPlacement((cue.at - cue.landsAt) * fps);
    return (
      <Sequence key={cue.id} name={`sfx: ${cue.id}`} from={from} durationInFrames={Math.ceil(cue.seconds * fps) + 1} layout="none">
        <Audio src={cue.src} volume={cue.volume} trimBefore={trimBefore} />
      </Sequence>
    );
  });
}
