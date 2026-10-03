// paint-rig-pieces-draw.ts: a posed rig's pieces drawn offscreen into one picture and read back, for a tool that needs
// the pixels (a look of a pose, a measure of a silhouette): the same meshes and the same GPU path a scene draws with.

import { HalfFloatType, OrthographicCamera, RenderTarget, Scene, type WebGPURenderer } from 'three/webgpu';
import { gpuHalfValue } from '#lib/platform/gpu/models/gpu-half-float.ts';
import type { PaintRigPicture, PaintRigPiece } from '../models/paint-rig-pieces.ts';
import { createPaintRigPieceMeshes } from './paint-rig-piece-meshes.ts';

export type PaintRigPiecesDrawer = {
  /** `pieces` drawn in order over the texels of `box` (plane px), premultiplied linear, clear where none lie. */
  readonly draw: (pieces: readonly PaintRigPiece[], box: { x0: number; y0: number; w: number; h: number }) => Promise<PaintRigPicture>;
  readonly dispose: () => void;
};

/** A drawer on `renderer`, its meshes kept from draw to draw (a picture shown again isn't uploaded again). */
export function createPaintRigPiecesDrawer(renderer: WebGPURenderer): PaintRigPiecesDrawer {
  const meshes = createPaintRigPieceMeshes(), scene = new Scene();
  scene.add(meshes.object);
  let target: RenderTarget | null = null;
  return {
    draw: async (pieces, { x0, y0, w, h }) => {
      if (target?.width !== w || target.height !== h) {
        target?.dispose();
        target = new RenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
      }
      meshes.show(pieces);
      // Top y0, bottom y0 + h: plane px run down the picture as its rows do.
      const camera = new OrthographicCamera(x0, x0 + w, y0, y0 + h, -1, 1);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
      // A half-float target reads back as half bits, row by row from the top, each row padded to 256 bytes.
      if (!(read instanceof Uint16Array)) throw new Error('paint rig: a half-float target read back as something other than half floats');
      const stride = Math.ceil((w * 8) / 256) * 128, rgba = new Float32Array(w * h * 4);
      for (let j = 0; j < h; j++) for (let k = 0; k < w * 4; k++) rgba[j * w * 4 + k] = gpuHalfValue(read[j * stride + k]);
      return { x0, y0, w, h, rgba };
    },
    dispose: () => {
      target?.dispose();
      meshes.dispose();
    },
  };
}
