// frame-profiler.tsx: times the work drawing code offers (frame-profile.ts) and logs each time to the console, where
// `studio profile` (lib/output/render/engine/frame-profiling.ts) reads it. It's the one module that draws and reads a
// clock, which lint/structural/checks/frame-determinism.ts allows by name: the times go to the console, never into a
// frame, and it's mounted only when a render asks to be profiled.

import { useCallback, useRef, type ReactNode } from 'react';
import { useCurrentFrame } from 'remotion';
import { FrameProfileContext, type FrameProfileStart } from './frame-profile.ts';
import { FRAME_PROFILE_LOG_PREFIX, type FrameProfileEntry } from '../models/frame-profile-entry.ts';

export function FrameProfiler({ children }: { children: ReactNode }) {
  // Read when the work stops, through a ref: a `start` made anew each frame would remount what depends on it.
  const frame = useRef(0);
  frame.current = useCurrentFrame();
  const start = useCallback<FrameProfileStart>((label) => {
    const started = performance.now();
    return () => {
      const entry: FrameProfileEntry = { frame: frame.current, label, ms: performance.now() - started };
      // Logged with no script on the stack: Remotion prints a line from the bundle whatever the render's log level,
      // and one from nowhere only at verbose, so `studio profile` reads the entries without them flooding the terminal.
      queueMicrotask(console.log.bind(console, FRAME_PROFILE_LOG_PREFIX + JSON.stringify(entry)));
    };
  }, []);
  return <FrameProfileContext value={start}>{children}</FrameProfileContext>;
}
