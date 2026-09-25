// retime.ts: the one retime runner every timed project's timeline.test.ts calls (check (e) holds the registration).
//
// A retime is lengthening one scene: a beat scene by a beat, a fixed or voiced one by a second. On a synthetic grid
// (re-fitted to the edited timeline, as `studio music fit --bars` would), everything after the scene moves by exactly
// what was added and nothing before it moves: scenes, cues, replays, the music's placement and the project's own
// placements (its sounds, kicks). Every move keeps its length and no scenes overlap. On the unchanged recording, the
// landmarks refuse a longer beat scene and accept a longer scene outside the music. A move pinned between two scenes'
// moments is what this catches: code alone can't tell it from a deliberate stretch, but a retime changes its length.

import { FPS } from './frame-rate.ts';
import {
  defineTimeline, recordedGrid, tempoGrid, type FittedTrack, type SceneMoment, type SceneSpan, type Timeline, type TimelineSpec,
} from './timeline.ts';

/** A project's own event on the video's frame, owned by one scene: a sound's frame, a kick. */
export type TimelinePlacement = { scene: string; id: string; frame: number };

/**
 * Throws, listing every failure, unless each scene of `timeline` can be lengthened as a retime must. `placements`
 * binds the project's scenes to a re-resolved timeline and lists their events, so the runner holds what they place too.
 */
export function assertTimelineRetimes(
  timeline: Timeline,
  { placements }: { placements?: (timeline: Timeline) => readonly TimelinePlacement[] } = {},
): void {
  const spec = timeline.spec as TimelineSpec;
  const keys = [...timeline.keys];
  const failures: string[] = [];
  // A tempo near the grid's with a whole number of frames a sixteenth, so every quarter-beat moment sits on a frame
  // and a scene lengthened by a beat moves what follows by exactly that.
  const framesPerBeat = 4 * Math.round((FPS * timeline.spb) / 4);
  const firstMusicScene = keys.findIndex((key) => spec.scenes[key].driver === 'beat');
  const before = synthetic(spec, spec.scenes, framesPerBeat);
  const placedBefore = placements && new Map(placements(before).map((p) => [`${p.scene}/${p.id}`, p.frame]));

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const span = spec.scenes[key];
    const added = span.driver === 'beat' ? framesPerBeat : FPS;
    const edited = { ...spec.scenes, [key]: span.driver === 'beat' ? { ...span, beats: span.beats + 1 } : { ...span, seconds: span.seconds + 1 } };
    const fail = (what: string) => failures.push(`${key} ${span.driver === 'beat' ? 'a beat' : 'a second'} longer: ${what}`);
    const after = synthetic(spec, edited, framesPerBeat);
    const shiftOf = (i: number, anchoredAtEnd = false) => (i > k || (i === k && anchoredAtEnd) ? added : 0);
    const cueShift = (qualified: string) => {
      const dot = qualified.lastIndexOf('.'), scene = qualified.slice(0, dot);
      return shiftOf(keys.indexOf(scene), anchoredAtEnd(spec.scenes[scene].cues ?? {}, qualified.slice(dot + 1)));
    };

    before.scenes.forEach((scene, i) => {
      const moved = after.scenes[i];
      if (moved.from - scene.from !== shiftOf(i)) fail(`${scene.id} cuts in ${moved.from - scene.from} frames later`);
      if (i < keys.length - 1 && moved.to - scene.to !== (i >= k ? added : 0)) fail(`${scene.id} cuts out ${moved.to - scene.to} frames later`);
      if (i > 0 && moved.from !== after.scenes[i - 1].to) fail(`${scene.id} cuts in on frame ${moved.from}, not where ${after.scenes[i - 1].id} cuts out`);
      if (moved.from >= moved.to) fail(`${scene.id} plays no frames`);
      for (const name of Object.keys(spec.scenes[scene.id].cues ?? {})) {
        const shift = (moved.cues as Record<string, number>)[name] - (scene.cues as Record<string, number>)[name];
        if (shift !== cueShift(`${scene.id}.${name}`)) fail(`cue ${scene.id}.${name} moves ${shift} frames, not ${cueShift(`${scene.id}.${name}`)}`);
      }
      for (const name of Object.keys(spec.scenes[scene.id].moves ?? {})) {
        const was = (scene.moves as Record<string, { from: number; to: number }>)[name];
        const now = (moved.moves as Record<string, { from: number; to: number }>)[name];
        if (now.to - now.from !== was.to - was.from) {
          fail(`move ${scene.id}.${name} runs ${now.to - now.from} frames, not ${was.to - was.from}: anchor it at one end and give it a length`);
        }
      }
    });
    // A replay stays aligned when both its ends move with their cues: on its target cue, its source's cue still plays.
    before.replays.forEach((replay, r) => {
      const moved = after.replays[r];
      if (moved.from - replay.from !== cueShift(replay.fromCue) || moved.to - replay.to !== cueShift(replay.toCue)) {
        fail(`replay ${replay.target}.${replay.name} slips: ${replay.fromCue} on ${replay.toCue} moves ${moved.from - replay.from} and ${moved.to - replay.to} frames`);
      }
    });
    const musicShift = (after.audio[0]?.atSeconds ?? 0) - (before.audio[0]?.atSeconds ?? 0);
    const musicExpected = firstMusicScene >= 0 && k < firstMusicScene ? added / FPS : 0;
    if (Math.abs(musicShift - musicExpected) > 1e-9) fail(`the music moves ${musicShift.toFixed(3)} s, not ${musicExpected.toFixed(3)} s`);
    if (after.end < after.scenes.at(-1)!.end) fail(`the video ends on frame ${after.end}, before its last scene does`);

    if (placedBefore) {
      for (const now of placements!(after)) {
        const then = placedBefore.get(`${now.scene}/${now.id}`);
        if (then === undefined) { fail(`${now.scene}/${now.id} appears`); continue; }
        const i = keys.indexOf(now.scene), shift = now.frame - then;
        // Inside the lengthened scene, an event holds or rides with its end; nowhere else may it do either.
        if (shift !== shiftOf(i) && !(i === k && shift === added)) fail(`${now.scene}/${now.id} moves ${shift} frames, not ${shiftOf(i)}`);
      }
    }

    if (spec.grid.kind === 'recorded') {
      let refusal: string | undefined;
      try {
        defineTimeline({ ...spec, scenes: edited });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (span.driver === 'beat') {
        if (!refusal) fail('the unchanged recording accepts it; its landmarks should refuse');
        else if (!refusal.includes('studio music fit --bars') || !refusal.includes('change the timeline')) fail(`the landmark refusal doesn't name both fixes: ${refusal}`);
      } else if (refusal) {
        fail(`the unchanged recording refuses it, though the music moves with the beats: ${refusal}`);
      }
    }
  }
  if (failures.length) throw new Error(`the timeline doesn't retime:\n${failures.join('\n')}`);
}

