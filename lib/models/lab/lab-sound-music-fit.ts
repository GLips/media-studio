// lab-sound-music-fit.ts: the Sound tab's music fit, as numbers and words: which lane each stretch of the song draws
// in, where each lands in the fit, how a track is named and how many bars a jump covers.
import type { MusicFitPlan } from '#models/music/music-fit.ts';
import type { LabMusicTrack } from './lab-catalog.ts';

/**
 * Each span's lane in the song's row: the first lane that's free by the time the span starts. A fit that plays part
 * of the song twice gets a lane per time through, so it stays readable at any length.
 */
export function musicSpanLanes(spans: MusicFitPlan['spans']): { lanes: number[]; count: number } {
  const laneEnds: number[] = [];
  const lanes = spans.map((s) => {
    const from = Math.max(0, s.from);
    let lane = laneEnds.findIndex((end) => end <= from + 1e-6);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = s.to;
    return lane;
  });
  return { lanes, count: laneEnds.length };
}

/** Where each span starts in the fitted track: the lengths of the spans before it. */
export const musicSpanOffsets = (spans: MusicFitPlan['spans']) =>
  spans.map((_, i) => spans.slice(0, i).reduce((sum, s) => sum + s.to - s.from, 0));

/** A track's name and length, and its project too when another project has a track of the same name. */
export const musicTrackLabel = (t: LabMusicTrack, all: readonly LabMusicTrack[]) =>
  `${t.name}${all.filter((o) => o.name === t.name).length > 1 ? ` (${t.project.replace(/^\d{4}-\d{2}-/, '')})` : ''} · ${t.duration.toFixed(0)} s`;

/** Bars of four beats in `seconds` at `bpm`, rounded. */
export const musicBarsIn = (seconds: number, bpm: number) => Math.round((seconds * bpm) / 60 / 4);
