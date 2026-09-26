// The music fit in the browser: a project's track decoded with Web Audio and run through lib/models/music/music-fit.ts
// as `studio music fit` does (mono at 22.05 kHz to plan, the source's own channels to splice).
import { planMusicFit, spliceMusicSpans, type MusicFitPlan } from '#models/music/music-fit.ts';
import type { LabMusicTrack } from '#models/lab/lab-catalog.ts';
import { fetchStudioUrl } from '#web/infrastructure/api-client.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { audioBufferFromChannels, labAudio } from './lab-audio.ts';

// lib/engine/music/music-track.ts plans on mono at this rate; matching it gives the same spans the CLI would.
const MUSIC_FIT_ANALYSIS_RATE = 22050;

/** Each span's colour, the same in the song and the fit, cycling. */
export const LAB_MUSIC_SPAN_COLORS = [colors.accent, colors.cobalt, colors.pass, colors.musicSpanGold, colors.musicSpanViolet, colors.musicSpanTeal] as const;
export const labMusicSpanColor = (i: number) => LAB_MUSIC_SPAN_COLORS[i % LAB_MUSIC_SPAN_COLORS.length];

export type DecodedLabMusic = { buffer: AudioBuffer; mono: Float32Array };
export type LabMusicFitResult = { plan: MusicFitPlan; fitted: AudioBuffer; seconds: number; planMs: number } | { error: string; seconds: number };

const decodedMusic = new Map<string, Promise<DecodedLabMusic>>();

/** The track as the browser decodes it, and a mono mixdown resampled for planning. Cached per track. */
export function decodeLabMusicTrack(track: LabMusicTrack): Promise<DecodedLabMusic> {
  let decoding = decodedMusic.get(track.id);
  if (!decoding) {
    decoding = (async () => {
      const buffer = await labAudio().decodeAudioData(await (await fetchStudioUrl(track.url)).arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * MUSIC_FIT_ANALYSIS_RATE), MUSIC_FIT_ANALYSIS_RATE);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      return { buffer, mono: (await offline.startRendering()).getChannelData(0) };
    })();
    decodedMusic.set(track.id, decoding);
    // A failed fetch or decode isn't kept, so choosing the track again retries it.
    decoding.catch(() => decodedMusic.delete(track.id));
  }
  return decoding;
}

export function fitDecodedLabMusic({ buffer, mono }: DecodedLabMusic, beats: readonly number[], seconds: number): LabMusicFitResult {
  const started = performance.now();
  try {
    const plan = planMusicFit({ samples: mono, rate: MUSIC_FIT_ANALYSIS_RATE, beats, targetSeconds: seconds });
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const fitted = audioBufferFromChannels(spliceMusicSpans(channels, buffer.sampleRate, plan.spans, seconds), buffer.sampleRate);
    return { plan, fitted, seconds, planMs: performance.now() - started };
  } catch (error) {
    // The failures worth showing are planMusicFit's own about the track (a length it can't reach on its bar lines, too
    // few beats); anything else is a bug and should surface as one.
    if (!(error instanceof Error) || !/can't fit|fitting needs|is silent/.test(error.message)) throw error;
    return { error: error.message, seconds };
  }
}
