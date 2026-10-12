// review-cut-queue.ts: every ffmpeg the review server starts for a screen (storyboard stills, sheet cells, waveform
// peaks) waits its turn here, two at a time, so a board of forty tiles scrolled into view doesn't fork forty decoders
// on a machine other agents are rendering on. One queue for the process: the server is the only one cutting.

/** How many cuts run at once. */
const REVIEW_CUTS_AT_ONCE = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Runs `job` once fewer than two others run, first come first served; resolves or rejects as it does. */
export async function runInReviewCutQueue<T>(job: () => Promise<T>): Promise<T> {
  if (running >= REVIEW_CUTS_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await job();
  } finally {
    // The finished job's slot passes straight to the next in line, so `running` counts it throughout.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
