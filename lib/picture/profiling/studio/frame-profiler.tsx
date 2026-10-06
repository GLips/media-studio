// frame-profiler.tsx: times the work drawing code offers (frame-profile.ts) and logs each time, and each cost it's
// told, to the render's Node side (platform/browser's render-page-log), where `studio profile`
// (lib/output/render/engine/frame-profiling.ts) reads it. It's the one module that draws and reads a clock, which
// lint/structural/checks/frame-determinism.ts allows by name: the times go to the console, never into a frame, and
// it's mounted only when a render asks to be profiled.

import { useCallback, useRef, type ReactNode } from 'react';
import { useCurrentFrame } from 'remotion';
import { FrameCostsContext, FrameProfileContext, type FrameCostsReport, type FrameProfileStart } from './frame-profile.ts';
import { FRAME_PROFILE_LOG_PREFIX, type FrameProfileLine } from '../models/frame-profile-entry.ts';
import { logToRenderHost } from '#lib/platform/browser/studio/render-page-log.ts';

const logFrameProfileLine = (line: FrameProfileLine) => logToRenderHost(FRAME_PROFILE_LOG_PREFIX, JSON.stringify(line));

export function FrameProfiler({ children }: { children: ReactNode }) {
  // Read when the work stops, through a ref: a `start` made anew each frame would remount what depends on it.
  const frame = useRef(0);
  frame.current = useCurrentFrame();
  const start = useCallback<FrameProfileStart>((label) => {
    const started = performance.now();
    return () => logFrameProfileLine({ frame: frame.current, label, ms: performance.now() - started });
  }, []);
  const costs = useCallback<FrameCostsReport>((label, { counts, levels, notes }) => logFrameProfileLine({ frame: frame.current, label, counts, levels, notes }), []);
  return (
    <FrameProfileContext value={start}>
      <FrameCostsContext value={costs}>{children}</FrameCostsContext>
    </FrameProfileContext>
  );
}
