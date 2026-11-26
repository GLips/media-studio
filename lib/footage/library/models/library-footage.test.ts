import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { spokenItemTimeAt, spokenStretchSeconds, type LibraryVoiceSound, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
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
  const src = line.src as LibraryVoiceSound;
  assert.deepEqual(src.pieces.map((p) => Math.round(p.start * 1000) / 1000), [0.83]);
  assert.deepEqual([src.item, src.file, src.fade], ['take', 'proxies/mic-levelled.wav', { in: 0.03, out: 0.06 }]);
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
  const reply = both.speech(5.0, 6.5, { track: 'system' });
  assert.deepEqual(reply.heard.map((w) => w.text), ['Want', 'it?']);
  assert.deepEqual(reply.sound && { file: reply.sound.file, lufs: reply.sound.lufs }, { file: 'proxies/system-levelled.wav', lufs: -15 });
});

// A verbatim take on item time: a stutter, a filler between quiet, a long pause with a breath before the last word,
// and a click in the quiet after "the".
const verbatimSaid = [['So', 0.5, 0.8], ['I', 1.0, 1.1], ['I', 1.2, 1.3], ['was', 1.3, 1.5], ['on', 1.5, 1.7], ['the', 1.7, 1.9], ['uh,', 2.1, 2.5], ['voice', 2.7, 3.1], ['call.', 5.0, 5.4]];
const verbatimItem = {
  ...item, id: 'verbatim',
  tracks: { mic: { ...item.tracks.mic, mediaSeconds: 6, startSeconds: 0, levelled: {
    file: 'proxies/mic-levelled.wav', lufs: -13, soft: [[4.5, 4.8]], clicks: [[1.95, 1.97]],
    quiet: [[0, 0.5], [0.8, 1.0], [1.1, 1.2], [1.9, 2.1], [2.5, 2.7], [3.1, 4.5], [4.8, 5.0], [5.4, 6]],
  } } },
};
const verbatim = libraryFootage(verbatimItem, { heardBy: 'test', tracks: { mic: { duration: 6, pauses: [], unheard: [], words: verbatimSaid.map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) })) } } });

test('a recorded line drops its stutters and fillers and plays its long pause faster, each change in quiet, and lists each for review', () => {
  const speech = verbatim.speech(0.9, 5.5);
  // The first "I" goes with the line's in-point; "uh" from the quiet after "the" to the quiet before "voice"; the pause
  // after "voice" plays faster between its decay and the quiet before the breath, which plays as recorded.
  assert.deepEqual([speech.pieces[0], speech.pieces[1].from, speech.pieces.at(-1)], [{ from: 1.1, to: 2 }, 2.58, { from: 4.38, to: 5.5 }]);
  const sped = speech.pieces.slice(2, -1);
  assert.ok(sped.every((p, k) => p.from === speech.pieces[k + 1].to && p.speed! > 1 && p.speed! <= 3), 'butted, never past top speed');
  assert.deepEqual(speech.removals.map(({ kind, text, at, keepAt }) => [kind, text, at, keepAt]), [['repeat', 'I', 0, 1.05], ['filler', 'uh,', 0.9, 2.3]]);
  assert.deepEqual(speech.pauses.map(({ kind, from, to, speed, keepAt }) => [kind, from, to, speed, keepAt]), [['hesitation', 3.1, 4.8, 3, 3.95]]);
  // The breath plays 8 dB down and the click not at all.
  assert.deepEqual(speech.sound?.dips, [{ start: 0.845, end: 0.875, gain: 0 }, { start: 2.167, end: 2.467, gain: 0.4 }]);
  const { voice } = resolveStoryboard(spokenPlan(speech));
  assert.equal(voice.definition.text, 'I was on the voice call.');
  assert.equal(voice.definition.duration.toFixed(2), '3.17');
  assert.deepEqual(voice.definition.words.map((w) => w.start), [0.1, 0.2, 0.4, 0.6, 1.02, 2.667]);
});

test("a line restores what its cleanup took by a moment in it, cuts a word the rules kept, and paces its own pauses", () => {
  const kept = verbatim.speech(0.9, 5.5, { keep: [2.3, 3.95] });
  assert.deepEqual(kept.pieces, [{ from: 1.1, to: 5.5 }]);
  // Review still lists what was restored, where it now plays, to take out again.
  assert.deepEqual(kept.removals.map(({ kind, at, left }) => [kind, at, left]), [['repeat', 0, undefined], ['filler', 1, 'kept'], ['pause', 2, 'kept']]);
  assert.throws(() => verbatim.speech(0.9, 5.5, { keep: [0.95] }), /takes nothing out at 0\.95 s to keep/);
  // "on" runs into its neighbours with no quiet, so it's cut where it's asked, into sound.
  const cut = verbatim.speech(0.9, 5.5, { cut: [1.6], pauses: false });
  assert.deepEqual(cut.heard.map((w) => w.text), ['I', 'was', 'the', 'voice', 'call.']);
  assert.deepEqual(cut.removals.map((r) => [r.kind, r.cut]), [['repeat', undefined], ['cut', true], ['filler', undefined]]);
  // A pause review kept stays kept once its line plays every pause as recorded.
  assert.deepEqual(verbatim.speech(0.9, 5.5, { keep: [3.95], pauses: false }).pieces.length, 2);
  // A project's own rule cleans the same way, here leaving fillers in.
  assert.deepEqual(libraryFootageWords(verbatim.speech(0.9, 5.5, { rules: [] })), ['I', 'I', 'was', 'on', 'the', 'uh,', 'voice', 'call.']);
});

