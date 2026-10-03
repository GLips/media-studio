// frame-profile-entry.ts: what a profiling render logs (lib/picture/profiling/studio/frame-profiler.tsx) and
// `studio profile` reads back from the page's console: timings, and costs counted as the drawing ran.

/** Marks a console line as a profile entry; the JSON of a FrameProfileEntry or a FrameCostsEntry follows it. */
export const FRAME_PROFILE_LOG_PREFIX = '[frame-profile] ';

/** `ms` of `label`'s work in the video's `frame`. A frame can hold several entries of one label, one per painting. */
export type FrameProfileEntry = { frame: number; label: string; ms: number };

/** One count of a frame's costs, by `name`; one in `bytes` prints as MB. */
export type FrameCost = { readonly name: string; readonly value: number; readonly unit?: 'bytes' };

/**
 * What `label`'s work cost in the video's `frame`, counted rather than timed: `counts` add up over frames (solves,
 * cache misses, bytes uploaded); `levels` are a state as the frame ends (bytes kept), of which a span reports the
 * most; `notes` say what a count can't (where a solve started).
 */
export type FrameCostsEntry = {
  readonly frame: number;
  readonly label: string;
  readonly counts: readonly FrameCost[];
  readonly levels: readonly FrameCost[];
  readonly notes: readonly string[];
};

/** A line `studio profile` reads: a timing, or costs. */
export type FrameProfileLine = FrameProfileEntry | FrameCostsEntry;

export const isFrameCostsEntry = (line: FrameProfileLine): line is FrameCostsEntry => 'counts' in line;
