// retime.ts: the one retime runner every timed project's timeline.test.ts calls (check (e) holds the registration).
//
// A retime is lengthening a bar. On a synthetic track re-fitted to the edited table, every later bar and cue must move
// by exactly the added beat, nothing earlier may move, and every registered move keeps its length. On the unchanged
// recording, the landmarks must refuse the same edit. A move pinned between two bars' moments is what this catches:
// code alone can't tell it from a deliberate stretch, but lengthening the bar between its ends changes its length.

import { defineBarTimeline, type BarTimeline, type BarTimelineSpec, type FittedTrack } from './bar-timeline.ts';
import { FPS } from './frame-rate.ts';

/** Throws, listing every failure, unless each bar of `timeline` can be lengthened as a retime must. */
export function assertBarTimelineRetimes(timeline: BarTimeline): void {
  const { spec } = timeline;
  const failures: string[] = [];
  // A tempo near the track's with a whole number of frames a sixteenth, so every quarter-beat moment sits on a frame
  // and a bar lengthened by a beat moves what follows by exactly that.
  const framesPerBeat = 4 * Math.round((FPS * 60) / timeline.bpm / 4);
  for (let k = 0; k < spec.bars.length; k++) {
    const edited = spec.bars.map((row, i) => (i === k ? { ...row, beats: row.beats + 1 } : row));
    const before = defineBarTimeline({ ...spec, track: syntheticFit(spec, spec.bars, framesPerBeat) });
    const after = defineBarTimeline({ ...spec, bars: edited, track: syntheticFit(spec, edited, framesPerBeat) });
    const fail = (what: string) => failures.push(`bar ${spec.bars[k].id} a beat longer: ${what}`);
    const shiftOf = (i: number, moment: unknown) =>
      i > k || (i === k && typeof moment === 'object' && (moment as { beat: unknown }).beat === 'end') ? framesPerBeat : 0;

    before.bars.forEach((bar, i) => {
      const moved = after.bars[i];
      if (moved.from - bar.from !== (i > k ? framesPerBeat : 0)) fail(`bar ${bar.id} starts ${moved.from - bar.from} frames later`);
      if (moved.to - bar.to !== (i >= k ? framesPerBeat : 0)) fail(`bar ${bar.id} ends ${moved.to - bar.to} frames later`);
      for (const [name, moment] of Object.entries(spec.cues[bar.id] ?? {})) {
        const shift = (moved.cues as Record<string, number>)[name] - (bar.cues as Record<string, number>)[name];
        if (shift !== shiftOf(i, moment)) fail(`cue ${bar.id}.${name} moves ${shift} frames, not ${shiftOf(i, moment)}`);
      }
      for (const name of Object.keys(spec.moves?.[bar.id] ?? {})) {
        const was = (bar.moves as Record<string, { from: number; to: number }>)[name];
        const now = (moved.moves as Record<string, { from: number; to: number }>)[name];
        if (now.to - now.from !== was.to - was.from) {
          fail(`move ${bar.id}.${name} runs ${now.to - now.from} frames, not ${was.to - was.from}: anchor it at one end and give it a length`);
        }
      }
    });
    if (after.end - before.end !== framesPerBeat) fail(`the video ends ${after.end - before.end} frames later`);

    try {
      defineBarTimeline({ ...spec, bars: edited });
      fail('the unchanged recording accepts the longer table; its landmarks should refuse it');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('studio music fit --bars') || !message.includes('change the table')) fail(`the landmark refusal doesn't name both fixes: ${message}`);
    }
  }
  if (failures.length) throw new Error(`the timeline doesn't retime:\n${failures.join('\n')}`);
}

/**
 * A track on a steady grid, `framesPerBeat` apart, re-fitted to `table` as `studio music fit --bars` would: its first
 * downbeat where the real one is, a downbeat every four beats, and each landmark's downbeat on its beat.
 */
function syntheticFit(spec: BarTimelineSpec, table: BarTimelineSpec['bars'], framesPerBeat: number): FittedTrack {
  const spb = framesPerBeat / FPS;
  const first = Math.round(spec.track.fit.downbeats[0] * FPS) / FPS;
  const startOf = (id: string) => {
    const k = table.findIndex((row) => row.id === id);
    return table.slice(0, k).reduce((sum, row) => sum + row.beats, 0);
  };
  const landmarkBeat = (mark: BarTimelineSpec['landmarks'][number]) =>
    startOf(mark.bar) + (mark.beat === 'end' ? table.find((row) => row.id === mark.bar)!.beats : mark.beat);
  const final = Math.max(...spec.landmarks.filter((mark) => mark.downbeat < 0).map(landmarkBeat));
  const downbeatBeats = Array.from({ length: Math.ceil(final / 4) }, (_, i) => i * 4).concat(final);
  for (const mark of spec.landmarks) downbeatBeats[mark.downbeat < 0 ? downbeatBeats.length + mark.downbeat : mark.downbeat] = landmarkBeat(mark);
  // The ring-out after the final hit stays as long as the recording's.
  const tail = spec.track.duration - (spec.track.fit.downbeats.at(-1) ?? 0);
  const duration = first + final * spb + tail;
  const beats = Array.from({ length: Math.ceil((duration - first) / spb) + 1 }, (_, i) => first + i * spb);
  return { bpm: 60 / spb, beats, duration, fit: { downbeats: downbeatBeats.map((beat) => first + beat * spb) } };
}

