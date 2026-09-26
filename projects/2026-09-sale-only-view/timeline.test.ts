import { test } from 'node:test';
import { assertTimelineRetimes } from '#models/timeline/retime.ts';

// The timeline reads the voice from audio/manifest.ts, which imports the WAVs: the hooks load those as URLs.
await import('#engine/bundle/tsx-test-hooks.ts');
const { timeline } = await import('./timeline.ts');

test('the walkthrough retimes: a line re-read slower moves its words\' cues and every later scene, and nothing before', () => {
  assertTimelineRetimes(timeline);
});
