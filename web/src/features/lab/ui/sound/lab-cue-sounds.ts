// The cue list's sounds, rendered in the browser by lib/sfx, so what plays in the editor is what a render plays.
import { SFX_RATE } from '#sfx/dsp.ts';
import { renderSfx, type SfxRequest } from '#sfx/library.ts';
import { labAudio } from './lab-audio.ts';

export type LabCueRender = { buffer: AudioBuffer; landsAt: number };
const labCueRenders = new Map<string, LabCueRender>();

/** A request rendered once and kept; the same request always renders the same samples, so the key is the request. */
export function renderLabCueSound(sound: SfxRequest): LabCueRender {
  const key = JSON.stringify(sound);
  let rendered = labCueRenders.get(key);
  if (!rendered) {
    const { samples, landsAt } = renderSfx(sound);
    const buffer = labAudio().createBuffer(1, samples.length, SFX_RATE);
    buffer.copyToChannel(Float32Array.from(samples, (v) => v / 32767), 0);
    rendered = { buffer, landsAt };
    labCueRenders.set(key, rendered);
  }
  return rendered;
}

let labCuePreview: AudioBufferSourceNode | undefined;
/** One sound on its own, at a cue's volume. Another preview cuts it off. */
export function previewLabCueSound(sound: SfxRequest, volume = 1) {
  const ctx = labAudio(), { buffer } = renderLabCueSound(sound);
  void ctx.resume();
  labCuePreview?.stop();
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
  labCuePreview = source;
}
