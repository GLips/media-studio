// stamp-gate-texture-page.ts: the gate page's painted textures (stamp-gate-textures.ts): the wrapped paintings'
// dissolve compiled and drawn as a shot's painted texture on a device of its own (compileShotPaintedTextures,
// createShotPaintedTextures), read by a three.js cylinder through the three-source loader, and the cylinder's view
// laid above the texture flat in the baseline's frame.

import { CylinderGeometry, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { compileShotPaintedTextures } from '#lib/paint/shot/models/shot-painted-texture-compile.ts';
import { createShotPaintedTextures } from '#lib/paint/shot/studio/shot-painted-textures.ts';
import { paintedThreeColorNode } from '#lib/paint/three-layers/studio/painted-three-material.ts';
import { loadPaintedThreeSources, type PaintedThreeSourceScene, type PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_CYLINDER, STAMP_GATE_CYLINDER_VIEW, STAMP_GATE_TEXEL_PX, STAMP_GATE_TEXTURE_FRAME, STAMP_GATE_WRAPPED_TEXTURE, stampGateColumnSteps, stampGateWrappedTexture,
  type StampGateTextureId,
} from '../models/stamp-gate-textures.ts';
import { stampGateRgb, stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

const CYLINDER_ID = 'cylinder';

/** The cylinder, its painted texture round it, its seam (u 0 and 1) turned to the camera, its front on the plane. */
function buildStampGateCylinder({ plane, textures }: PaintedThreeSourceTools): PaintedThreeSourceScene {
  const { radius, height, segments } = STAMP_GATE_CYLINDER, r = plane.length(radius);
  const geometry = new CylinderGeometry(r, r, plane.length(height), segments, 1, true);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = paintedThreeColorNode(textures.get(stampGateWrappedTexture().id)!);
  const mesh = new Mesh(geometry, material), centre = plane.point({ x: STAMP_GATE_CYLINDER_VIEW.width / 2, y: STAMP_GATE_CYLINDER_VIEW.height / 2 });
  mesh.position.set(centre.x, centre.y, centre.z - r);
  const scene = new Scene();
  scene.add(mesh);
  return { scene, poseAt: () => {}, dispose: () => {
    geometry.dispose();
    material.dispose();
  } };
}

// The cylinder's premultiplied view over grey above; the texture below, already encoded, rolled half its width, each
// texel STAMP_GATE_TEXEL_PX px across.
const LAY_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
@group(0) @binding(0) var view: texture_2d<f32>;
@group(0) @binding(1) var painted: texture_2d<f32>;
@fragment fn lay(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = vec2i(at.xy);
  let above = ${STAMP_GATE_CYLINDER_VIEW.height};
  let width = ${STAMP_GATE_WRAPPED_TEXTURE.width};
  let texel = ${STAMP_GATE_TEXEL_PX};
  if (p.y < above) {
    let seen = textureLoad(view, p, 0);
    return vec4f(srgbEncoded(seen.rgb + (1.0 - seen.a) * ${STAMP_GATE_CYLINDER_VIEW.grey.toFixed(3)}), 1.0);
  }
  return vec4f(textureLoad(painted, vec2i((p.x / texel + width / 2) % width, (p.y - above) / texel), 0).rgb, 1.0);
}`;

/** The texture baseline's frame, RGBA bytes: the cylinder seen above, the texture flat below. */
function drawStampGateTextureFrame(): Promise<Uint8ClampedArray> {
  const { width, height, fov } = STAMP_GATE_CYLINDER_VIEW;
  const built = buildPaintCamera({ stage: stampStage({ width, height }), fov, planes: [{ id: CYLINDER_ID, depth: 1, kind: 'three' }], lens: { bloom: 0, shutter: 0 }, plays: [] });
  if (!built.ok) throw new Error(`stamp gate: the cylinder's camera: ${built.problems.join('; ')}`);
  return withGateSurface(STAMP_GATE_TEXTURE_FRAME, stampGateSheetImageUrl, async (surface, frame) => {
    const compiled = compileShotPaintedTextures([stampGateWrappedTexture()]);
    if (!compiled.textures) throw new Error(`stamp gate: the wrapped texture: ${compiled.problems.map(paintingProblemText).join('; ')}`);
    const { owner } = surface, textures = createShotPaintedTextures(owner, compiled.textures, { brushOf: stampGateSheetBrushOf });
    try {
      const loaded = await loadPaintedThreeSources(owner, built.camera, [{ id: CYLINDER_ID, build: buildStampGateCylinder }], textures);
      try {
        const source = loaded.sources.get(CYLINDER_ID)!;
        if (source.kind !== 'three') throw new Error('stamp gate: the cylinder\'s source isn\'t a three source');
        await source.render(0, null);
        await owner.checked('laying the cylinder over its texture', () => {
          const { device } = owner, module = device.createShaderModule({ code: LAY_WGSL });
          const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format: surface.format }] } });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.frameTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, stampBindGroup(device, pipeline, [source.picture.texture.createView(), textures.handles[0].texture.createView()]));
          pass.draw(3);
          pass.end();
          device.queue.submit([encoder.finish()]);
        });
        await owner.device.queue.onSubmittedWorkDone();
        return frame();
      } finally {
        loaded.dispose();
      }
    } finally {
      textures.dispose();
    }
  });
}

