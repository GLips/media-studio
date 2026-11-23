// stamp-gate-lens-tilt-page.ts: the gate page's tilted focus (stamp-gate-lens-tilt.ts): the bars built as a
// three.js scene, an unlit quad facing the camera, and the shot drawn fast and as a reference frame.

import { DataTexture, Mesh, MeshBasicNodeMaterial, NearestFilter, PlaneGeometry, Scene, SRGBColorSpace } from 'three/webgpu';
import type { PaintedThreeSourceScene, PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { checkStampGateLensTilt, STAMP_GATE_LENS_TILT, stampGateLensTiltShot } from '../models/stamp-gate-lens-tilt.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** The bars: a quad over its box at its plane's depth, striped dark and pale a `cell` wide. */
function stampGateLensTiltBars({ plane }: PaintedThreeSourceTools): PaintedThreeSourceScene {
  const { x0, x1, y0, y1, cell } = STAMP_GATE_LENS_TILT.bars, across = (x1 - x0) / cell, texels = new Uint8Array(across * 4);
  for (let i = 0; i < across; i++) texels.set(i % 2 ? [40, 44, 60, 255] : [236, 228, 210, 255], i * 4);
  const map = new DataTexture(texels, across, 1);
  Object.assign(map, { magFilter: NearestFilter, minFilter: NearestFilter, colorSpace: SRGBColorSpace, needsUpdate: true });
  const geometry = new PlaneGeometry(plane.length(x1 - x0), plane.length(y1 - y0)), material = new MeshBasicNodeMaterial({ map }), mesh = new Mesh(geometry, material);
  const centre = plane.point({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  mesh.position.set(centre.x, centre.y, centre.z);
  const scene = new Scene();
  scene.add(mesh);
  return {
    scene,
    poseAt: () => {},
    dispose: () => {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

/** The tilted focus's checks (checkStampGateLensTilt) on its frames as drawn. */
export async function checkStampGateLensTiltCase(): Promise<StampGateWashCheck[]> {
  const { frames } = await stampGateShotFrames(stampGateLensTiltShot(stampGateLensTiltBars), STAMP_GATE_LENS_TILT.frames.map(({ at, mode }) => ({ t: at, mode })));
  return checkStampGateLensTilt(frames);
}
