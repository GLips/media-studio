// An add over real folders: a recorder take moved into a temp workspace's library, with ffmpeg and whisper faked at
// their services, since what's tested is what the add does with their answers.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect, Layer } from 'effect';
import { FootageTranscriber } from '#lib/footage/transcript/engine/footage-transcriber.ts';
import { makeLibraryMediaFolderLayer } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { runStudioEffect } from '#lib/platform/process/engine/studio-effect-runtime.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { addLibraryItem } from './add-library-item.ts';
import { listLibraryRecorderTakes, removeLibraryRecorderTake } from './library-recorder-takes.ts';
import { LibraryFileUnreadable } from '../models/library-errors.ts';
import { makeRecorderDeviceLatenciesLayer, RecorderDeviceLatencies } from './library-recorder-latencies.ts';
import { makeLibraryStoreLayer } from './library-store.ts';

/**
 * ffprobe as a 10 s screen recording and a mic; loudnorm hears the mic at -30 LUFS and ebur128 its levelled copy at
 * -16.2; an encode writes its output file.
 */
const fakeFfmpeg = StudioFfmpeg.of({
  probe: (args) => Effect.succeed(args.includes('-show_streams')
    ? JSON.stringify({ streams: args.at(-1)?.endsWith('.m4a') ? [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 1 }] : [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '30/1', avg_frame_rate: '30/1' }] })
    : '10.0\n'),
  report: (args) => Effect.succeed({
    stderr: args.some((arg) => arg.startsWith('ebur128'))
      ? '[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -16.2 LUFS\n    Threshold: -26.3 LUFS\n'
      : '{ "input_i": "-30.0", "input_tp": "-12.0", "input_lra": "4.0", "input_thresh": "-40.0", "target_offset": "0.0" }',
    exitCode: 0,
  }),
  run: (args) => Effect.sync(() => writeFileSync(args.at(-1) ?? '', 'encoded')),
});

const fakeTranscriber = FootageTranscriber.of({ transcribe: () => Effect.succeed({ duration: 10, words: [{ text: 'Hello', start: 1, end: 1.4 }], pauses: [] }) });

const libraryAt = (root: string, latencies = makeRecorderDeviceLatenciesLayer(join(root, 'no-recorder-config.json'))) => Layer.mergeAll(
  makeLibraryStoreLayer({ libraryDir: join(root, 'work/library'), projectsDir: join(root, 'work/projects'), workspaceRequired: false }),
  makeLibraryMediaFolderLayer(join(root, 'work')),
  latencies,
  Layer.succeed(StudioFfmpeg, fakeFfmpeg),
  Layer.succeed(FootageTranscriber, fakeTranscriber),
);

/** A take folder as the recorder leaves it, its files last changed `stillFor` ms ago. */
function writeTake(root: string, { status, stillFor, input, name = '2026-11-22 18.19.29' }: { status: 'recording' | 'complete'; stillFor: number; input: string; name?: string }) {
  const take = join(root, 'Studio Recordings', name);
  mkdirSync(take, { recursive: true });
  writeFileSync(join(take, 'recording.json'), JSON.stringify({
    format: 'studio-recording/1', status, startedAt: '2026-11-22T18:19:29.847-08:00',
    tracks: { screen: { file: 'screen.mp4', startSeconds: 0.34, device: 'Built-in Display' }, mic: { file: 'mic.m4a', startSeconds: 0.83 } },
    input: { file: 'input.jsonl', coordinates: 'global-points' },
  }));
  for (const file of ['screen.mp4', 'mic.m4a']) writeFileSync(join(take, file), file);
  writeFileSync(join(take, 'input.jsonl'), input);
  const changed = new Date(Date.now() - stillFor);
  for (const file of readdirSync(take)) utimesSync(join(take, file), changed, changed);
  return take;
}

const MOVE = { move: true, proxies: false } as const;
const CLICK = '{"t":1.2,"type":"mouseDown","x":10,"y":20,"button":"left"}\n';

test('a complete take is moved into the library, transcribed and its speech levelled, and a torn last input line is dropped', () => withStudioTemp('library-add', async (root) => {
  const take = writeTake(root, { status: 'complete', stillFor: 0, input: `${CLICK}{"t":1.5,"ty` });
  const item = await runStudioEffect(addLibraryItem({ paths: [take], ...MOVE }), libraryAt(root));
  assert.equal(item.id, '2026-11-22-181929');
  assert.deepEqual(item.source, { kind: 'studio-recorder', folder: take, status: 'complete' });
  assert.equal(existsSync(take), false);
  assert.deepEqual(readdirSync(join(root, 'work/library/media', item.id)).toSorted(), ['input.jsonl', 'mic.m4a', 'proxies', 'recording.json', 'screen.mp4']);
  assert.match(readFileSync(join(root, 'work/library/items', item.id, 'transcript.json'), 'utf8'), /"track": *"mic"/);
  assert.deepEqual(item.tracks.mic.levelled, { file: 'proxies/mic-levelled.wav', lufs: -16.2 });
}));