/** Texture baseline `id`'s frame: RGB bytes row by row, in base64. */
export async function paintStampGateTexture(_id: StampGateTextureId): Promise<string> {
  return stampGateRgbBase64(await drawStampGateTextureFrame());
}

/**
 * How far the seam's step may stand above the roughest beside it, levels: a level for rounding. Wrapped, it sits
 * below its neighbours (the grain's mirrored tiles meet there); cut, the band and flood end on it, near 110.
 */
const SEAM_ALLOWANCE = 1;
/** Column boundaries either side of the seam its step is held to. */
const SEAM_NEIGHBOURS = 12;

/** The flat texture's texels, RGB bytes row by row, read back out of the frame's `rgb` (each STAMP_GATE_TEXEL_PX px across). */
function stampGateFlatTexels(rgb: Uint8ClampedArray): Uint8Array {
  const { width, height } = STAMP_GATE_WRAPPED_TEXTURE, frameWidth = STAMP_GATE_TEXTURE_FRAME.width, above = STAMP_GATE_CYLINDER_VIEW.height;
  const texels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((above + y * STAMP_GATE_TEXEL_PX) * frameWidth + x * STAMP_GATE_TEXEL_PX) * 3;
      texels.set(rgb.subarray(from, from + 3), (y * width + x) * 3);
    }
  }
  return texels;
}

/**
 * texture/wrapped-cylinder: the texture laid flat and rolled, its seam no rougher than the paint beside it: the mean
 * step across the seam's texel columns at most the roughest within SEAM_NEIGHBOURS of it, plus SEAM_ALLOWANCE.
 */
export async function checkStampGateTextureCase(id: StampGateTextureId): Promise<StampGateWashCheck> {
  const { width, height } = STAMP_GATE_WRAPPED_TEXTURE;
  const steps = stampGateColumnSteps(stampGateFlatTexels(stampGateRgb(await drawStampGateTextureFrame())), width, height), seam = width / 2 - 1;
  const beside = steps.filter((_, b) => b !== seam && Math.abs(b - seam) <= SEAM_NEIGHBOURS), roughest = Math.max(...beside);
  return {
    id: `${id}: no seam`, passed: steps[seam] <= roughest + SEAM_ALLOWANCE,
    detail: `the mean step across the seam ${steps[seam].toFixed(2)} levels, the roughest within ${SEAM_NEIGHBOURS} columns of it ${roughest.toFixed(2)} (past it by ${SEAM_ALLOWANCE} fails)`,
  };
}
