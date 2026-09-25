// lab-audio.ts: the Sound tab's one speaker. A single AudioContext plays one buffer at a time (starting another
// stops the last), and a hook reports where the playhead is, so a waveform or timeline can draw it.
import { useEffect, useState } from 'react';

let labAudioContext: AudioContext | undefined;
/** Created on first use: browsers only let a context make sound once the page has had a click or key press. */
export const labAudio = () => (labAudioContext ??= new AudioContext());

type LabPlaying = { id: string; buffer: AudioBuffer; source: AudioBufferSourceNode; startedAt: number; offset: number; until: number };
let labPlaying: LabPlaying | undefined;
const labListeners = new Set<() => void>();
const notifyLabListeners = () => labListeners.forEach((f) => f());

export function audioBufferFromChannels(channels: readonly Float32Array[], rate: number): AudioBuffer {
  const buffer = labAudio().createBuffer(channels.length, channels[0].length, rate);
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buffer;
}

/**
 * Plays `buffer` from `offset` seconds, under the name `id` so its view can find its playhead. `fadeOutAt`, in the
 * buffer's seconds, fades it to silence over `fadeSeconds` and stops there.
 */
export function playLabBuffer(id: string, buffer: AudioBuffer, { offset = 0, fadeOutAt, fadeSeconds = 2 }: { offset?: number; fadeOutAt?: number; fadeSeconds?: number } = {}) {
  stopLabAudio();
  const ctx = labAudio();
  void ctx.resume();
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  const startedAt = ctx.currentTime + 0.02;
  let until = buffer.duration;
  if (fadeOutAt !== undefined) {
    const fadeFrom = startedAt + Math.max(0, fadeOutAt - fadeSeconds - offset);
    gain.gain.setValueAtTime(1, fadeFrom);
    gain.gain.linearRampToValueAtTime(0, startedAt + (fadeOutAt - offset));
    until = fadeOutAt;
  }
  source.start(startedAt, offset, until - offset);
  const playing: LabPlaying = { id, buffer, source, startedAt, offset, until };
  source.onended = () => {
    if (labPlaying === playing) labPlaying = undefined;
    notifyLabListeners();
  };
  labPlaying = playing;
  notifyLabListeners();
}

export function stopLabAudio() {
  labPlaying?.source.stop();
  labPlaying = undefined;
  notifyLabListeners();
}

/** Seconds into the buffer playing as `id`, updated every animation frame, or null when it isn't playing. */
export function useLabPlayhead(id: string): number | null {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const p = labPlaying;
      if (p && p.id === id) {
        setAt(Math.min(p.until, p.offset + Math.max(0, labAudio().currentTime - p.startedAt)));
        frame = requestAnimationFrame(tick);
      } else {
        setAt(null);
      }
    };
    const onChange = () => {
      cancelAnimationFrame(frame);
      tick();
    };
    labListeners.add(onChange);
    return () => {
      labListeners.delete(onChange);
      cancelAnimationFrame(frame);
    };
  }, [id]);
  return at;
}
