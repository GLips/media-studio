import { test } from 'node:test';
import { assertTimelineRetimes } from '#models/timeline/retime.ts';

// The timeline reads the fitted track from music/index.ts, which imports the audio: the hooks load that as a URL.
await import('#engine/bundle/tsx-test-hooks.ts');
const { timeline } = await import('./timeline.ts');
const { placeShowcaseBars } = await import('./video.tsx');

test('the reel retimes: a bar a beat longer moves every later bar, cue, replay, sound and kick, and the recording refuses it unfitted', () => {
  assertTimelineRetimes(timeline, {
    // The bars bound to each re-fitted timeline, as video.tsx binds them: what each places on the video's frames.
    placements: (retimed) => placeShowcaseBars(retimed as typeof timeline).flatMap(({ bar, scene: { origin } }) => [
      ...(bar.sounds ?? []).map((sound) => ({ scene: bar.id, id: `sound ${sound.id}`, frame: origin + sound.at })),
      ...(bar.kicks ?? []).map((frame, i) => ({ scene: bar.id, id: `kick ${i}`, frame: origin + frame })),
      ...(bar.glitches ?? []).map((frame, i) => ({ scene: bar.id, id: `glitch ${i}`, frame: origin + frame })),
    ]),
  });
});
