// render-slices.ts: a slice of the video (`studio render --frames` or `--scene`), rendered alone to re-render just what
// a change touched, silent and unchecked, with its snapshot recording where in the video it starts. Review lays a
// slice a reply names into the cut over its frames (render-splice.ts). Node only.
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { renderSliceFramesOf, type RenderSliceSpan } from '../models/render-splice.ts';
import { renderProgress } from './render-pipeline.ts';
import { SLICE_ENCODING, type RenderSession } from './render-session.ts';

/** Refuses frames `from`–`end` (exclusive) unless they're whole and within `timeline`'s video. */
export function refuseSliceOutside(timeline: Pick<TimelineReport, 'durationInFrames'>, { from, end }: { from: number; end: number }): void {
  if (!(Number.isInteger(from) && Number.isInteger(end) && from >= 0 && end > from && end <= timeline.durationInFrames)) {
    throw new Error(`frames ${from}–${end - 1} aren't within the video's 0–${timeline.durationInFrames - 1}`);
  }
}

/**
 * `span` of the video, silent, at `out`, with its snapshot. No framing check and no mix. Captions on, as the delivered
 * video and the animatic have them, so it matches the cut it's laid into. Returns the file.
 */
export async function renderVideoSlice(session: RenderSession, { span, out }: { span: RenderSliceSpan; out: string }): Promise<string> {
  const timeline = await session.readTimeline(), frames = renderSliceFramesOf(timeline, span);
  refuseSliceOutside(timeline, frames);
  return session.renderVideo({
    out, frames, sound: 'none', encoding: SLICE_ENCODING, timeline, inputProps: session.props({ captions: true }), onProgress: renderProgress(out),
  });
}