test('a take still being written is refused, and one whose input log is broken mid-way is refused before anything moves', () => withStudioTemp('library-add', async (root) => {
  const live = writeTake(root, { status: 'recording', stillFor: 1000, input: CLICK });
  await assert.rejects(runStudioEffect(addLibraryItem({ paths: [live], ...MOVE }), libraryAt(root)), { message: `${live} is still recording: add it once it stops` });
  const broken = writeTake(root, { status: 'recording', stillFor: 60_000, input: `{"t":1}\n${CLICK}` });
  await assert.rejects(runStudioEffect(addLibraryItem({ paths: [broken], ...MOVE }), libraryAt(root)), { _tag: 'RecordingLogLineUnreadable', line: 1 });
  assert.deepEqual(readdirSync(broken).toSorted(), ['input.jsonl', 'mic.m4a', 'recording.json', 'screen.mp4']);
}));

test("an add whose item.json can't be written moves the take's files back and leaves no media folder", () => withStudioTemp('library-add', async (root) => {
  const take = writeTake(root, { status: 'complete', stillFor: 0, input: CLICK });
  // An items folder no item can be written into: every file is brought, then writing the item fails.
  mkdirSync(join(root, 'work/library/items'), { recursive: true });
  chmodSync(join(root, 'work/library/items'), 0o555);
  await assert.rejects(runStudioEffect(addLibraryItem({ paths: [take], ...MOVE }), libraryAt(root)));
  assert.deepEqual(readdirSync(take).toSorted(), ['input.jsonl', 'mic.m4a', 'recording.json', 'screen.mp4']);
  assert.deepEqual(readdirSync(join(root, 'work/library/media')), []);
}));

test("an add whose undo fails too fails with what broke the add, and leaves the file it couldn't move back in the media folder", () => withStudioTemp('library-add', async (root) => {
  const take = writeTake(root, { status: 'complete', stillFor: 0, input: CLICK });
  // The screen track is brought, then its latency fails with the take folder shut, so it can't move back.
  const latencies = Layer.succeed(RecorderDeviceLatencies, RecorderDeviceLatencies.of({
    latencyOf: () => Effect.sync(() => chmodSync(take, 0o555)).pipe(Effect.andThen(Effect.fail(new LibraryFileUnreadable({ path: 'config.json', reason: 'is unreadable' })))),
  }));
  try {
    await assert.rejects(runStudioEffect(addLibraryItem({ paths: [take], ...MOVE }), libraryAt(root, latencies)), { message: 'config.json is unreadable' });
  } finally {
    chmodSync(take, 0o755);
  }
  assert.deepEqual(readdirSync(join(root, 'work/library/media', '2026-11-22-181929')), ['screen.mp4']);
}));

test("the recorder's takes are listed wherever they went, and a take thrown away leaves nothing in the library or the inbox", () => withStudioTemp('library-add', async (root) => {
  const added = writeTake(root, { status: 'complete', stillFor: 0, input: CLICK });
  const { id } = await runStudioEffect(addLibraryItem({ paths: [added], ...MOVE }), libraryAt(root));
  const failed = writeTake(root, { status: 'complete', stillFor: 0, input: CLICK, name: '2026-11-22 19.00.00' });
  writeTake(root, { status: 'recording', stillFor: 0, input: CLICK, name: '2026-11-22 19.30.00' });
  const inbox = join(root, 'Studio Recordings');

  const takes = await runStudioEffect(listLibraryRecorderTakes({ inbox }), libraryAt(root));
  // The live take is left out: the recorder is still writing it.
  assert.deepEqual(takes.map((take) => [take.folder, take.item]), [
    [failed, null],
    [added, { id, mediaFolder: join(root, 'work/library/media', id) }],
  ]);

  await runStudioEffect(removeLibraryRecorderTake(added), libraryAt(root));
  await runStudioEffect(removeLibraryRecorderTake(failed), libraryAt(root));
  assert.equal(existsSync(join(root, 'work/library/items', id)), false);
  assert.equal(existsSync(join(root, 'work/library/media', id)), false);
  assert.equal(existsSync(failed), false);
  await assert.rejects(runStudioEffect(removeLibraryRecorderTake(join(inbox, '2026-11-22 19.30.00')), libraryAt(root)), { message: /is still recording/ });
}));
