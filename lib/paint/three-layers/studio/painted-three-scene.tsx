// painted-three-scene.tsx: a painting with three.js scenes laid into it, in a scene (painted-three-gpu.ts). Each three
// layer lies in the painting's group order as an outside layer, seen through the same multiplane camera as its planes;
// painted textures put paintings on its objects. Like StampPainting, it holds the frame through the load and each draw.

import { useMemo } from 'react';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { PAINT_CAMERA_REST, paintCameraFocusAt, paintCameraPoseAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { useStampStyleContent } from '#lib/paint/style/studio/stamp-painting.tsx';
import type { PaintedThreeLayer, PaintedThreeStyle, PaintedThreeTexture } from './painted-three-gpu.ts';
import { usePaintedThreeScene } from './use-painted-three-scene.ts';

/** What three draws in a painted scene: its vertical field of view at rest (degrees), its layers, its painted textures. */
export type PaintedThreeContent = { fov: number; layers: readonly PaintedThreeLayer[]; paintedTextures?: readonly PaintedThreeTexture[] };

const NO_PAINTED_TEXTURES: readonly PaintedThreeTexture[] = [];

/**
 * Draws `painting` in `style` over the frame at `t`, its groups in `frame`'s state (the camera's view in it), with
 * `three`'s layers laid in its order. `camera` poses three's camera (at rest without one); its stage, margin and
 * all, is the renderer's (with no camera, the frame alone). Memoise `three`: a new array loads the scene anew.
 */
export function PaintedThreeScene({ painting, style, t, frame, camera, three }: {
  painting: CompiledStampPaint;
  style: PaintedThreeStyle;
  t: number;
  frame?: StampPaintFrameState;
  camera?: PaintCamera;
  three: PaintedThreeContent;
}) {
  const paper = useStampStyleContent(style.paper), mixing = useStampStyleContent(style.mixing);
  const { width, height } = useVideoFormat();
  const kept = useMemo(() => ({ paper, mixing }), [paper, mixing]);
  // The camera's stage is the renderer's: its margin is the one the camera's checks held a backdrop to.
  const stage = camera?.stage ?? stampStage({ width, height });
  if (stage.frame.width !== width || stage.frame.height !== height) {
    throw new Error(`painted three: the camera's frame is ${stage.frame.width} × ${stage.frame.height}, and the video's ${width} × ${height}`);
  }
  const pose = camera ? paintCameraPoseAt(camera, t) : PAINT_CAMERA_REST, lens = camera ? paintCameraFocusAt(camera, t) : null;
  const holder = usePaintedThreeScene(
    { painting, style: kept, stage, fov: three.fov, threeLayers: three.layers, paintedTextures: three.paintedTextures ?? NO_PAINTED_TEXTURES },
    { t, frame, pose, lens },
  );
  return <div ref={holder} {...unmeasuredAttrs('painted three scene')} style={{ position: 'absolute', inset: 0 }} />;
}
