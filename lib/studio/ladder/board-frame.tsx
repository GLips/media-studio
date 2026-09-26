// board-frame.tsx: the `board` rung (#models/timeline/scene-rung.ts): one image held, a sketch or a style frame, with
// at most one push in or slide across it, and a caption. The one move is the rung's limit: a scene that needs more
// than one is blocking, and is built.

import { AbsoluteFill, Img } from 'remotion';
import { CAPTION_SAFE_TOP, H, W } from '#models/frame/frame.ts';
import { motionCurves, seg } from '#models/motion/motion.ts';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { unmeasuredAttrs } from '../probe/motion-tag.ts';
import { useScene } from '../composition/scene.tsx';

/** The board's one move: a push to `push`× its size, or a slide of `slide` px across the frame. */
export type BoardMove = { push: number } | { slide: { x: number; y: number } };

/**
 * `src` fills the frame, cropped to cover it. The move runs over `during` (scene seconds), by default the whole scene.
 */
export function BoardFrame({ src, caption, move, during }: { src: string; caption?: string; move?: BoardMove; during?: { start: number; end: number } }) {
  const s = useScene();
  const { start, end } = during ?? { start: 0, end: s.dur };
  const k = seg(s.t, start, end, motionCurves.expressive.standard);
  // A slide is drawn over-scaled by just enough that its edges never come into frame at either end.
  const transform = !move ? undefined
    : 'push' in move ? `scale(${1 + (move.push - 1) * k})`
    : `translate(${move.slide.x * (k - 0.5)}px, ${move.slide.y * (k - 0.5)}px) scale(${1 + Math.max(Math.abs(move.slide.x) / W, Math.abs(move.slide.y) / H)})`;
  return (
    <AbsoluteFill {...unmeasuredAttrs('board frame')} style={{ background: '#111' }}>
      <Img src={src} style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover', transform }} />
      {caption && (
        <div style={{
          position: 'absolute', left: 120, bottom: H - CAPTION_SAFE_TOP + 40, maxWidth: 1200, padding: '14px 24px', borderRadius: 8,
          background: 'rgba(17, 19, 23, 0.82)', color: '#eef0f3', font: `600 38px/1.3 ${DISPLAY_FONT}`,
        }}>{caption}</div>
      )}
    </AbsoluteFill>
  );
}
