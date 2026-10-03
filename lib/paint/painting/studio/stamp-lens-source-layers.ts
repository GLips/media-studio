// stamp-lens-source-layers.ts: a scene's source planes (stamp-lens-source.ts) rendered and laid through the lens, for
// the stamp renderer and the sources renderer alike. A three source's render is already through the camera: it's laid
// at rest, defocused per texel by its depth. A picture source's is in the stage's texels: it's defocused by its plane's
// look, as a painted picture is, and laid where the look puts it, clear past its edge.

import { LENS_DEFOCUS_LEAST, lensSigmaStepped, type LensFocus } from '#lib/picture/lens/models/lens-focus.ts';
import type { LensCompositor, LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { LensPictureLayers } from '#lib/picture/lens/studio/lens-passes.ts';
import type { StampLaidPlanes, StampLaidSourcePlane, StampPlaneLook } from '../models/stamp-plane.ts';
import type { StampStage, StampStageTexels } from '../models/stamp-stage.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import type { StampLensPicture, StampLensSource, StampLensSourceExposure, StampPictureLensSource, StampThreeLensSource } from './stamp-lens-source.ts';

/** A source's render's layers: laid over by its alpha, as a paper picture is, with no emission. */
const SOURCE_LAYERS: LensPictureLayers = { taken: null, emission: null, motion: null };
const SOURCE_MOTION_LAYERS: LensPictureLayers = { ...SOURCE_LAYERS, motion: 1 };

/** Rest: a plane where it's painted, sharp. */
export const STAMP_REST_LOOK: StampPlaneLook = { view: { ma: 1, mb: 0, kx: 0, ky: 0 }, defocus: 0, distance: 1, shutter: null };

/** What a frame's sources rendered: the three sources that moved over its shutter, and each picture source's picture. */
export type StampSourceRenders = { readonly moved: ReadonlySet<string>; readonly pictures: ReadonlyMap<string, StampLensPicture | null> };

/**
 * How a frame lays a source plane: its `look`, the lens's `focus`, whether the frame gathers motion, and whether it's
 * the `back`, which must show wherever the frame does.
 */
export type StampSourceLaying = { readonly look: StampPlaneLook; readonly focus: LensFocus | null; readonly moving: boolean; readonly back: boolean };

export type StampLensSourceLayers = {
  /** Renders each source for frame time `t` (or `exposure`), one after another. */
  render: (t: number, exposure: StampLensSourceExposure | null) => Promise<StampSourceRenders>;
  /** Source plane `plane`'s layer, as `renders` holds its render, laid as `laying` says; none for a picture with nothing. */
  layer: (encoder: GPUCommandEncoder, plane: StampLaidSourcePlane, renders: StampSourceRenders, laying: StampSourceLaying) => LensLayer[];
};

/**
 * Refuses a source plane without a source of its kind, a three picture that isn't rgba16float to sample or doesn't
 * cover the frame, and a source for a plane that isn't a source plane.
 */
export function checkStampLensSources(planes: StampLaidPlanes, sources: ReadonlyMap<string, StampLensSource>, { frame }: StampStage) {
  const sourcePlanes = new Map([planes.back, ...planes.nearer].flatMap((plane) => (plane.kind === 'painted' ? [] : [[plane.id, plane.kind] as const])));
  for (const id of sources.keys()) if (!sourcePlanes.has(id)) throw new Error(`stamp paint: a source is handed in for ${id}, which isn't a source plane`);
  for (const [id, kind] of sourcePlanes) {
    const source = sources.get(id);
    if (!source) throw new Error(`stamp paint: source plane ${id} has no source handed in`);
    if (source.kind !== kind) throw new Error(`stamp paint: ${kind} plane ${id} is handed a ${source.kind} source`);
    if (source.kind !== 'three') continue;
    const { texture, motion, at } = source.picture;
    for (const [name, made] of [['texture', texture], ['motion', motion]] as const) {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
      if (made.format !== 'rgba16float' || made.depthOrArrayLayers !== 1 || (made.usage & usage) !== usage || made.width !== texture.width || made.height !== texture.height) {
        throw new Error(`stamp paint: source plane ${id}'s ${name} must be rgba16float, one layer, the colour's size, with TEXTURE_BINDING and COPY_SRC usage`);
      }
    }
    if (!(Number.isInteger(at.x) && Number.isInteger(at.y) && at.x <= 0 && at.y <= 0 && at.x + texture.width >= frame.width && at.y + texture.height >= frame.height)) {
      throw new Error(`stamp paint: source plane ${id}'s picture, ${texture.width} × ${texture.height} at (${at.x}, ${at.y}), must cover the ${frame.width} × ${frame.height} frame from whole px`);
    }
  }
}

/** Refuses a picture that isn't rgba16float, one sampled layer, its box's size, at whole texels within the stage. */
function checkStampLensPicture(id: string, { texture, box }: StampLensPicture, { width, height }: StampStage) {
  const whole = [box.x, box.y, box.w, box.h].every(Number.isInteger) && box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;
  if (!whole || texture.format !== 'rgba16float' || texture.depthOrArrayLayers !== 1 || !(texture.usage & GPUTextureUsage.TEXTURE_BINDING) || texture.width !== box.w || texture.height !== box.h) {
    throw new Error(`stamp paint: picture plane ${id}'s picture must be rgba16float, one layer with TEXTURE_BINDING, ${box.w} × ${box.h} as its box at whole texels (${box.x}, ${box.y}) within the ${width} × ${height} stage says; it's ${texture.format}, ${texture.width} × ${texture.height}`);
  }
}

/** The largest box the lens blurs over for `sources` on `stage`: the stage, or a three source's picture if wider. */
export function stampLensSourcesBlurExtent({ width, height }: StampStage, sources: ReadonlyMap<string, StampLensSource>) {
  const threes = [...sources.values()].flatMap((source) => (source.kind === 'three' ? [source.picture.texture] : []));
  return { w: Math.max(width, ...threes.map(({ width: w }) => w)), h: Math.max(height, ...threes.map(({ height: h }) => h)) };
}

/** `texture` viewed as an array, as a gaussian pass binds a plain target and an array one alike. */
const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' });

/** `sources` rendered and laid on `owner`'s device through `lens`, on `stage`. */
export function createStampLensSourceLayers(owner: StampPaintGpuOwner, { stage, lens, sources }: { stage: StampStage; lens: LensCompositor; sources: ReadonlyMap<string, StampLensSource> }): StampLensSourceLayers {
  const { width, height, margin, frame } = stage;
  const threes = new Map<string, StampThreeLensSource>(), pictureSources = new Map<string, StampPictureLensSource>();
  for (const [id, source] of sources) {
    if (source.kind === 'three') threes.set(id, source);
    else pictureSources.set(id, source);
  }
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  /** A scratch target of `layers` array layers, `w` × `h`, the owner's under `name`. */
  const scratch = (name: string, w: number, h: number, layers: number) => owner.target(name, { size: [w, h, layers], format: 'rgba16float', usage });

  /**
   * A three source's picture for the lens and its box in frame px: its colour alone when sharp and the frame isn't
   * `moving`, else with its motion layer, each texel defocused by `focus` at its own distance, at most twice the
   * aperture: else a point by the lens would blur the whole picture.
   */
  function threeLayer(encoder: GPUCommandEncoder, id: string, { look, focus, moving }: StampSourceLaying): LensLayer {
    const { texture, motion, at } = threes.get(id)!.picture, { width: w, height: h } = texture;
    // A source renders through the camera, its motion with it: only the lens's defocus is left to do. Still or not, a
    // gathered frame reads its texels' distances: its plane's would misplace what's in front.
    const laid = (picture: GPUTextureView, layers: LensPictureLayers): LensLayer => ({
      picture, layers, view: STAMP_REST_LOOK.view, shutter: null, origin: at, size: { w, h }, clipped: true, distance: look.distance, distances: moving ? 'texels' : 'layer',
    });
    const defocusing = focus !== null && focus.aperture >= LENS_DEFOCUS_LEAST;
    if (!defocusing && !moving) return laid(arrayView(texture), SOURCE_LAYERS);
    const both = scratch(`source ${id}`, w, h, 2);
    encoder.copyTextureToTexture({ texture }, { texture: both, origin: { x: 0, y: 0, z: 0 } }, [w, h, 1]);
    encoder.copyTextureToTexture({ texture: motion }, { texture: both, origin: { x: 0, y: 0, z: 1 } }, [w, h, 1]);
    const layers = moving ? SOURCE_MOTION_LAYERS : SOURCE_LAYERS;
    if (!defocusing) return laid(arrayView(both), layers);
    const defocused = scratch(`source ${id} defocused`, w, h, 2);
    lens.defocus(encoder, { source: arrayView(both), into: arrayView(defocused), size: { w, h }, focus, most: 2 * focus.aperture });
    return laid(arrayView(defocused), layers);
  }

  /**
   * Picture plane `id`'s picture laid by its `look`, defocused by it: blurred over the whole stage, clear past its
   * spread, so one target a plane holds its picture whatever its box.
   */
  function pictureLayer(encoder: GPUCommandEncoder, id: string, picture: StampLensPicture, look: StampPlaneLook): LensLayer {
    const laid = (view: GPUTextureView, box: StampStageTexels): LensLayer => ({
      picture: view, layers: SOURCE_LAYERS, view: look.view, shutter: look.shutter, origin: { x: box.x - margin, y: box.y - margin }, size: box, clipped: true,
      distance: look.distance, distances: 'layer',
    });
    // A plane's defocus is frame px: on its picture, it's that over the view's scale.
    const sigma = look.defocus && lensSigmaStepped(look.defocus / Math.hypot(look.view.ma, look.view.mb));
    if (!sigma) return laid(arrayView(picture.texture), picture.box);
    const blurred = scratch(`picture ${id} blurred`, width, height, 1), stageBox = { x: 0, y: 0, w: width, h: height };
    lens.gaussian(encoder, { source: arrayView(picture.texture), into: arrayView(blurred), layers: 1, sigma, read: picture.box, sourceAt: picture.box, box: stageBox });
    return laid(arrayView(blurred), stageBox);
  }

  /** Refuses a back picture that leaves some of the frame clear where `look` lays it. */
  function checkBackCovers(id: string, { box }: StampLensPicture | { box: null }, { view }: StampPlaneLook) {
    const { ma, mb, kx, ky } = view, scale = ma * ma + mb * mb;
    const corners = [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]].map(([x, y]) => ({ x: (ma * (x - kx) + mb * (y - ky)) / scale, y: (ma * (y - ky) - mb * (x - kx)) / scale }));
    const covered = box && corners.every(({ x, y }) => x >= box.x - margin && y >= box.y - margin && x <= box.x - margin + box.w && y <= box.y - margin + box.h);
    if (!covered) throw new Error(`stamp paint: the back, picture plane ${id}, must show wherever the frame does; it leaves the frame's corners at ${corners.map(({ x, y }) => `(${x.toFixed(0)}, ${y.toFixed(0)})`).join(', ')} clear`);
  }

  return {
    // One after another: each may render on the device the next does.
    render: (t, exposure) => [...sources].reduce<Promise<{ moved: Set<string>; pictures: Map<string, StampLensPicture | null> }>>(async (prior, [id, source]) => {
      const renders = await prior;
      if (source.kind === 'three') {
        if ((await source.render(t, exposure)).moved) renders.moved.add(id);
        return renders;
      }
      const picture = await source.render(t, exposure);
      if (picture) checkStampLensPicture(id, picture, stage);
      renders.pictures.set(id, picture);
      return renders;
    }, Promise.resolve({ moved: new Set(), pictures: new Map() })),
    layer: (encoder, plane, renders, laying) => {
      if (plane.kind === 'three') return [threeLayer(encoder, plane.id, laying)];
      const picture = renders.pictures.get(plane.id) ?? null;
      if (laying.back) checkBackCovers(plane.id, picture ?? { box: null }, laying.look);
      return picture ? [pictureLayer(encoder, plane.id, picture, laying.look)] : [];
    },
  };
}
