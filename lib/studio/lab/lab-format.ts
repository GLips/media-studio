// lab-format.ts: the frame and palette the lab's compositions play in. They're Remotion compositions like a video's
// scenes, so they take the showcase's colours as values (projects/2026-09-motion-showcase), as a scene does, rather
// than the app's theme tokens.
import type { VideoFormat } from '#models/frame/frame.ts';

/** The lab's one frame: every stage plays at it unless a tab needs another shape or rate. */
export const LAB_FORMAT: VideoFormat = { fps: 30, width: 1920, height: 1080, transparent: false };

/** The showcase palette: its ground, ink, cream, red-orange and cobalt. */
export const LAB_COLORS = {
  ground: '#0c0c0e',
  panel: '#16161a',
  line: '#2a2a31',
  cream: '#f3f0e7',
  dim: '#8d8a83',
  red: '#ee4c23',
  cobalt: '#4144f4',
  ink: '#140b0e',
  pass: '#3ccf7a',
} as const;
