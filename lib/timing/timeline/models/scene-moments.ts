// scene-moments.ts: each scene of a resolved timeline with the moments named in it: its cues, the replays landing in
// it, the landmarks tied to the music and its voiced lines, each on its frame and in timeline.ts's own words. The clock
// table carries them into a render's snapshot, and studio review's storyboard takes a music-led video's stills on them,
// so a pacing note reads straight back onto the line it changes.

import type { SceneMoment, SceneSpan, Timeline } from './timeline.ts';

/** A named moment in a scene: where it lands, and where timeline.ts puts it. */
export type TimelineMoment = { kind: 'cue' | 'replay' | 'landmark' | 'line'; name: string; frame: number; at: string };

export type TimelineSceneMoments = {
  n: number;
  id: string;
  driver: SceneSpan['driver'];
  /** Its cut, and the next scene's (or the video's end), exclusive. */
  from: number;
  to: number;
  /** Its length in beats (a beat scene), or 0. */
  beats: number;
  /** Which beat of the music's bar it cuts in on, 1 being the downbeat; null off the musical section. */
  musicBeat: number | null;
  /** In frame order. A moment may land outside from–to: a cue on a held frame, a landmark on the ring-out. */
  moments: readonly TimelineMoment[];
};

export function timelineSceneMoments(timeline: Timeline): TimelineSceneMoments[] {
  return timeline.scenes.map((scene, k) => {
    const span = timeline.spec.scenes[scene.id];
    const moments: TimelineMoment[] = [
      ...Object.entries(scene.cues).map(([name, frame]) => ({
        kind: 'cue' as const, name, frame, at: momentWords(span.cues![name], span.driver),
      })),
      ...timeline.replays.filter((replay) => replay.target === scene.id).map((replay) => ({
        kind: 'replay' as const, name: replay.name, frame: replay.to, at: `${replay.fromCue} on ${replay.toCue}`,
      })),
      ...timeline.landmarks.filter((mark) => mark.cue.startsWith(`${scene.id}.`)).map((mark) => ({
        kind: 'landmark' as const, name: mark.name, frame: mark.frame, at: `${mark.cue} on the music's downbeat ${mark.downbeat}`,
      })),
      ...scene.lines.map((line) => ({ kind: 'line' as const, name: line.id, frame: line.frame, at: `${line.duration.toFixed(2)} s` })),
    ];
    return {
      n: scene.n, id: scene.id, driver: scene.driver, from: scene.from, to: scene.to, beats: scene.beats,
      musicBeat: timeline.musicBeats[k], moments: moments.toSorted((a, b) => a.frame - b.frame),
    };
  });
}

/** A cue's position as timeline.ts writes it: `beat 3 +4f`, `after land`, `"click" in fix-a`. */
function momentWords(moment: SceneMoment, driver: SceneSpan['driver']): string {
  const unit = (at: number | 'end') => (at === 'end' ? 'end' : driver === 'beat' ? `beat ${at}` : `${at} s`);
  const nudge = (frames = 0) => (frames ? ` ${frames > 0 ? '+' : ''}${frames}f` : '');
  if (typeof moment !== 'object') return unit(moment);
  if ('after' in moment) return `after ${moment.after}${nudge(moment.frames)}`;
  if ('line' in moment) return `${moment.phrase ? `"${moment.phrase}" in ` : ''}${moment.line}${nudge(moment.frames)}`;
  return `${unit(moment.at)}${nudge(moment.frames)}`;
}
