// frame-profile.ts: how drawing code offers its work to `studio profile` to be timed. It reads no clock: the one
// profiler that does (frame-profiler.tsx) is mounted only in a profiling render, and every other render has none, so
// nothing a frame shows can depend on it.

import { createContext, useContext } from 'react';

/**
 * Starts timing a named piece of a frame's work, and returns what stops it. The work must be finished when it's
 * stopped: GPU work is waited for first (a readback), or the time is only what it took to queue.
 */
export type FrameProfileStart = (label: string) => () => void;

export const FrameProfileContext = createContext<FrameProfileStart | null>(null);

/** The profiler, in a profiling render; null in every other. */
export const useFrameProfile = () => useContext(FrameProfileContext);
