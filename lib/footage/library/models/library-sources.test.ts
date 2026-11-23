import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Result } from 'effect';
import type { StudioRecordingJson } from '#lib/footage/recording/models/studio-recording-json.ts';
import { recorderAddSource } from './library-sources.ts';

test("a killed take is added as interrupted, and a track the recorder listed but never wrote is left out", () => {
  const recording: StudioRecordingJson = {
    format: 'studio-recording/1', status: 'recording', startedAt: '2026-11-22T18:19:29.847-08:00',
    tracks: {
      camera: { file: 'camera.mp4', device: 'Cam Link 4K', latencySeconds: 0.16 },
      mic: { file: 'mic.m4a', startSeconds: 0.83, hostDriftSeconds: 0.00014, latencySeconds: 0 },
      screen: { file: 'screen.mp4', startSeconds: 0.34 },
    },
    input: { file: 'input.jsonl', coordinates: 'global-points' },
  };
  const source = Result.getOrThrow(recorderAddSource('/r/2026-11-22 18.19.29', '2026-11-22 18.19.29', recording, new Set(['mic.m4a', 'screen.mp4', 'input.jsonl', 'recording.json']), 'interrupted'));
  assert.deepEqual(source.source, { kind: 'studio-recorder', folder: '/r/2026-11-22 18.19.29', status: 'interrupted' });
  assert.deepEqual(source.tracks.map((t) => [t.name, t.startSeconds, t.latencySeconds]), [['mic', 0.83, undefined], ['screen', 0.34, undefined]]);
  assert.deepEqual(source.leftOut, { camera: 'camera.mp4 was never written' });
  assert.equal(source.input?.path, '/r/2026-11-22 18.19.29/input.jsonl');
});

test("a window track whose window log is gone is added with the loss said, its other problem kept", () => {
  const recording: StudioRecordingJson = {
    format: 'studio-recording/1', status: 'complete', startedAt: '2026-11-22T18:19:29.847-08:00',
    tracks: { screen: { file: 'screen.mp4', startSeconds: 0.34, window: { title: 'Notes', app: 'Notes', file: 'window.jsonl' } } },
    problems: { screen: 'the window closed at 3.0 s' },
  };
  const source = Result.getOrThrow(recorderAddSource('/r/t', 't', recording, new Set(['screen.mp4', 'recording.json']), 'complete'));
  assert.equal(source.tracks[0].window, undefined);
  assert.equal(source.problems?.screen, "the window closed at 3.0 s; window.jsonl holds no placements: input can't be placed on the window");
});
