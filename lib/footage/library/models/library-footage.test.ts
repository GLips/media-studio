import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import type { RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { sceneTimes, videoLayoutOf } from '#lib/timing/timeline/models/video-layout.ts';
import { libraryFootage, libraryTranscriptLines } from './library-footage.ts';
import { LIBRARY_ITEM_FORMAT } from './library-item.ts';

// A recording whose mic starts 0.5 s into item time, its levelled copy measured at -13 LUFS and quiet (on media time)
// until a breath before "Each", from a decay after "definition" until "um", and after "um".
const item = {
  format: LIBRARY_ITEM_FORMAT, id: 'take', title: 'Take', source: { kind: 'files', paths: [] }, addedAt: '2026-11-22T00:00:00Z', durationSeconds: 10, speech: 'mic',
  tracks: { mic: { file: 'mic.ogg', mediaSeconds: 9.5, startSeconds: 0.5, audio: { sampleRate: 48000, channels: 1, codec: 'opus' }, levelled: { file: 'proxies/mic-levelled.wav', lufs: -13, quiet: [[0.2, 0.95], [2.95, 3.45], [3.9, 9.5]] } } },
};
const said = [['Each', 1.0, 1.3], ['agent', 1.3, 1.7], ['has', 1.8, 2.0], ['a', 2.0, 2.1], ['definition', 2.1, 2.8], ['um', 3.5, 3.8]];
const pauses = [{ start: 0.2, end: 1.0 }, { start: 2.8, end: 3.5 }, { start: 3.8, end: 9.5 }];
const mic = { duration: 9.5, pauses, unheard: [], words: said.map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) })) };
const transcript = { heardBy: 'test', tracks: { mic } };
const footage = libraryFootage(item, transcript);

test('a line spoken in a recording is timed, worded and sounded by its stretch, cut in its quiet, with no voice named', () => {
  // Asked from the line's first word to the next one's, as `studio library show` prints them, or from inside the
  // pauses: either way each edge lands in the quiet, 0.12 s before the breath and 0.1 s after "definition" decays.
  const speech = footage.speech(1.5, 4.0);
  assert.deepEqual(footage.speech(1.45, 3.4), speech);
  assert.deepEqual([speech.from, speech.to], [1.33, 3.55]);
  assert.deepEqual(speech.edges, { in: 'clean', out: 'clean' });
  const plan = defineStoryboard({
    title: 'Recorded', target: { seconds: 5 },
    scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech, text: 'Each *agent* has a definition', cues: { named: 'definition' } } }, timing: { lead: 0.5, tail: 0.5 } } },
  });
  const { timeline, voice, lines, diagnostics } = resolveStoryboard(plan);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(lines, [{ scene: 'agents', line: 'definition', read: 'spoken' }]);
  // The transcript's words sit 0.5 s later on item time, so "definition" is 1.27 s into the stretch, its cue 1.77 s
  // into the scene (frame 53) after the 0.5 s lead.
  const line = voice.definition;
  assert.equal(line.duration.toFixed(3), '2.220');
  assert.equal(line.caption, 'Each *agent* has a definition');
  const src = line.src as { start: number };
  assert.deepEqual({ ...src, start: Math.round(src.start * 1000) / 1000 }, { item: 'take', file: 'proxies/mic-levelled.wav', start: 0.83, fade: { in: 0.03, out: 0.06 } });
  assert.equal(line.lufs, -13);
  assert.equal(timeline!.clock('agents').cues.named, 53);
  // The picture keeps to the line: 0.5 s into the scene is its start, and the lead runs up to it.
  const scene = videoLayoutOf(timeline!, voice).scenes[0];
  const at = (t: number) => footage.timeAt({ ...sceneTimes(scene), t });
  assert.deepEqual([at(0), at(0.5), at(1.5)].map((x) => Math.round(x * 100) / 100), [0.83, 1.33, 2.33]);
});

const spokenPlan = (speech: RecordedSpeech) => defineStoryboard({
  title: 'Recorded', target: { seconds: 5 }, scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech } } } },
});

test('a spoken line with no text says what the transcript heard, and one not yet levelled stops the plan', () => {
  const { levelled: _, ...unlevelledMic } = item.tracks.mic;
  const unlevelledItem = { ...item, tracks: { mic: unlevelledMic } };
  const unlevelled = libraryFootage(unlevelledItem, transcript);
  assert.equal(resolveStoryboard(spokenPlan(footage.speech(1.45, 3.4))).voice.definition.text, 'Each agent has a definition');
  const { diagnostics } = resolveStoryboard(spokenPlan(unlevelled.speech(1.45, 3.4)));
  assert.match(diagnostics.map((d) => d.message).join('\n'), /isn't levelled for the mix yet: run studio library finish take/);
});

test('an edge with no quiet before the next word cuts into sound: the plan flags it unless the line means it, and it fades longer', () => {
  // "agent" runs into "has" with no quiet between, so the out-point falls midway and cuts into the room.
  const speech = footage.speech(1.5, 2.2);
  assert.deepEqual([speech.to, speech.edges.out, speech.sound?.fade.out], [2.25, 'rough', 0.12]);
  const plan = (hardEdge?: true) => defineStoryboard({
    title: 'Recorded', target: { seconds: 5 }, scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech, ...(hardEdge && { hardEdge }) } } } },
  });
  assert.match(resolveStoryboard(plan()).diagnostics.map((d) => d.message).join('\n'), /out-point \(2\.25 s of take\) cuts into sound/);
  assert.deepEqual(resolveStoryboard(plan(true)).diagnostics, []);
});

test("a call's two sides are one transcript: its words interleave by track, and a line speaks from either", () => {
  const call = {
    ...item,
    tracks: { ...item.tracks, system: { file: 'system.m4a', mediaSeconds: 9.8, startSeconds: 0.2, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, levelled: { file: 'proxies/system-levelled.wav', lufs: -15, quiet: [[4.0, 5.0], [6.05, 9.8]] } } },
  };
  const agent = { duration: 9.8, unheard: [], pauses: [{ start: 4.0, end: 5.0 }, { start: 6.0, end: 9.8 }], words: [{ text: 'Want', start: 5.0, end: 5.4 }, { text: 'it?', start: 5.4, end: 6.0 }] };
  const both = libraryFootage(call, { heardBy: 'test', tracks: { mic, system: agent } });
  // The mic's words, then the agent's 0.2 s later on item time: one line each, though no pause parts "um" from "Want".
  assert.deepEqual(libraryTranscriptLines(both.words).map((l) => [l.track, l.text]), [['mic', 'Each agent has a definition'], ['mic', 'um'], ['system', 'Want it?']]);
  // A word said over the mic's line ("Yes" under "has") reads as a line of its own, after the line it interrupts.
  const over = libraryFootage(call, { heardBy: 'test', tracks: { mic, system: { ...agent, words: [{ text: 'Yes', start: 1.8, end: 2.0 }] } } });
  assert.deepEqual(libraryTranscriptLines(over.words).map((l) => l.text), ['Each agent has a definition', 'Yes', 'um']);
  const reply = both.speech(5.0, 6.5, 'system');
  assert.deepEqual(reply.heard.map((w) => w.text), ['Want', 'it?']);
  assert.deepEqual(reply.sound && { file: reply.sound.file, lufs: reply.sound.lufs }, { file: 'proxies/system-levelled.wav', lufs: -15 });
});
