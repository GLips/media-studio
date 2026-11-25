// render-sound.ts: a render's sound walk, gathered by render-session.ts's gatherSound: each frame's sound clips, as its
// SoundClipProbe reports them, and where ffmpeg reads each clip's file once the render's page server has closed.
import type { OnArtifact } from '@remotion/renderer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placedSoundClipsOf, soundClipArtifactName, type PlacedSoundClip, type SoundClipFrameReport } from '#lib/timing/sound/models/sound-clip.ts';

// Remotion's own sound never reaches the mix, which gathers SoundClips alone.
export const REMOTION_SOUND_UNHEARD = "a sound plays through Remotion's <Audio> or an unmuted <Video>, which the mix doesn't hear: play it with SoundClip (`#studio`)";

/** Collects a sound walk's frame reports; `placed` is the video's clips once every frame has reported. */
export function soundClipReportSink() {
  const reports = new Map<number, SoundClipFrameReport>();
  // A frame drawn again reports the same clips, so the last report stands.
  const onArtifact: OnArtifact = ({ filename, content }) => {
    if (!/^sound-clips-\d+\.json$/.test(filename)) return;
    // SAFETY: SoundClipProbe writes these, as soundClipArtifactName names them, from a SoundClipFrameReport.
    const report = JSON.parse(Buffer.from(content).toString('utf8')) as SoundClipFrameReport;
    if (filename !== soundClipArtifactName(report.frame)) throw new Error(`${filename} reports frame ${report.frame}`);
    reports.set(report.frame, report);
  };
  return { onArtifact, placed: (fps: number, frames: number): PlacedSoundClip[] => placedSoundClipsOf([...reports.values()], fps, frames) };
}

/**
 * What ffmpeg reads for a clip's URL: library media over the library's server, which outlives a render; anything else
 * the render's page server served, from the bundle's folder, since that server closes with the render.
 */
export function renderSoundFileOf({ bundle, libraryMedia }: { bundle: string; libraryMedia: string }): (src: string) => string {
  const library = `${libraryMedia.replace(/\/$/, '')}/`;
  return (src) => {
    if (src.startsWith(library) || src.startsWith('data:')) return src;
    const url = new URL(src);
    if (url.protocol === 'file:') return fileURLToPath(url);
    const file = join(bundle, decodeURIComponent(url.pathname));
    if (!existsSync(file)) throw new Error(`a sound's file ${src} isn't in the bundle at ${file}`);
    return file;
  };
}
