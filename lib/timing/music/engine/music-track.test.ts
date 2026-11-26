import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { generateProjectMusicTrack } from './music-track.ts';

// Lyria bills per clip, so a name the manifest would refuse must stop the run before generatePaidMedia is reached.
test('music gen refuses a bad --name before paying', async () => {
  await assert.rejects(generateProjectMusicTrack(studioTempRoot(), { prompt: 'a sitcom theme', name: 'themeSax', full: false }), /--name must be lowercase words joined by dashes, not themeSax/);
});
