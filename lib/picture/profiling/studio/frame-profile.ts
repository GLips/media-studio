// frame-profile.ts: how drawing code offers its work to `studio profile` to be timed, and reports what it cost. It
// reads no clock: the one profiler that does (frame-profiler.tsx) is mounted only in a profiling render, and every
// other render has none, so nothing a frame shows can depend on it.

import { createContext, useContext } from 'react';
import type { FrameCostsEntry } from '../models/frame-profile-entry.ts';

/**
 * Starts timing a named piece of a frame's work, and returns what stops it. The work must be finished when it's
 * stopped: GPU work is waited for first (a readback), or the time is only what it took to queue.
 */
export type FrameProfileStart = (label: string) => () => void;

export const FrameProfileContext = createContext<FrameProfileStart | null>(null);

/** The profiler, in a profiling render; null in every other. */
export const useFrameProfile = () => useContext(FrameProfileContext);

/** Reports what `label`'s work cost in the frame being drawn, counted (a FrameCostsEntry, its frame the profiler's). */
export type FrameCostsReport = (label: string, costs: Pick<FrameCostsEntry, 'counts' | 'levels' | 'notes'>) => void;

export const FrameCostsContext = createContext<FrameCostsReport | null>(null);

/** The profiler's cost report, in a profiling render; null in every other. */
export const useFrameCosts = () => useContext(FrameCostsContext);
