// ─── Where a project's timing is stated ───────────────────────────────
//
// Each timing constructor, named by the module that defines it. Check (a) follows
// every import (through `#studio`, re-exports and namespaces) back to these
// origins, so a constructor can't reach a scene by being re-exported under
// another path. A project states its timing as data in storyboard.ts, through
// `defineStoryboard`, the one constructor it may call there; the timeline's own
// constructors, the resolver and the bare beat grid a scene could otherwise
// count its own beats on are lib's alone.
//
// Negative space: `defineVideo`, `bindTimeline` and `sceneForTimelineClock`
// aren't listed: they resolve the plan or take the clocks it makes, binding
// pictures to timing without stating any.

/** The storyboard's constructor, which a project's storyboard.ts alone calls. */
export const STORYBOARD_CONSTRUCTOR = { path: 'lib/timing/storyboard/models/storyboard.ts', name: 'defineStoryboard' } as const;

export const TIMING_CONSTRUCTORS: readonly { path: string; names: readonly string[] }[] = [
  { path: STORYBOARD_CONSTRUCTOR.path, names: [STORYBOARD_CONSTRUCTOR.name] },
  { path: 'lib/timing/storyboard/models/resolve-storyboard.ts', names: ['resolveStoryboard'] },
  { path: 'lib/timing/timeline/models/beat-grid.ts', names: ['beatGrid', 'steadyBeatGrid'] },
  { path: 'lib/timing/timeline/models/timeline.ts', names: ['defineTimeline', 'beatSpan', 'fixedSpan', 'voiceSpan', 'recordedGrid', 'tempoGrid'] },
];

export const isTimingConstructor = (origin: { path: string; name: string }) =>
  TIMING_CONSTRUCTORS.some((row) => row.path === origin.path && row.names.includes(origin.name));

export const isStoryboardConstructor = (origin: { path: string; name: string }) =>
  origin.path === STORYBOARD_CONSTRUCTOR.path && origin.name === STORYBOARD_CONSTRUCTOR.name;
