// The Sound tab's one speaker: a single AudioContext plays one buffer at a time (starting another stops the last), and
// says where its playhead is, so a waveform or timeline can draw it.

let labAudioContext: AudioContext | undefined;
/** Created on first use: browsers only let a context make sound once the page has had a click or key press. */
export const labAudio = () => (labAudioContext ??= new AudioContext());

type LabPlaying = { id: string; source: AudioBufferSourceNode; startedAt: number; offset: number; until: number };
let labPlaying: LabPlaying | undefined;
const labListeners = new Set<() => void>();
const notifyLabListeners = () => labListeners.forEach((f) => f());

export function audioBufferFromChannels(channels: readonly Float32Array[], rate: number): AudioBuffer {
  const buffer = labAudio().createBuffer(channels.length, channels[0].length, rate);
  channels.forEach((c, i) => buffer.copyToChannel(new Float32Array(c), i));
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
  const playing: LabPlaying = { id, source, startedAt, offset, until };
  source.addEventListener('ended', () => {
    if (labPlaying === playing) labPlaying = undefined;
    notifyLabListeners();
  });
  labPlaying = playing;
  notifyLabListeners();
}

export function stopLabAudio() {
  labPlaying?.source.stop();
  labPlaying = undefined;
  notifyLabListeners();
}

/** Seconds into the buffer playing as `id`, or null when it isn't the one playing. */
export function labPlayheadOf(id: string): number | null {
  const p = labPlaying;
  if (!p || p.id !== id) return null;
  return Math.min(p.until, p.offset + Math.max(0, labAudio().currentTime - p.startedAt));
}

/** Calls `listener` whenever something starts or stops playing; returns the unsubscribe. */
export function onLabAudioChange(listener: () => void): () => void {
  labListeners.add(listener);
  return () => labListeners.delete(listener);
}