// Two pauses of 1.2 s, one where a sentence ends and one mid-phrase, then one of 5 s.
const pacedSaid = [['It', 0.5, 0.8], ['works.', 0.8, 1.2], ['And', 2.4, 2.7], ['the', 2.7, 3.0], ['next', 4.2, 4.5], ['one', 4.5, 4.9], ['waits.', 9.9, 10.3]];
const pacedItem = {
  ...item, id: 'paced', tracks: { mic: { ...item.tracks.mic, mediaSeconds: 11, startSeconds: 0, levelled: { file: 'proxies/mic-levelled.wav', lufs: -13, quiet: [[0, 0.5], [1.2, 2.4], [3.0, 4.2], [4.9, 9.9], [10.3, 11]] } } },
};
const paced = libraryFootage(pacedItem, { heardBy: 'test', tracks: { mic: { duration: 11, pauses: [], unheard: [], words: pacedSaid.map(([text, start, end]) => ({ text: String(text), start: Number(start), end: Number(end) })) } } });

test('a pause mid-phrase plays shorter than one ending a sentence, the face keeps to its words, and the voice keeps its pace', () => {
  const speech = paced.speech(0.4, 10.4);
  const [boundary, hesitation, long] = speech.pauses;
  assert.deepEqual([boundary.kind, hesitation.kind, long.kind], ['boundary', 'hesitation', 'hesitation']);
  assert.ok(hesitation.plays < boundary.plays && boundary.plays < 1.2, `${hesitation.plays} < ${boundary.plays} < 1.2`);
  // Wherever a word plays on the line, the face shows the item second it was said.
  for (const word of speech.heard) assert.ok(Math.abs(spokenItemTimeAt(speech, word.start) - Number(pacedSaid.find(([text]) => text === word.text)![1])) < 0.002, word.text);
  // One too long at top speed goes faster still rather than cut, so the face never jumps.
  assert.ok(long.plays === 1.6 && long.speed > 3 && speech.removals.length === 0, `${long.plays} s at ${long.speed}`);
  // The sound plays every stretch at its own pace, so it never changes pitch: each pause keeps as much of its quiet as
  // it now lasts, cut in the quiet's middle, and the line lasts as long as the face.
  const { pieces: sounded } = speech.sound!;
  assert.equal(sounded.length, 4);
  assert.ok(Math.abs(sounded.reduce((sum, p) => sum + p.duration, 0) - spokenStretchSeconds(speech)) < 0.005);
  const inQuiet = (t: number) => pacedItem.tracks.mic.levelled.quiet.some(([start, end]) => start < t && t < end);
  assert.ok(sounded.slice(1).every((p, k) => inQuiet(p.start) && inQuiet(sounded[k].start + sounded[k].duration)), 'every cut is in quiet');
  // A project's own pacing and classifier: every pause a boundary, at most 1.8 s.
  const own = paced.speech(0.4, 10.4, { pauses: { classify: () => 'boundary', longest: 1.8 } });
  assert.deepEqual(own.pauses.map((p) => p.kind), ['boundary', 'boundary', 'boundary']);
  assert.equal(own.pauses[2].plays, 1.8);
});

// "So" and "then" with sound between them the transcript has no word for: two quiet spans, not one.
const hiddenItem = {
  ...item, id: 'hidden', tracks: { mic: { ...item.tracks.mic, mediaSeconds: 4, startSeconds: 0, levelled: { file: 'proxies/mic-levelled.wav', lufs: -13, quiet: [[0, 0.5], [0.8, 1.4], [2.0, 2.8], [3.0, 4]] } } },
};
const hidden = libraryFootage(hiddenItem, { heardBy: 'test', tracks: { mic: { duration: 4, pauses: [], unheard: [], words: [{ text: 'So', start: 0.5, end: 0.8 }, { text: 'then', start: 2.8, end: 3.0 }] } } });

test('a gap in the words with sound in it plays as recorded: only quiet is ever sped', () => {
  const speech = hidden.speech(0.4, 3.1);
  assert.deepEqual(speech.pieces.map((p) => p.speed ?? 1), [1]);
  assert.deepEqual(speech.pauses, []);
});

const libraryFootageWords = (speech: RecordedSpeech) => speech.heard.map((w) => w.text);

test('a face keeps to the words it says across a cut, while the screen plays on', () => {
  const plan = defineStoryboard({ title: 'Recorded', target: { seconds: 5 }, scenes: { agents: { onScreen: 'The editor', motion: 'None', lines: { definition: { speech: verbatim.speech(0.9, 5.5) } } } } });
  const { timeline, voice } = resolveStoryboard(plan);
  const scene = { ...sceneTimes(videoLayoutOf(timeline!, voice).scenes[0]) };
  const start = scene.line('definition').start;
  // 1 s into the line, past the jump over "uh" at 0.9 s.
  assert.deepEqual([verbatim.timeAt({ ...scene, t: start + 1 }), verbatim.heardAt({ ...scene, t: start + 1 })].map((x) => Math.round(x * 100) / 100), [2.1, 2.68]);
});
