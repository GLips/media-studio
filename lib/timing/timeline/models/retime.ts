// retime.ts: the one retime runner every timed project's timeline.test.ts calls.
//
// A retime is lengthening one scene: a beat scene by a beat, a fixed one by a second, and a voiced one by re-recording
// its first line a second slower. On a grid re-fitted as `studio music fit --bars` would, everything after the scene
// moves by exactly what was added and nothing before it moves, the project's own placements included. Inside a
// re-recorded scene, a speech cue moves with its word and a cue in seconds stays put. On the unchanged recording, the
// landmarks refuse a longer beat scene. What this catches is a move pinned between two moments: code alone can't tell
// it from a deliberate stretch.

import {
  defineTimeline, recordedGrid, tempoGrid, type FittedTrack, type SceneMoment, type SceneSpan, type SpeechCue, type Timeline,
  type TimelineSpec, type TimelineVoice,
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
  const { fps } = timeline;
  const framesPerBeat = 4 * Math.round((fps * timeline.spb) / 4);
  const firstMusicScene = keys.findIndex((key) => spec.scenes[key].driver === 'beat');
  const voice: TimelineVoice = spec.voice ?? {};
  const before = synthetic(spec, spec.scenes, voice, framesPerBeat, fps);
  const placedBefore = placements && new Map(placements(before).map((p) => [`${p.scene}/${p.id}`, p.frame]));

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const span = spec.scenes[key];
    const edited = span.driver === 'beat' ? { ...spec.scenes, [key]: { ...span, beats: span.beats + 1 } }
      : span.driver === 'fixed' ? { ...spec.scenes, [key]: { ...span, seconds: span.seconds + 1 } } : spec.scenes;
    const reread = span.driver === 'voice' ? span.lines[0] : undefined;
    const editedVoice = reread === undefined ? voice : { ...voice, [reread]: slowerToFirstWord(voice[reread]) };
    const fail = (what: string) => failures.push(`${key} ${span.driver === 'beat' ? 'a beat longer' : span.driver === 'fixed' ? 'a second longer' : `with ${reread} re-read a second slower`}: ${what}`);
    const after = synthetic(spec, edited, editedVoice, framesPerBeat, fps);
    // A re-read lengthens its scene by the second, unless its `min` holds it.
    const added = span.driver === 'beat' ? framesPerBeat : span.driver === 'fixed' ? fps : after.scenes[k].end - before.scenes[k].end;
    const shiftOf = (i: number, anchoredAtEnd = false) => (i > k || (i === k && anchoredAtEnd) ? added : 0);
    // Inside the re-read scene, a word moves by the second, and so does every line after the re-read one.
    const spokenShift = (i: number, line: string, onWord: boolean) => (i === k && reread !== undefined && (onWord || line !== reread) ? fps : shiftOf(i));
    const cueShift = (qualified: string) => {
      const dot = qualified.lastIndexOf('.'), scene = qualified.slice(0, dot), i = keys.indexOf(scene);
      const cues = spec.scenes[scene].cues ?? {}, name = qualified.slice(dot + 1), spoken = speechAnchor(cues, name);
      return spoken ? spokenShift(i, spoken.line, spoken.phrase !== undefined) : shiftOf(i, anchoredAtEnd(cues, name));
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
    before.audio.forEach((placed, a) => {
      const moved = after.audio[a];
      if (placed.kind !== 'voice' || moved.kind !== 'voice') return;
      const expected = spokenShift(keys.indexOf(placed.scene), placed.line, false);
      if (moved.frame - placed.frame !== expected) fail(`line ${placed.line} moves ${moved.frame - placed.frame} frames, not ${expected}`);
    });
    // A tempo-only grid places no recording, so there's no music to move: its beats move with their scenes, held above.
    if (spec.grid?.kind === 'recorded') {
      const musicAt = (timeline: Timeline) => timeline.audio.find((placed) => placed.kind === 'music')?.atSeconds ?? 0;
      const musicShift = musicAt(after) - musicAt(before);
      const musicExpected = firstMusicScene >= 0 && k < firstMusicScene ? added / fps : 0;
      if (Math.abs(musicShift - musicExpected) > 1e-9) fail(`the music moves ${musicShift.toFixed(3)} s, not ${musicExpected.toFixed(3)} s`);
    }
    if (after.end < after.scenes.at(-1)!.end) fail(`the video ends on frame ${after.end}, before its last scene does`);

    if (placedBefore) {
      for (const now of placements(after)) {
        const then = placedBefore.get(`${now.scene}/${now.id}`);
        if (then === undefined) { fail(`${now.scene}/${now.id} appears`); continue; }
        const i = keys.indexOf(now.scene), shift = now.frame - then;
        // Inside the lengthened scene, an event holds or rides with its end; nowhere else may it do either.
        if (shift !== shiftOf(i) && !(i === k && shift === added)) fail(`${now.scene}/${now.id} moves ${shift} frames, not ${shiftOf(i)}`);
      }
    }

    if (spec.grid?.kind === 'recorded') {
      let refusal: string | undefined;
      try {
        defineTimeline({ ...spec, scenes: edited, voice: editedVoice });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (span.driver === 'beat') {
        if (!refusal) {
          fail('the unchanged recording accepts it, as no landmark moves with the longer scene; its landmarks should refuse. Put '
            + "the music's final hit on the last beat scene's end (a cue `'end'`, its landmark `downbeat: -1`): the recording rings out past it");
        }
        else if (!refusal.includes('studio music fit --bars') || !refusal.includes('change the timeline')) fail(`the landmark refusal doesn't name both fixes: ${refusal}`);
      } else if (refusal) {
        fail(`the unchanged recording refuses it, though the music moves with the beats: ${refusal}`);
      }
    }
  }
  if (failures.length) throw new Error(`the timeline doesn't retime:\n${failures.join('\n')}`);
}

/** The speech cue a cue sits on, directly or `after` a chain of cues, if any: it moves with its word. */
function speechAnchor(cues: Readonly<Record<string, SceneMoment>>, name: string): SpeechCue | undefined {
  const moment = cues[name];
  if (typeof moment !== 'object') return undefined;
  if ('line' in moment) return moment;
  return 'after' in moment ? speechAnchor(cues, moment.after) : undefined;
}

/** A line re-read with a second more before its first word: its start holds, and every word moves by the second. */
function slowerToFirstWord(take: TimelineVoice[string]): TimelineVoice[string] {
  return { ...take, duration: take.duration + 1, words: take.words.map((word) => ({ ...word, start: word.start + 1, end: word.end + 1 })) };
}

/** Whether a cue is its scene's end, or `after` a chain of cues that is: it rides with the end when its scene grows. */
function anchoredAtEnd(cues: Readonly<Record<string, SceneMoment>>, name: string): boolean {
  const moment = cues[name];
  if (moment === 'end') return true;
  if (typeof moment !== 'object') return false;
  if ('after' in moment) return anchoredAtEnd(cues, moment.after);
  return 'at' in moment && moment.at === 'end';
}

/**
 * `scenes` on a steady grid, `framesPerBeat` apart. A recorded grid is re-fitted as `studio music fit --bars` would: its
 * first downbeat where the real one is, a downbeat every four beats, each landmark's downbeat on its beat, and the
 * ring-out after the final hit as long as the recording's.
 */
function synthetic(spec: TimelineSpec, scenes: Readonly<Record<string, SceneSpan>>, voice: TimelineVoice, framesPerBeat: number, fps: number): Timeline {
  if (!spec.grid) return defineTimeline({ ...spec, scenes, voice });
  const spb = framesPerBeat / fps;
  const first = Math.round(spec.grid.beats.at(0) * fps) / fps;
  const onTempo = defineTimeline({ ...spec, scenes, voice, grid: tempoGrid(60 / spb, { firstBeat: first }) });
  if (spec.grid.kind === 'tempo') return onTempo;
  const { track } = spec.grid;
  const final = Math.max(...onTempo.landmarks.filter((mark) => mark.downbeat < 0).map((mark) => mark.beat));
  const downbeatBeats = Array.from({ length: Math.ceil(final / 4) }, (_, i) => i * 4).concat(final);
  for (const mark of onTempo.landmarks) downbeatBeats[mark.downbeat < 0 ? downbeatBeats.length + mark.downbeat : mark.downbeat] = mark.beat;
  const tail = track.duration - (track.fit.downbeats.at(-1) ?? 0);
  const duration = first + final * spb + tail;
  const beats = Array.from({ length: Math.ceil((duration - first) / spb) + 1 }, (_, i) => first + i * spb);
  const fitted: FittedTrack = { bpm: 60 / spb, beats, duration, fit: { downbeats: downbeatBeats.map((beat) => first + beat * spb) } };
  return defineTimeline({ ...spec, scenes, voice, grid: recordedGrid(fitted, { steady: spec.grid.steady }) });
}
