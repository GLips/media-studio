// pause-rig-player.ts: plays a stretch of a recorded line as a render would: its sound through the mix's own piece clips
// (recordedPieceClips, with their fades and dips), and the camera following the line's time map, its playback rate set
// to the piece under the clock and put back when it drifts. The audio clock leads.
import type { LibraryItem } from '#lib/footage/library/models/library-item.ts';
import { libraryMediaTimeOf } from '#lib/footage/library/models/library-item.ts';
import { libraryMediaUrl } from '#lib/footage/library/studio/library-media.ts';
import { levelGain, recordedPieceClips, VOICE_LUFS } from '#lib/timing/sound/models/mix.ts';
import { playMedia } from '#web/shared/ui/play-media.ts';
import { spokenItemTimeAt, spokenStretchSeconds, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';

/** What the player shows: whether it plays, and the line second and item second under the clock. */
export type PauseRigPlayhead = { playing: boolean; line: number; item: number };

// Seconds the camera may drift from the clock before it's put back; a seek costs a stall, so not every frame.
// The fastest a browser plays a video.
const MAX_VIDEO_RATE = 16;
const PICTURE_DRIFT = 0.08;
// The gain curve a clip is handed, sampled this often: a fade of 20 ms gets ten points.
const GAIN_STEP = 0.002;
// Seconds the audio is scheduled ahead of the clock, so its first clip isn't late.
const START_LEAD = 0.05;

export type PauseRigPlayer = {
  /** Plays `speech` from line second `from` to `to`, its camera in `video`; `onEnd` when it reaches `to`. */
  play: (item: LibraryItem, speech: RecordedSpeech, from: number, to: number, video: HTMLVideoElement, onEnd: () => void) => Promise<void>;
  stop: () => void;
  subscribe: (listener: (head: PauseRigPlayhead) => void) => () => void;
};

export function createPauseRigPlayer(): PauseRigPlayer {
  const context = new AudioContext();
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const listeners = new Set<(head: PauseRigPlayhead) => void>();
  let playing: { nodes: AudioScheduledSourceNode[]; raf: number } | null = null;
  let generation = 0;

  const bufferOf = (url: string) => {
    if (!buffers.has(url)) {
      buffers.set(url, fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`${url}: ${await response.text()}`);
        return context.decodeAudioData(await response.arrayBuffer());
      }));
    }
    return buffers.get(url)!;
  };
  const tell = (head: PauseRigPlayhead) => listeners.forEach((listener) => listener(head));

  const stop = () => {
    if (!playing) return;
    cancelAnimationFrame(playing.raf);
    for (const node of playing.nodes) node.stop();
    playing = null;
    tell({ playing: false, line: 0, item: 0 });
  };

  const play: PauseRigPlayer['play'] = async (item, speech, from, to, video, onEnd) => {
    stop();
    const mine = ++generation;
    const sound = speech.sound;
    if (!sound) throw new Error(`${item.id} isn't levelled yet: \`studio library finish ${item.id}\``);
    const buffer = await bufferOf(libraryMediaUrl(item.id, sound.file));
    if (mine !== generation) return;
    if (context.state === 'suspended') await context.resume();
    const camera = item.tracks.camera;
    const duration = spokenStretchSeconds(speech), gain = levelGain(sound.lufs, VOICE_LUFS, item.id);
    const startAt = context.currentTime + START_LEAD;
    const nodes: AudioScheduledSourceNode[] = [];
    for (const clip of recordedPieceClips(sound, duration)) {
      const skip = Math.max(0, from - clip.at), length = Math.min(clip.duration, to - clip.at) - skip;
      if (length <= 0) continue;
      const source = new AudioBufferSourceNode(context, { buffer });
      const steps = Math.max(2, Math.ceil(length / GAIN_STEP));
      const curve = Float32Array.from({ length: steps }, (_, k) => gain * clip.gain(skip + (k / (steps - 1)) * length));
      const level = new GainNode(context, { gain: curve[0] });
      const when = startAt + clip.at + skip - from;
      level.gain.setValueCurveAtTime(curve, when, length);
      source.connect(level).connect(context.destination);
      source.start(when, clip.start + skip, length);
      nodes.push(source);
    }
    const state = { nodes, raf: 0 };
    playing = state;
    const tick = () => {
      if (playing !== state) return;
      const line = from + context.currentTime - startAt;
      if (line >= to) {
        video.pause();
        stop();
        onEnd();
        return;
      }
      const at = Math.max(from, line), itemTime = spokenItemTimeAt(speech, at);
      if (camera) {
        const piece = speech.pieces.find((p, k) => k === speech.pieces.length - 1 || itemTime < p.to);
        // Chrome refuses a playback rate past 16, throwing out of this loop; a faster stretch is held by seeking.
        const rate = Math.min(MAX_VIDEO_RATE, piece?.speed ?? 1);
        if (video.playbackRate !== rate) video.playbackRate = rate;
        const mediaTime = libraryMediaTimeOf(camera, itemTime);
        if (Math.abs(video.currentTime - mediaTime) > PICTURE_DRIFT) video.currentTime = mediaTime;
        if (line >= from && video.paused) playMedia(video);
      }
      tell({ playing: true, line: at, item: itemTime });
      state.raf = requestAnimationFrame(tick);
    };
    if (camera) {
      video.pause();
      video.currentTime = libraryMediaTimeOf(camera, spokenItemTimeAt(speech, from));
    }
    state.raf = requestAnimationFrame(tick);
  };

  return {
    play,
    stop,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
