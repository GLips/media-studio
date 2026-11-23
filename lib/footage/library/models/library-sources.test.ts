import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recorderAddSource, type RecorderRecordingJson } from './library-sources.ts';

test("a killed take is interrupted, and a track the recorder listed but never wrote is left out", () => {
  const recording: RecorderRecordingJson = {
    format: 'studio-recording/1', status: 'recording', startedAt: '2026-11-22T18:19:29.847-08:00',
    tracks: {
      camera: { file: 'camera.mp4', device: 'Cam Link 4K', latencySeconds: 0.16 },
      mic: { file: 'mic.m4a', startSeconds: 0.83, hostDriftSeconds: 0.00014, latencySeconds: 0 },
      screen: { file: 'screen.mp4', startSeconds: 0.34 },
    },
    input: { file: 'input.jsonl', coordinates: 'global-points' },
  };
  const source = recorderAddSource('/r/2026-11-22 18.19.29', '2026-11-22 18.19.29', recording, new Set(['mic.m4a', 'screen.mp4', 'input.jsonl', 'recording.json']));
  assert.deepEqual(source.source, { kind: 'studio-recorder', folder: '/r/2026-11-22 18.19.29', status: 'interrupted' });
  assert.deepEqual(source.tracks.map((t) => [t.name, t.startSeconds, t.latencySeconds]), [['mic', 0.83, undefined], ['screen', 0.34, undefined]]);
  assert.deepEqual(source.leftOut, { camera: 'camera.mp4 was never written' });
  assert.equal(source.input?.path, '/r/2026-11-22 18.19.29/input.jsonl');
});
