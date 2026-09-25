import { test } from 'node:test';
import { assertBarTimelineRetimes } from '../../lib/models/timeline/retime.ts';

// The timeline reads the fitted track from music/index.ts, which imports the audio: the hooks load that as a URL.
await import('../../lib/studio/tsx-test-hooks.ts');
const { timeline } = await import('./timeline.ts');

test('the reel retimes: a bar a beat longer moves every later bar and cue, and the recording refuses it unfitted', () => {
  assertBarTimelineRetimes(timeline);
});
