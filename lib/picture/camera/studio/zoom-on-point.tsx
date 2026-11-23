// zoom-on-point.tsx: a picture (a screen recording) zoomed in on a point of it and aimed there, filling its box: give
// it followPointAt's aim on a cursor and it follows the cursor. The picture is laid out at its own pixel size and
// scaled, so whatever draws it fills that size.
import type { ReactNode } from 'react';
import { useVideoConfig } from 'remotion';
import type { Point } from '#lib/picture/frame/models/geometry.ts';
import { pointZoomOf } from '../models/point-zoom.ts';

type ZoomOnPointProps = {
  /** The picture's size in its own pixels: a screen track's video width and height. */
  picture: { w: number; h: number };
  /** Where to aim, in the picture's pixels. */
  focus: Point;
  /** 1 covers the box; 2 shows half as much of the picture, each way. */
  zoom: number;
  /** The box it fills, in frame pixels; the whole frame by default. */
  box?: { w: number; h: number };
  children: ReactNode;
};

export function ZoomOnPoint({ picture, focus, zoom, box, children }: ZoomOnPointProps) {
  const { width, height } = useVideoConfig();
  const { scale, x, y } = pointZoomOf(picture, box ?? { w: width, h: height }, focus, zoom);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: picture.w, height: picture.h, transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
