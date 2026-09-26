// captions.tsx: burned-in captions. Each voiced line is its own audio file, so its start and end are known exactly
// and a caption is simply its line's text for as long as it's spoken.

import { captionSafeArea, FONT } from '#models/frame/frame.ts';
import { motionCurves, seg } from '#models/motion/motion.ts';
import type { VoiceCue } from './timeline.ts';
import { useVideoFormat } from './video-format.ts';

const LEAD_IN = 0.05, HANG = 0.15;
export const captionCueAt = (cues: readonly VoiceCue[], t: number) => cues.find((q) => t >= q.start - LEAD_IN && t < q.captionEnd + HANG);

/** The caption at `t`. The framing check renders with captions on, so it measures this box. */
export function Caption({ cues, t }: { cues: readonly VoiceCue[]; t: number }) {
  const { bottom, maxWidth, scale } = captionSafeArea(useVideoFormat());
  const cue = captionCueAt(cues, t);
  if (!cue) return null;
  const k = Math.min(seg(t, cue.start - LEAD_IN, cue.start + HANG, motionCurves.cubic.entrance), 1 - seg(t, cue.captionEnd, cue.captionEnd + HANG, motionCurves.dissolve));
  return (
    <div
      data-framing="caption"
      data-strength={1}
      style={{
        position: 'absolute',
        left: '50%',
        bottom,
        transform: 'translateX(-50%)',
        maxWidth,
        width: 'max-content',
        padding: `${20 * scale}px ${34 * scale}px`,
        borderRadius: 18 * scale,
        background: 'rgba(14, 22, 36, 0.82)',
        color: '#fff',
        font: `600 ${40 * scale}px/${54 * scale}px ${FONT}`,
        textAlign: 'center',
        opacity: k,
      }}
    >
      {cue.text}
    </div>
  );
}
