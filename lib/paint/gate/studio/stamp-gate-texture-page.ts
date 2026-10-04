// stamp-gate-texture-page.ts: the gate page's painted textures (stamp-gate-textures.ts): a case's texture compiled
// and drawn as a shot's painted texture on a device of its own (compileShotPaintedTextures,
// createShotPaintedTextures), read by a three.js object through the three-source loader, and the object's view laid
// with the texture flat in the baseline's frame. Each case is a row of STAMP_GATE_TEXTURE_CASES.

import { CylinderGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, type BufferGeometry } from 'three/webgpu';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { stampStage, type StampAxis } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { compileShotPaintedTextures } from '#lib/paint/shot/models/shot-painted-texture-compile.ts';
import type { PaintedTexture } from '#lib/paint/shot/models/shot-props.ts';
import { createShotPaintedTextures } from '#lib/paint/shot/studio/shot-painted-textures.ts';
import { paintedThreeColorNode } from '#lib/paint/three-layers/studio/painted-three-material.ts';
import { loadPaintedThreeSources, type PaintedThreeSourceScene, type PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import {
  STAMP_GATE_CYLINDER, STAMP_GATE_CYLINDER_VIEW, STAMP_GATE_PLANE, STAMP_GATE_PLANE_VIEW, STAMP_GATE_TEXEL_PX, STAMP_GATE_TILE_TEXTURE, STAMP_GATE_WRAPPED_TEXTURE,
  stampGateSeamSteps, stampGateTextureFrame, stampGateTileTexture, stampGateWrappedTexture, type StampGateTextureId,
} from '../models/stamp-gate-textures.ts';
import { stampGateRgb, stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

const SOURCE_ID = 'textured';

/** A three.js scene of one mesh, `geometry` coloured by painted `texture`, its centre `behind` the view's on the plane. */
function stampGateTexturedScene(
  { plane, textures }: PaintedThreeSourceTools, view: { width: number; height: number }, texture: PaintedTexture, geometry: BufferGeometry, behind: number,
): PaintedThreeSourceScene {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = paintedThreeColorNode(textures.get(texture.id)!);
  const mesh = new Mesh(geometry, material), centre = plane.point({ x: view.width / 2, y: view.height / 2 });
  mesh.position.set(centre.x, centre.y, centre.z - behind);
  const scene = new Scene();
  scene.add(mesh);
  return { scene, poseAt: () => {}, dispose: () => {
    geometry.dispose();
    material.dispose();
  } };
}

/** What a texture case draws: its texture, the view and object reading it, its frame's lay, and its flat texture's seams. */
type StampGateTextureCase = {
  readonly texture: () => PaintedTexture;
  readonly view: { readonly width: number; readonly height: number; readonly fov: number; readonly grey: number };
  readonly build: (tools: PaintedThreeSourceTools) => PaintedThreeSourceScene;
  /** WGSL for `lay(p)`, the frame's pixel `p` from `view` (the object seen, through overGrey) and `painted`. */
  readonly lay: string;
  /** Where the flat texture lies in the frame, px, and its texels across and down. */
  readonly flat: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Each axis a seam crosses the flat texture on, and the texel boundary it lies on. */
  readonly seams: readonly { readonly axis: StampAxis; readonly at: number }[];
};

const STAMP_GATE_TEXTURE_CASES: Readonly<Record<StampGateTextureId, StampGateTextureCase>> = {
  // The cylinder above, its seam (u 0 and 1) turned to the camera, its front on the plane; the texture below, rolled
  // half its width so its seam runs down the middle.
  'texture/wrapped-cylinder': {
    texture: stampGateWrappedTexture,
    view: STAMP_GATE_CYLINDER_VIEW,
    build: (tools) => {
      const { radius, height, segments } = STAMP_GATE_CYLINDER, r = tools.plane.length(radius);
      return stampGateTexturedScene(tools, STAMP_GATE_CYLINDER_VIEW, stampGateWrappedTexture(), new CylinderGeometry(r, r, tools.plane.length(height), segments, 1, true), r);
    },
    lay: /* wgsl */ `
fn lay(p: vec2i) -> vec4f {
  let above = ${STAMP_GATE_CYLINDER_VIEW.height};
  let width = ${STAMP_GATE_WRAPPED_TEXTURE.width};
  let texel = ${STAMP_GATE_TEXEL_PX};
  if (p.y < above) { return overGrey(textureLoad(view, p, 0)); }
  return vec4f(textureLoad(painted, vec2i((p.x / texel + width / 2) % width, (p.y - above) / texel), 0).rgb, 1.0);
}`,
    flat: { x: 0, y: STAMP_GATE_CYLINDER_VIEW.height, ...STAMP_GATE_WRAPPED_TEXTURE },
    seams: [{ axis: 'x', at: STAMP_GATE_WRAPPED_TEXTURE.width / 2 - 1 }],
  },
  // The tile flat 2 × 2 on the left, its seams and corner at the middle; the plane beside it, its uv to 2 each way.
  'texture/wrapped-tile': {
    texture: stampGateTileTexture,
    view: STAMP_GATE_PLANE_VIEW,
    build: (tools) => {
      const side = tools.plane.length(STAMP_GATE_PLANE.size), geometry = new PlaneGeometry(side, side), uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, STAMP_GATE_PLANE.repeats * uv.getX(i), STAMP_GATE_PLANE.repeats * uv.getY(i));
      return stampGateTexturedScene(tools, STAMP_GATE_PLANE_VIEW, stampGateTileTexture(), geometry, 0);
    },
    lay: /* wgsl */ `
fn lay(p: vec2i) -> vec4f {
  let size = vec2i(${STAMP_GATE_TILE_TEXTURE.width}, ${STAMP_GATE_TILE_TEXTURE.height});
  let texel = ${STAMP_GATE_TEXEL_PX};
  let flat = 2 * texel * size.x;
  if (p.x >= flat) { return overGrey(textureLoad(view, p - vec2i(flat, 0), 0)); }
  return vec4f(textureLoad(painted, (p / texel) % size, 0).rgb, 1.0);
}`,
    flat: { x: 0, y: 0, width: 2 * STAMP_GATE_TILE_TEXTURE.width, height: 2 * STAMP_GATE_TILE_TEXTURE.height },
    seams: [{ axis: 'x', at: STAMP_GATE_TILE_TEXTURE.width - 1 }, { axis: 'y', at: STAMP_GATE_TILE_TEXTURE.height - 1 }],
  },
};

/** The WGSL laying `drawn`'s frame: the object's premultiplied view over its grey, and its texture, already encoded. */
const layWgsl = ({ view, lay }: StampGateTextureCase) => /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
@group(0) @binding(0) var view: texture_2d<f32>;
@group(0) @binding(1) var painted: texture_2d<f32>;
fn overGrey(seen: vec4f) -> vec4f { return vec4f(srgbEncoded(seen.rgb + (1.0 - seen.a) * ${view.grey.toFixed(3)}), 1.0); }
${lay}
@fragment fn layFrame(@builtin(position) at: vec4f) -> @location(0) vec4f { return lay(vec2i(at.xy)); }`;

/** Texture baseline `id`'s frame, RGBA bytes: its object seen, and its texture flat. */
function drawStampGateTextureFrame(id: StampGateTextureId): Promise<Uint8ClampedArray> {
  const drawn = STAMP_GATE_TEXTURE_CASES[id], { width, height, fov } = drawn.view;
  const built = buildPaintCamera({ stage: stampStage({ width, height }), fov, planes: [{ id: SOURCE_ID, depth: 1, kind: 'three' }], lens: { bloom: 0, shutter: 0 }, plays: [] });
  if (!built.ok) throw new Error(`stamp gate: ${id}'s camera: ${built.problems.join('; ')}`);
  return withGateSurface(stampGateTextureFrame(id), stampGateSheetImageUrl, async (surface, frame) => {
    const compiled = compileShotPaintedTextures([drawn.texture()]);
    if (!compiled.textures) throw new Error(`stamp gate: ${id}'s texture: ${compiled.problems.map(paintingProblemText).join('; ')}`);
    const { owner } = surface, textures = createShotPaintedTextures(owner, compiled.textures, { brushOf: stampGateSheetBrushOf });
    try {
      const loaded = await loadPaintedThreeSources(owner, built.camera, [{ id: SOURCE_ID, build: drawn.build }], textures);
      try {
        const source = loaded.sources.get(SOURCE_ID)!;
        if (source.kind !== 'three') throw new Error(`stamp gate: ${id}'s source isn't a three source`);
        await source.render(0, null);
        await owner.checked(`laying ${id}'s frame`, () => {
          const { device } = owner, module = device.createShaderModule({ code: layWgsl(drawn) });
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
export async function paintStampGateTexture(id: StampGateTextureId): Promise<string> {
  return stampGateRgbBase64(await drawStampGateTextureFrame(id));
}

/**
 * How far a seam's step may stand above the roughest beside it, levels: a level for rounding. Wrapped, it sits below
 * its neighbours (the grain's mirrored tiles meet there); cut, the marks end on it, near 110.
 */
const SEAM_ALLOWANCE = 1;
/** Texel boundaries either side of a seam its step is held to. */
const SEAM_NEIGHBOURS = 12;

/** A case's flat texture's texels, RGB bytes row by row, read back out of its frame's `rgb`, each STAMP_GATE_TEXEL_PX px across. */
function stampGateFlatTexels(rgb: Uint8ClampedArray, frameWidth: number, flat: StampGateTextureCase['flat']): Uint8Array {
  const texels = new Uint8Array(flat.width * flat.height * 3);
  for (let y = 0; y < flat.height; y++) {
    for (let x = 0; x < flat.width; x++) {
      const from = ((flat.y + y * STAMP_GATE_TEXEL_PX) * frameWidth + flat.x + x * STAMP_GATE_TEXEL_PX) * 3;
      texels.set(rgb.subarray(from, from + 3), (y * flat.width + x) * 3);
    }
  }
  return texels;
}

/**
 * A texture case laid flat, each of its seams no rougher than the paint beside it: the mean step across the seam's
 * texel boundary at most the roughest within SEAM_NEIGHBOURS of it, plus SEAM_ALLOWANCE.
 */
export async function checkStampGateTextureCase(id: StampGateTextureId): Promise<StampGateWashCheck> {
  const { flat, seams } = STAMP_GATE_TEXTURE_CASES[id];
  const texels = stampGateFlatTexels(stampGateRgb(await drawStampGateTextureFrame(id)), stampGateTextureFrame(id).width, flat);
  const held = seams.map(({ axis, at }) => {
    const steps = stampGateSeamSteps(texels, flat.width, flat.height, axis);
    const roughest = Math.max(...steps.filter((_, b) => b !== at && Math.abs(b - at) <= SEAM_NEIGHBOURS));
    return { passed: steps[at] <= roughest + SEAM_ALLOWANCE, detail: `across ${axis} the mean step over the seam ${steps[at].toFixed(2)} levels, the roughest within ${SEAM_NEIGHBOURS} of it ${roughest.toFixed(2)}` };
  });
  return { id: `${id}: no seam`, passed: held.every(({ passed }) => passed), detail: `${held.map(({ detail }) => detail).join('; ')} (past it by ${SEAM_ALLOWANCE} fails)` };
}
