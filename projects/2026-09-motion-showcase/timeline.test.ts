import { test } from 'node:test';
import { assertTimelineRetimes } from '../../lib/models/timeline/retime.ts';

// The timeline reads the fitted track from music/index.ts, which imports the audio: the hooks load that as a URL.
await import('../../lib/studio/tsx-test-hooks.ts');
const { timeline } = await import('./timeline.ts');
const { bindShowcaseBars } = await import('./video.tsx');

test('the reel retimes: a bar a beat longer moves every later bar, cue, replay, sound and kick, and the recording refuses it unfitted', () => {
  assertTimelineRetimes(timeline, {
    // The bars bound to each re-fitted timeline, as video.tsx binds them: what each places on the video's frames.
    placements: (retimed) => bindShowcaseBars(retimed as typeof timeline).flatMap((bar) => [
      ...(bar.sounds ?? []).map((sound) => ({ scene: bar.id, id: `sound ${sound.id}`, frame: sound.at })),
      ...(bar.kicks ?? []).map((frame, i) => ({ scene: bar.id, id: `kick ${i}`, frame })),
      ...(bar.glitches ?? []).map((frame, i) => ({ scene: bar.id, id: `glitch ${i}`, frame })),
    ]),
  });
});
