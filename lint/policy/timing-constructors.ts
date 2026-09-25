// ─── Where a project's timing is built ────────────────────────────────
//
// Each timing constructor, named by the module that defines it. Check (a) follows
// every import (through `#studio`, re-exports and namespaces) back to these
// origins, so a constructor can't reach a scene by being re-exported under
// another path. vid-41 adds the bar clock, cues, speech cues and landmarks here.
//
// Negative space: `defineVideo` isn't listed. Its timing half doesn't exist apart
// from its render bindings yet, and the render half stays in video.tsx; vid-41
// splits it and lists the timing half.

export const TIMING_CONSTRUCTORS: readonly { path: string; names: readonly string[] }[] = [
  { path: 'lib/studio/timeline.ts', names: ['defineScene'] },
  { path: 'lib/studio/beats.ts', names: ['beatGrid', 'steadyBeatGrid'] },
];

export const isTimingConstructor = (origin: { path: string; name: string }) =>
  TIMING_CONSTRUCTORS.some((row) => row.path === origin.path && row.names.includes(origin.name));
