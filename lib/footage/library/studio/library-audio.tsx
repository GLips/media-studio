// library-audio.tsx: a stretch of a library item's sound, placed on the scene clock: a recording's system track (the
// Mac's own sound), or any audio track heard outside a storyboard line. A line spoken from a recording plays through
// its storyboard's `speech` instead, which the mix levels as a voice; this one plays at the volume it's given.
import { SoundClip } from '#lib/timing/sound/studio/sound-clip.tsx';
import type { LibraryFootage } from '../models/library-footage.ts';
import { libraryItemTimeOf, libraryMediaTimeOf } from '../models/library-item.ts';
import { libraryMediaUrl } from './library-media.ts';

export type LibraryAudioProps = {
  footage: LibraryFootage;
  /** The track to hear, by its name in the item: `system` for a recording's system audio, `mic`, a file's `audio`. */
  track: string;
  /** The stretch to play, in item seconds. */
  from: number;
  to: number;
  /** The scene clock now, in seconds, and the scene time the stretch starts at. */
  t: number;
  at: number;
  /** 0 to 1, or by seconds into the stretch, for a fade in or out. */
  volume?: number | ((seconds: number) => number);
};

/** Plays `footage`'s `track` from item second `from` to `to`, starting as the scene clock `t` reaches `at`. */
export function LibraryAudio({ footage, track: name, from, to, t, at, volume = 1 }: LibraryAudioProps) {
  const track = footage.item.tracks[name];
  if (!track?.audio) throw new Error(`${footage.item.id} has no audio track ${name}: it has ${Object.keys(footage.item.tracks).join(', ')}`);
  const start = libraryMediaTimeOf(track, from), end = libraryMediaTimeOf(track, to);
  if (start < 0 || end > track.mediaSeconds || end <= start) {
    const first = libraryItemTimeOf(track, 0), last = libraryItemTimeOf(track, track.mediaSeconds);
    throw new Error(`${footage.item.id}'s ${name} runs ${first.toFixed(3)}–${last.toFixed(3)} s: it can't play ${from}–${to} s`);
  }
  return <SoundClip src={libraryMediaUrl(footage.item.id, track.file)} t={t} at={at} from={start} duration={end - start} volume={volume} id={`library ${name}`} />;
}
