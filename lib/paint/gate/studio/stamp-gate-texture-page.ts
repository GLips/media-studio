// stamp-gate-texture-page.ts: the gate page's painted textures (stamp-gate-textures.ts): a case's texture compiled
// and drawn as a shot's painted texture on a device of its own (compileShotPaintedTextures,
// createShotPaintedTextures), read by its three.js object through the three-source loader, and the object's view laid
// with the texture flat in the baseline's frame; and a shot wearing one, its cylinder built as theirs are, drawn
// frame after frame through the shot's renderer, warmed and not. The objects are the page's; all else of a case is
// its row of STAMP_GATE_TEXTURE_CASES or STAMP_GATE_SHOT_TEXTURE_CASES.

import { CylinderGeometry, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, type BufferGeometry } from 'three/webgpu';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compileShotPaintedTextures } from '#lib/paint/shot/models/shot-painted-texture-compile.ts';
import { createShotPaintedTextures } from '#lib/paint/shot/studio/shot-painted-textures.ts';
import { paintedThreeColorNode } from '#lib/paint/three-layers/studio/painted-three-material.ts';
import { loadPaintedThreeSources, type PaintedThreeSourceScene, type PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { stampGateDifferenceBox } from '../models/stamp-gate-shots.ts';
import {
  STAMP_GATE_CYLINDER, STAMP_GATE_PLANE, STAMP_GATE_SHOT_TEXTURE_CASES, STAMP_GATE_TEXEL_PX, STAMP_GATE_TEXTURE_CASES, stampGateSeamSteps, stampGateShotTextureCylinderBox,
  stampGateShotTextureFrame, stampGateTextureFrame, stampGateTextureSeams, type StampGateShotTextureId, type StampGateTextureCase, type StampGateTextureId,
} from '../models/stamp-gate-textures.ts';
import { stampGateRgb, stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, type StampGateShotFramesWatch } from './stamp-gate-shot-frames.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

const SOURCE_ID = 'textured';

/** The three.js object a case's view sees reading its texture: its geometry, and how far behind the plane its centre lies, frame px. */
type StampGateTextureReader = { geometry: BufferGeometry; behind: number };

/** The gate's cylinder, its front on the plane. */
const stampGateCylinder = ({ plane }: PaintedThreeSourceTools): StampGateTextureReader => {
  const { radius, height, segments } = STAMP_GATE_CYLINDER, r = plane.length(radius);
  return { geometry: new CylinderGeometry(r, r, plane.length(height), segments, 1, true), behind: r };
};

/** Each case's object, built against the loader's plane. */
const STAMP_GATE_TEXTURE_OBJECTS: Readonly<Record<StampGateTextureId, (tools: PaintedThreeSourceTools) => StampGateTextureReader>> = {
  'texture/wrapped-cylinder': stampGateCylinder,
  'texture/wrapped-tile': ({ plane }) => {
    const side = plane.length(STAMP_GATE_PLANE.size), geometry = new PlaneGeometry(side, side), uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, STAMP_GATE_PLANE.repeats * uv.getX(i), STAMP_GATE_PLANE.repeats * uv.getY(i));
    return { geometry, behind: 0 };
  },
};

/** A three.js scene of `object`, coloured by painted texture `textureId`, centred on `at`, frame px. */
function stampGateTexturedScene(
  { plane, textures }: PaintedThreeSourceTools, at: StampPoint, textureId: string, { geometry, behind }: StampGateTextureReader,
): PaintedThreeSourceScene {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = paintedThreeColorNode(textures.get(textureId)!);
  const mesh = new Mesh(geometry, material), centre = plane.point(at);
  mesh.position.set(centre.x, centre.y, centre.z - behind);
  const scene = new Scene();
  scene.add(mesh);
  return { scene, poseAt: () => {}, dispose: () => {
    geometry.dispose();
    material.dispose();
  } };
}

/**
 * The WGSL laying a case's frame: within its view, the object's premultiplied view over its grey; within its flat
 * texture, the texture's texel there (rolled, and repeating past its size), already encoded.
 */
