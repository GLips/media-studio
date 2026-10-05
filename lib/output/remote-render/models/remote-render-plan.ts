// remote-render-plan.ts: how a remote render shares a video's frames over containers, and each container's share over
// its browsers. Pure.
//
// A container spends about a minute before its first frame (its files, bundle, timeline and first solve), so it takes
// a long share: one per up to REMOTE_MOST_FRAMES_PER_CONTAINER frames. Inside one, each kept browser draws a piece at
// once: a browser's GPU process is CPU-bound, so more browsers use more of the GPU where more tabs wouldn't.
//
// The Mac picks how many containers from the frames it knows (the clock's length for a whole video); each container
// cuts its share from the frames its own page reads, so a wrong guess costs balance, never a frame.

/** Frames `from`–`end`, `end` exclusive. */
export type RemoteFrames = { readonly from: number; readonly end: number };

/** The most frames one container draws before the render takes another: a share is 300–600 frames, past 600. */
export const REMOTE_MOST_FRAMES_PER_CONTAINER = 600;

/** A piece shorter than this isn't worth a browser of its own: each piece's first frame warms a page from cold. */
export const REMOTE_LEAST_FRAMES_PER_PIECE = 30;

/** `frames` cut into `count` runs as even as frames allow, the longer ones first. */
function evenRuns({ from, end }: RemoteFrames, count: number): RemoteFrames[] {
  const length = end - from, base = Math.floor(length / count), longer = length % count;
  return Array.from({ length: count }, (_, i) => {
    const start = from + i * base + Math.min(i, longer);
    return { from: start, end: start + base + (i < longer ? 1 : 0) };
  });
}

/** Containers a render of `frames` frames takes: one per REMOTE_MOST_FRAMES_PER_CONTAINER, at most `maxContainers`. */
export const remoteContainerCount = (frames: number, maxContainers: number) =>
  Math.max(1, Math.min(maxContainers, Math.ceil(frames / REMOTE_MOST_FRAMES_PER_CONTAINER)));

/**
 * Container `index`'s pieces of `frames` shared over `containers`: its share cut into a piece per browser (`browsers` it
 * keeps), down to one for a short share, in frame order. None when the share is empty (more containers than frames).
 */
export function remoteContainerPieces(frames: RemoteFrames, { containers, index, browsers }: { containers: number; index: number; browsers: number }): RemoteFrames[] {
  if (!(Number.isInteger(frames.from) && Number.isInteger(frames.end) && frames.from >= 0 && frames.end > frames.from)) {
    throw new Error(`a remote render needs frames to draw, not ${frames.from}–${frames.end - 1}`);
  }
  const share = evenRuns(frames, containers)[index];
  if (!share || share.end === share.from) return [];
  return evenRuns(share, Math.max(1, Math.min(browsers, Math.floor((share.end - share.from) / REMOTE_LEAST_FRAMES_PER_PIECE))));
}
