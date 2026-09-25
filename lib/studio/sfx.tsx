// sfx.tsx: sound effects placed on a moment in scene time, and a video's cue list played over the whole video. The
// sounds are rendered from lib/sfx/'s recipes by `studio sfx`: the kit's into ./sfx/kit.ts, a project's own by
// `studio sfx render`, and a cue list's by `studio sfx draft` and `studio sfx cues`.

import { Audio } from '@remotion/media';
import { createContext, useContext } from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SfxMarkAttr } from '../sfx/cue-events.ts';
import type { SfxCuePlay } from '../sfx/cues.ts';
import { sfxSeedFromId } from '../sfx/dsp.ts';
import type { SfxRequest } from '../sfx/library.ts';

export { SFX } from './sfx/kit.ts';

/**
 * A rendered sound and where in it its event lands: 0 for a click, the pass of a whoosh, the end of a riser. `request`
 * is what rendered it, so a cue list can take the sound over.
 */
export type SfxSound = { src: string; seconds: number; landsAt: number; request: SfxRequest };

/** A cue list's cue, rendered: what a project's sfx/cues.ts exports, for `defineVideo({ sfx })`. */
export type SfxCueSound = SfxCuePlay & Omit<SfxSound, 'request'>;

/**
 * True while the video plays a cue list. The list has taken every `<Sfx>` event over, so they stay silent and only
 * mark where they'd land.
 */
export const SfxCueListPlaying = createContext(false);

/**
 * Plays `sound` so that its landing point falls when the scene clock `t` reaches `at`: a riser peaks on `at`, a whoosh
 * passes on it, a click starts on it. Given several takes, `id` picks one (the same one every render), so give each
 * event its own id. It works out its frame from where `t` stands now, so it needs no scene start: `frame − t·fps` is
 * the same every frame. It sounds only while mounted, so an effect inside a branch the scene has left stays quiet, as
 * the picture does.
 *
 * It also leaves a hidden mark saying what it plays and when, which `studio check` reads as an event for
 * `studio sfx draft`. When the video plays a cue list (`defineVideo({ sfx })`), the mark is all it leaves: the list
 * plays the event's sound.
 */
export function Sfx({ sound, at, t, id = 0, volume = 1 }: {
  sound: SfxSound | readonly SfxSound[]; at: number; t: number; id?: string | number; volume?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cueList = useContext(SfxCueListPlaying);
  const takes: readonly SfxSound[] = Array.isArray(sound) ? sound : [sound as SfxSound];
  const { src, seconds, landsAt, request } = takes[sfxSeedFromId(id) % takes.length];
  const start = at - landsAt;
  // `useCurrentFrame` is the scene Sequence's frame, so the probe, which knows the video's, turns this into video time.
  const mark: SfxMarkAttr = { fromNow: at - t, request, volume };
  return (
    <>
      <span hidden data-sfx-event={JSON.stringify(mark)} />
      {!cueList && (
        <Sequence from={frame + Math.round((start - t) * fps)} durationInFrames={Math.ceil(seconds * fps) + 1} layout="none" name="sfx">
          <Audio src={src} volume={volume} />
        </Sequence>
      )}
    </>
  );
}

/** A cue list over the whole video, each cue landing on its `at` in video seconds. */
export function SfxCueListAudio({ cues }: { cues: readonly SfxCueSound[] }) {
  const { fps } = useVideoConfig();
  return cues.map((cue) => (
    <Sequence key={cue.id} name={`sfx: ${cue.id}`} from={Math.round((cue.at - cue.landsAt) * fps)} durationInFrames={Math.ceil(cue.seconds * fps) + 1} layout="none">
      <Audio src={cue.src} volume={cue.volume} />
    </Sequence>
  ));
}
