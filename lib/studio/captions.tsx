// captions.tsx: burned-in captions. Each voiced line is its own audio file, so its start and end are known exactly
// and a caption is simply its line's text for as long as it's spoken.

import { FONT } from './frame.ts';
import { ease, easeOut, seg } from './motion.ts';
import type { VoiceCue } from './timeline.ts';

const LEAD_IN = 0.05, HANG = 0.15;
export const captionCueAt = (cues: readonly VoiceCue[], t: number) => cues.find((q) => t >= q.start - LEAD_IN && t < q.end + HANG);

/** The caption at `t`. The framing check renders with captions on, so it measures this box. */
export function Caption({ cues, t }: { cues: readonly VoiceCue[]; t: number }) {
  const cue = captionCueAt(cues, t);
  if (!cue) return null;
  const k = Math.min(seg(t, cue.start - LEAD_IN, cue.start + HANG, easeOut), 1 - seg(t, cue.end, cue.end + HANG, ease));
  return (
    <div
      data-framing="caption"
      data-strength={1}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 70,
        transform: 'translateX(-50%)',
        maxWidth: 1320 + 68,
        width: 'max-content',
        padding: '20px 34px',
        borderRadius: 18,
        background: 'rgba(14, 22, 36, 0.82)',
        color: '#fff',
        font: `600 40px/54px ${FONT}`,
        textAlign: 'center',
        opacity: k,
      }}
    >
      {cue.text}
    </div>
  );
}