function layWgsl({ view, viewAt, flat }: StampGateTextureCase): string {
  const texel = STAMP_GATE_TEXEL_PX;
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
@group(0) @binding(0) var view: texture_2d<f32>;
@group(0) @binding(1) var painted: texture_2d<f32>;
@fragment fn layFrame(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = vec2i(at.xy);
  let grey = ${view.grey.toFixed(3)};
  let seen = p - vec2i(${viewAt.x}, ${viewAt.y});
  if (all(seen >= vec2i(0)) && all(seen < vec2i(${view.width}, ${view.height}))) {
    let object = textureLoad(view, seen, 0);
    return vec4f(srgbEncoded(object.rgb + (1.0 - object.a) * grey), 1.0);
  }
  let q = p - vec2i(${flat.at.x}, ${flat.at.y});
  if (any(q < vec2i(0)) || any(q >= vec2i(${texel * flat.texels.width}, ${texel * flat.texels.height}))) { return vec4f(srgbEncoded(vec3f(grey)), 1.0); }
  let size = vec2i(textureDimensions(painted));
  return vec4f(textureLoad(painted, (q / ${texel} + vec2i(${flat.roll.x}, ${flat.roll.y})) % size, 0).rgb, 1.0);
}`;
}

/** Texture baseline `id`'s frame, RGBA bytes: its object seen, and its texture flat. */
function drawStampGateTextureFrame(id: StampGateTextureId): Promise<Uint8ClampedArray> {
  const drawn = STAMP_GATE_TEXTURE_CASES[id], texture = drawn.texture(), { width, height, fov } = drawn.view;
  const built = buildPaintCamera({ stage: stampStage({ width, height }), fov, planes: [{ id: SOURCE_ID, depth: 1, kind: 'three' }], lens: { bloom: 0, shutter: 0 }, plays: [] });
  if (!built.ok) throw new Error(`stamp gate: ${id}'s camera: ${built.problems.join('; ')}`);
  return withGateSurface(stampGateTextureFrame(id), stampGateSheetImageUrl, async (surface, frame) => {
    const compiled = compileShotPaintedTextures([texture]);
    if (!compiled.textures) throw new Error(`stamp gate: ${id}'s texture: ${compiled.problems.map(paintingProblemText).join('; ')}`);
    const { owner } = surface, textures = createShotPaintedTextures(owner, compiled.textures, { brushOf: stampGateSheetBrushOf });
    try {
      const centre = { x: drawn.view.width / 2, y: drawn.view.height / 2 };
      const build = (tools: PaintedThreeSourceTools) => stampGateTexturedScene(tools, centre, texture.id, STAMP_GATE_TEXTURE_OBJECTS[id](tools));
      const loaded = await loadPaintedThreeSources(owner, built.camera, [{ id: SOURCE_ID, build }], textures);
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

/** Shot texture case `id`'s frames, RGBA bytes, drawn in turn through one renderer, warmed first when `warmed`; `watch` told as they're drawn. */
function drawStampGateShotTextureFrames(id: StampGateShotTextureId, warmed: boolean, watch?: StampGateShotFramesWatch): Promise<Uint8ClampedArray[]> {
  const { shot, cylinderAt, texture, frames } = STAMP_GATE_SHOT_TEXTURE_CASES[id];
  return stampGateShotFrames(shot((tools) => stampGateTexturedScene(tools, cylinderAt, texture, stampGateCylinder(tools)), warmed), frames, watch);
}

/** Shot texture baseline `id`'s frames side by side, drawn through the shot's renderer unwarmed: RGB bytes row by row, in base64. */
export async function paintStampGateShotTexture(id: StampGateShotTextureId): Promise<string> {
  const drawn = await drawStampGateShotTextureFrames(id, false), { width, height } = stampGateShotTextureFrame(id), one = width / drawn.length;
  const beside = new Uint8ClampedArray(width * height * 4);
  drawn.forEach((rgba, f) => {
    for (let y = 0; y < height; y++) beside.set(rgba.subarray(y * one * 4, (y + 1) * one * 4), (y * width + f * one) * 4);
  });
  return stampGateRgbBase64(beside);
}

const solvedText = ({ solves }: StampPaintCosts) => solves.map(({ program, from, entries }) => `${program} from ${from} (${entries})`).join(', ') || 'nothing';
const boxText = (box: { x0: number; y0: number; x1: number; y1: number } | null) => (box ? `x ${box.x0}..${box.x1}, y ${box.y0}..${box.y1}` : 'nothing');

/**
 * Shot texture case `id` through one renderer: its first frame solves its texture's prefix itself, the back reading
 * the finished painting; its second, a stroke later, changes the cylinder and nothing else. Warmed over its frames,
 * neither solves anything.
 */
export async function checkStampGateShotTextureCase(id: StampGateShotTextureId): Promise<StampGateWashCheck[]> {
  const { frames, frame: { width, height } } = STAMP_GATE_SHOT_TEXTURE_CASES[id], [first, second] = frames;
  const costs = createStampPaintCostTally(), taken: StampPaintCosts[] = [];
  const [before, after] = await drawStampGateShotTextureFrames(id, false, { costs, drawn: () => taken.push(costs.take()) });
  const changed = stampGateDifferenceBox(stampGateRgb(before), stampGateRgb(after), width), cylinder = stampGateShotTextureCylinderBox(id);
  const onCylinder = !!changed && changed.x0 >= cylinder.x0 && changed.y0 >= cylinder.y0 && changed.x1 <= cylinder.x1 && changed.y1 <= cylinder.y1;
  const warmCosts = createStampPaintCostTally(), warmTaken: StampPaintCosts[] = [];
  let warm: StampPaintCosts | null = null;
  await drawStampGateShotTextureFrames(id, true, { costs: warmCosts, warmed: () => (warm = warmCosts.take()), drawn: () => warmTaken.push(warmCosts.take()) });
  const warmSolves = warm!.solves, drawnSolves = warmTaken.flatMap(({ solves }) => solves);
  return [
    {
      id: `${id}: own solve`, passed: taken[0].solves.length === 2,
      detail: `at ${first} s it solved ${solvedText(taken[0])}: the back's whole painting and the texture's prefix to ${first} s, 2 wanted (1 when the texture reads the back's films)`,
    },
    {
      id: `${id}: drawn each frame`, passed: onCylinder,
      detail: `from ${first} s to ${second} s through one renderer, its second stroke landing between them, the frame changed ${boxText(changed)} (within the cylinder's ${boxText(cylinder)} of a ${width} × ${height} frame wanted)`,
    },
    {
      id: `${id}: warmed`, passed: warmSolves.length > 0 && !drawnSolves.length,
      detail: `its warm solved ${solvedText(warm!)}; its frames then solved ${warmTaken.map((each, f) => `${solvedText(each)} at ${frames[f]} s`).join(' and ')}`,
    },
  ];
}

/**
 * How far a seam's step may stand above the roughest beside it, levels: a level for rounding. Wrapped, it sits below
 * its neighbours (the grain's mirrored tiles meet there); cut, the marks end on it, near 110.
 */
const SEAM_ALLOWANCE = 1;
/** Texel boundaries either side of a seam its step is held to. */
const SEAM_NEIGHBOURS = 12;

/** A case's flat texture's texels, RGB bytes row by row, read back out of its frame's `rgb`, each STAMP_GATE_TEXEL_PX px across. */
function stampGateFlatTexels(rgb: Uint8ClampedArray, frameWidth: number, { at, texels: { width, height } }: StampGateTextureCase['flat']): Uint8Array {
  const texels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((at.y + y * STAMP_GATE_TEXEL_PX) * frameWidth + at.x + x * STAMP_GATE_TEXEL_PX) * 3;
      texels.set(rgb.subarray(from, from + 3), (y * width + x) * 3);
    }
  }
  return texels;
}

/**
 * A texture case laid flat, each of its seams no rougher than the paint beside it: the mean step across the seam's
 * texel boundary at most the roughest within SEAM_NEIGHBOURS of it, plus SEAM_ALLOWANCE.
 */
export async function checkStampGateTextureCase(id: StampGateTextureId): Promise<StampGateWashCheck> {
  const { flat } = STAMP_GATE_TEXTURE_CASES[id];
  const texels = stampGateFlatTexels(stampGateRgb(await drawStampGateTextureFrame(id)), stampGateTextureFrame(id).width, flat);
  const held = stampGateTextureSeams(id).map(({ axis, at }) => {
    const steps = stampGateSeamSteps(texels, flat.texels.width, flat.texels.height, axis);
    const roughest = Math.max(...steps.filter((_, b) => b !== at && Math.abs(b - at) <= SEAM_NEIGHBOURS));
    return { passed: steps[at] <= roughest + SEAM_ALLOWANCE, detail: `across ${axis} the mean step over the seam ${steps[at].toFixed(2)} levels, the roughest within ${SEAM_NEIGHBOURS} of it ${roughest.toFixed(2)}` };
  });
  return { id: `${id}: no seam`, passed: held.every(({ passed }) => passed), detail: `${held.map(({ detail }) => detail).join('; ')} (past it by ${SEAM_ALLOWANCE} fails)` };
}
