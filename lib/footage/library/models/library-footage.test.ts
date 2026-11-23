import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import type { RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { sceneTimes, videoLayoutOf } from '#lib/timing/timeline/models/video-layout.ts';
import { libraryFootage } from './library-footage.ts';
import { LIBRARY_ITEM_FORMAT } from './library-item.ts';

// A recording whose mic starts 0.5 s into item time, its levelled copy measured at -13 LUFS.
const item = {
  format: LIBRARY_ITEM_FORMAT, id: 'take', title: 'Take', source: { kind: 'files', paths: [] }, addedAt: '2026-11-22T00:00:00Z', durationSeconds: 10, speech: 'mic',
  tracks: { mic: { file: 'mic.ogg', mediaSeconds: 9.5, startSeconds: 0.5, audio: { sampleRate: 48000, channels: 1, codec: 'opus' }, levelled: { file: 'proxies/mic-levelled.wav', lufs: -13 } } },
};
const said = [['Each', 1.0, 1.3], ['agent', 1.3, 1.7], ['has', 1.8, 2.0], ['a', 2.0, 2.1], ['definition', 2.1, 2.8], ['um', 3.5, 3.8]];
const transcript = { track: 'mic', duration: 9.5, pauses: [], words: said.map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) })) };
const footage = libraryFootage(item, transcript);

test('a line spoken in a recording is timed, worded and sounded by its stretch, with no voice named', () => {
  const plan = defineStoryboard({
    title: 'Recorded', target: { seconds: 5 },
    scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech: footage.speech(1.45, 3.4), text: 'Each *agent* has a definition', cues: { named: 'definition' } } }, timing: { lead: 0.5, tail: 0.5 } } },
  });
  const { timeline, voice, lines, diagnostics } = resolveStoryboard(plan);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(lines, [{ scene: 'agents', line: 'definition', read: 'spoken' }]);
  // The stretch runs 1.95 s; the transcript's words sit 0.5 s later on item time, so "definition" is 1.15 s in,
  // its cue 1.65 s into the scene (frame 50) after the 0.5 s lead.
  const line = voice.definition;
  assert.equal(line.duration, 1.95);
  assert.equal(line.caption, 'Each *agent* has a definition');
  assert.deepEqual(line.src, { item: 'take', file: 'proxies/mic-levelled.wav', start: 0.95 });
  assert.equal(line.lufs, -13);
  assert.equal(timeline!.clock('agents').cues.named, 50);
  // The picture keeps to the line: 0.5 s into the scene is its start, and the lead runs up to it.
  const scene = videoLayoutOf(timeline!, voice).scenes[0];
  const at = (t: number) => footage.timeAt({ ...sceneTimes(scene), t });
  assert.deepEqual([at(0), at(0.5), at(1.5)].map((x) => Math.round(x * 100) / 100), [0.95, 1.45, 2.45]);
});

const spokenPlan = (speech: RecordedSpeech) => defineStoryboard({
  title: 'Recorded', target: { seconds: 5 }, scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech } } } },
});

test('a spoken line with no text says what the transcript heard, and one not yet levelled stops the plan', () => {
  const unlevelledItem = { ...item, tracks: { mic: { ...item.tracks.mic, levelled: undefined } } };
  const unlevelled = libraryFootage(unlevelledItem, transcript);
  assert.equal(resolveStoryboard(spokenPlan(footage.speech(1.45, 3.4))).voice.definition.text, 'Each agent has a definition');
  const { diagnostics } = resolveStoryboard(spokenPlan(unlevelled.speech(1.45, 3.4)));
  assert.match(diagnostics.map((d) => d.message).join('\n'), /isn't levelled for the mix yet: run studio library finish take/);
});