/** Whether a cue is its scene's end, or `after` a chain of cues that is: it rides with the end when its scene grows. */
function anchoredAtEnd(cues: Readonly<Record<string, SceneMoment>>, name: string): boolean {
  const moment = cues[name];
  if (moment === 'end') return true;
  if (typeof moment !== 'object') return false;
  return 'after' in moment ? anchoredAtEnd(cues, moment.after) : moment.at === 'end';
}

/**
 * `scenes` on a steady grid, `framesPerBeat` apart. A recorded grid is re-fitted as `studio music fit --bars` would: its
 * first downbeat where the real one is, a downbeat every four beats, each landmark's downbeat on its beat, and the
 * ring-out after the final hit as long as the recording's.
 */
function synthetic(spec: TimelineSpec, scenes: Readonly<Record<string, SceneSpan>>, framesPerBeat: number): Timeline {
  const spb = framesPerBeat / FPS;
  const first = Math.round(spec.grid.beats.at(0) * FPS) / FPS;
  const onTempo = defineTimeline({ ...spec, scenes, grid: tempoGrid(60 / spb, { firstBeat: first }) });
  if (spec.grid.kind === 'tempo') return onTempo;
  const { track } = spec.grid;
  const final = Math.max(...onTempo.landmarks.filter((mark) => mark.downbeat < 0).map((mark) => mark.beat));
  const downbeatBeats = Array.from({ length: Math.ceil(final / 4) }, (_, i) => i * 4).concat(final);
  for (const mark of onTempo.landmarks) downbeatBeats[mark.downbeat < 0 ? downbeatBeats.length + mark.downbeat : mark.downbeat] = mark.beat;
  const tail = track.duration - (track.fit.downbeats.at(-1) ?? 0);
  const duration = first + final * spb + tail;
  const beats = Array.from({ length: Math.ceil((duration - first) / spb) + 1 }, (_, i) => first + i * spb);
  const fitted: FittedTrack = { bpm: 60 / spb, beats, duration, fit: { downbeats: downbeatBeats.map((beat) => first + beat * spb) } };
  return defineTimeline({ ...spec, scenes, grid: recordedGrid(fitted, { steady: spec.grid.steady }) });
}
