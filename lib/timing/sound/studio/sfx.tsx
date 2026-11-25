// sfx.tsx: sound effects placed on a moment in scene time, and a video's cue list played over the whole video. The
// sounds are rendered from lib/timing/sound/models/recipes.ts: the kit's into ./sfx/kit.ts by `studio sfx kit`, a project's own by
// `studio sfx render`, and a cue list's on every bundle (lib/output/sfx-cues/engine/cue-module.ts).

import { createContext, useContext } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { SoundClip } from './sound-clip.tsx';
import type { SfxMarkAttr, SfxMarkedEvent } from '../models/sfx-marks.ts';
import { randomSeedFromKey } from '#lib/picture/motion/models/random.ts';
import type { SfxSoundRequest } from '../models/library.ts';

export { SFX } from './kit.ts';

/**
 * A rendered sound and where in it its event lands: 0 for a click, the pass of a whoosh, the end of a riser. `request`
 * is what rendered or generated it, so a cue list can take a recipe's sound over.
 */
export type SfxSound = { src: string; seconds: number; landsAt: number; request: SfxSoundRequest };

/** A cue list's cue, rendered, landing `at` video seconds: what `@sfx-cues` exports. */
export type SfxCueSound = { id: string; at: number; volume: number } & Omit<SfxSound, 'request'>;

/** True while the video plays a cue list (`defineVideo({ sfxCueList })`), which plays the clicks and keys itself. */
export const SfxCueListPlaying = createContext(false);

/**
 * Plays `sound` so it lands when the scene clock `t` reaches `at`: a riser peaks there, a whoosh passes. `id`
 * picks one of several takes, the same every render. It needs no scene start: `frame − t·fps` is constant.
 *
 * Its hidden mark is the event `studio check` reads. Under a cue list a `click` or `key` leaves only the mark.
 */
export function Sfx({ sound, at, t, id = 0, volume = 1, event = 'placed' }: {
  sound: SfxSound | readonly SfxSound[]; at: number; t: number; id?: string | number; volume?: number; event?: SfxMarkedEvent;
}) {
  const cueList = useContext(SfxCueListPlaying);
  const takes: readonly SfxSound[] = Array.isArray(sound) ? sound : [sound as SfxSound];
  const { src, landsAt, request } = takes[randomSeedFromKey(id) % takes.length];
  // The probe, which knows the video's frame, turns `fromNow` into video time.
  const mark: SfxMarkAttr = { event, fromNow: at - t, request, volume };
  return (
    <>
      <span hidden data-sfx-event={JSON.stringify(mark)} />
      {!(cueList && event !== 'placed') && <SoundClip src={src} t={t} at={at - landsAt} volume={volume} id={`sfx ${event} ${id}`} />}
    </>
  );
}

/** A cue list over the whole video, each cue landing on its `at` in video seconds. */
export function SfxCueListAudio({ cues }: { cues: readonly SfxCueSound[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return cues.map((cue) => <SoundClip key={cue.id} src={cue.src} t={frame / fps} at={cue.at - cue.landsAt} volume={cue.volume} id={`sfx ${cue.id}`} />);
}
