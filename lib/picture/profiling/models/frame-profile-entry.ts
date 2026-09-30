// frame-profile-entry.ts: one timing a profiling render logs (lib/picture/profiling/studio/frame-profiler.tsx) and
// `studio profile` reads back from the page's console.

/** Marks a console line as a profile entry; the JSON of a FrameProfileEntry follows it. */
export const FRAME_PROFILE_LOG_PREFIX = '[frame-profile] ';

/** `ms` of `label`'s work in the video's `frame`. A frame can hold several entries of one label, one per painting. */
export type FrameProfileEntry = { frame: number; label: string; ms: number };
