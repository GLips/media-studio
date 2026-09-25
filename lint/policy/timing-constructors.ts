// ─── Where a project's timing is built ────────────────────────────────
//
// Each timing constructor, named by the module that defines it. Check (a) follows
// every import (through `#studio`, re-exports and namespaces) back to these
// origins, so a constructor can't reach a scene by being re-exported under
// another path. A timeline declares its cues, landmarks and replays inside
// `defineTimeline`, so it and its drivers and grids are the whole list; the
// legacy `defineScene` and beat grid stay until no project times with them.
//
// Negative space: `defineVideo` isn't listed; it binds scenes, the render half.
// Nor are `bindTimeline` and `sceneForTimelineClock`: they take clocks only
// defineTimeline makes, so they bind pictures to timing without stating any.

export const TIMING_CONSTRUCTORS: readonly { path: string; names: readonly string[] }[] = [
  { path: 'lib/studio/timeline.ts', names: ['defineScene'] },
  { path: 'lib/models/timeline/beat-grid.ts', names: ['beatGrid', 'steadyBeatGrid'] },
  { path: 'lib/models/timeline/timeline.ts', names: ['defineTimeline', 'beatSpan', 'fixedSpan', 'voiceSpan', 'recordedGrid', 'tempoGrid'] },
];

export const isTimingConstructor = (origin: { path: string; name: string }) =>
  TIMING_CONSTRUCTORS.some((row) => row.path === origin.path && row.names.includes(origin.name));
