// picture-in-picture.tsx: two pictures, one inset over the other, the inset able to fill the frame or rest in a
// corner: a speaker full-frame (k 0) or a bubble over their screen (k 1), and any point between as they move. Which
// a scene shows, and when it moves, is the scene's choice: time `k` with its own cues and curves.
import type { ReactNode } from 'react';
import { useVideoConfig } from 'remotion';
import { DEFAULT_INSET_PLACEMENT, insetBoxAt, type InsetPlacement } from '../models/inset-layout.ts';

/** A line drawn around the inset at rest; it thins away as the inset fills the frame. */
export type InsetRing = { width: number; color: string };

type PictureInPictureProps = {
  /** The picture behind, filling the frame: a screen. Left out while the inset covers it (k 0). */
  main: ReactNode;
  /** The picture inset: a face. Each fills the box it's given, so draw it to fill its parent (cover). */
  inset: ReactNode;
  /** 0 the inset fills the frame, 1 it rests in its corner. */
  k: number;
  placement?: Partial<InsetPlacement>;
  ring?: InsetRing | null;
};

const WHITE_RING: InsetRing = { width: 8, color: '#fff' };

export function PictureInPicture({ main, inset, k, placement, ring = WHITE_RING }: PictureInPictureProps) {
  const frame = useVideoConfig();
  const box = insetBoxAt(frame, { ...DEFAULT_INSET_PLACEMENT, ...placement }, k);
  const fill = { position: 'absolute', inset: 0 } as const;
  return (
    <div style={{ ...fill, overflow: 'hidden' }}>
      {k > 0 && <div style={fill}>{main}</div>}
      <div
        style={{
          position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.radius, overflow: 'hidden',
          // The ring sits outside the box, so the picture inside keeps its full size.
          boxShadow: ring && k > 0 ? `0 0 0 ${ring.width * k}px ${ring.color}, 0 ${12 * k}px ${40 * k}px rgba(0, 0, 0, ${0.35 * k})` : undefined,
        }}
      >
        {inset}
      </div>
    </div>
  );
}
