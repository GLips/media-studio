import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect, Layer } from 'effect';
import { FootageTranscriber, whisperFootageTranscriberLayer } from './footage-transcriber.ts';
import { transcriptCacheLayerIn } from './transcript-cache.ts';
import { WhisperCpp, WhisperFailed } from './whisper-cpp.ts';
import type { WhisperToken } from '../models/whisper-heard-words.ts';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { runStudioEffect } from '#lib/platform/process/engine/studio-effect-runtime.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { wavFromSamples } from '#lib/platform/wav/models/wav.ts';

// ffmpeg and whisper stand in at the process boundary: "ffmpeg" writes two words' worth of tone with quiet around and
// between them, and "whisper" hears one word in each piece it's given. The cache is real, in a fresh folder per test.
const RATE = 16000;
const run = (seconds: number, loud: boolean) => Array.from({ length: Math.round(seconds * RATE) }, (_, i) => (loud ? Math.round(8000 * Math.sin(i / 3)) : 0));
const twoWords = Int16Array.from([...run(0.5, false), ...run(1, true), ...run(1, false), ...run(1, true), ...run(0.5, false)]);
const fakeFfmpegLayer = Layer.succeed(StudioFfmpeg, StudioFfmpeg.of({
  run: (args) => Effect.sync(() => writeFileSync(args.at(-1) ?? '', wavFromSamples(twoWords, RATE))),
  probe: () => Effect.die('the transcriber never probes'),
  report: () => Effect.die('the transcriber never asks for a report'),
}));

const whisper = { runs: 0, fails: false };
const HEARD: readonly WhisperToken[] = [{ text: '[_BEG_]', t_dtw: 0 }, { text: ' Hello', t_dtw: 40 }, { text: '.', t_dtw: 90 }];
const fakeWhisperLayer = Layer.succeed(WhisperCpp, WhisperCpp.of({
  transcriber: 'fake-whisper',
  install: Effect.void,
  hear: (wavs) => {
    whisper.runs++;
    return whisper.fails ? Effect.fail(new WhisperFailed({ reason: 'whisper-cli exited with 3' })) : Effect.succeed(wavs.map(() => HEARD));
  },
}));

let folders = 0;
function setUp() {
  const dir = join(studioTempRoot(), `footage-transcriber-${++folders}`), cache = join(dir, 'cache'), footage = join(dir, 'take.mov');
  mkdirSync(dir, { recursive: true });
  writeFileSync(footage, 'footage bytes');
  Object.assign(whisper, { runs: 0, fails: false });
  const layer = whisperFootageTranscriberLayer.pipe(Layer.provide([fakeWhisperLayer, transcriptCacheLayerIn(cache), fakeFfmpegLayer]));
  const transcribe = () => runStudioEffect(FootageTranscriber.use((transcriber) => transcriber.transcribe(footage)), layer);
  return { cache, footage, transcribe };
}

test('a file heard once is answered from the cache without whisper, and one whose entry is corrupt is heard again', async () => {
  const { cache, transcribe } = setUp();
  const heard = await transcribe();
  assert.deepEqual(heard.words.map((word) => word.text), ['Hello.', 'Hello.']);
  assert.equal(heard.duration, 4);
  assert.deepEqual(await transcribe(), heard);
  assert.equal(whisper.runs, 1);

  const [entry] = readdirSync(cache);
  writeFileSync(join(cache, entry), '{"duration": 4, "words": [');
  assert.deepEqual(await transcribe(), heard);
  assert.equal(whisper.runs, 2);
  assert.deepEqual(JSON.parse(readFileSync(join(cache, entry), 'utf8')), heard);
});

test('a failed step names itself, and caches nothing', async () => {
  const { cache, footage, transcribe } = setUp();
  whisper.fails = true;
  await assert.rejects(transcribe(), { message: `couldn't transcribe ${footage}: hearing it with whisper: whisper-cli exited with 3` });
  whisper.fails = false;
  await transcribe();
  assert.equal(whisper.runs, 2);
  assert.equal(readdirSync(cache).length, 1);
});
