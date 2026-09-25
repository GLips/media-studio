// ─── Where a project's timing is built ────────────────────────────────
//
// Each timing constructor, named by the module that defines it. Check (a) follows
// every import (through `#studio`, re-exports and namespaces) back to these
// origins, so a constructor can't reach a scene by being re-exported under
// another path. A bar timeline carries its cues, moves and landmarks, so
// `defineBarTimeline` is the one constructor for all of them.
//
// Negative space: `defineVideo` isn't listed; it binds scenes, the render half.
// Nor is `sceneForBar`: it takes a bar clock only defineBarTimeline makes, so it
// binds a picture to timing without stating any.

export const TIMING_CONSTRUCTORS: readonly { path: string; names: readonly string[] }[] = [
  { path: 'lib/studio/timeline.ts', names: ['defineScene'] },
  { path: 'lib/models/timeline/beat-grid.ts', names: ['beatGrid', 'steadyBeatGrid'] },
  { path: 'lib/models/timeline/bar-timeline.ts', names: ['defineBarTimeline'] },
  { path: 'lib/models/timeline/speech-cues.ts', names: ['defineSpeechCues'] },
];

export const isTimingConstructor = (origin: { path: string; name: string }) =>
  TIMING_CONSTRUCTORS.some((row) => row.path === origin.path && row.names.includes(origin.name));
