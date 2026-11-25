// shot-sheets-lay.ts: a painted plane's selection laid at one moment onto its painting: its ground, then each
// composite step through its lattice (shot-sheet-lays.ts), back to front. A film is laid where its rest map reads it;
// a card, its paper over its films' union; a pieces rig's render, as paint by its alpha. Each card and rig
// casts a shadow before it and shows a rim once its films are laid (stamp-card-relief-pass.ts), within its fade.
// stamp-span-fade-pass.ts mixes a faded span back. Reveals cut a film; masks, all but the ground.
//
// Everything lies through rest maps, so the plane's place, its nodes and a frame moment's poses are one path; at rest
// a lattice is one exact cell.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { stampCardReliefSteps, type StampCardReliefStepIn } from '#lib/paint/painting/models/stamp-card-relief.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import type { StampFilmRevealLinks } from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampBoxUnion, stampStageTexelsOf, stampStageTexelsWithin, stampStageWgsl, type StampStage, type StampWrapPeriods } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLatticePass, STAMP_LATTICE_VERTEX_FLOATS, type StampLatticePass, type StampLatticeSpan } from '#lib/paint/painting/studio/stamp-lattice-pass.ts';
import { createStampCardRelief } from '#lib/paint/painting/studio/stamp-card-relief-pass.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from '#lib/paint/painting/studio/stamp-paint-compositor.ts';
import { copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampPaintSamplers } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampGpuCacheStore } from '#lib/paint/painting/studio/stamp-paint-gpu-cache.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampPaintBacking } from '#lib/paint/painting/studio/stamp-paint-lay-pass.ts';
import { createStampPlaneGlows } from '#lib/paint/painting/studio/stamp-plane-glow-pass.ts';
import { createStampRevealPass } from '#lib/paint/painting/studio/stamp-reveal-pass.ts';
import { stampPlainFaded, type StampFadedTarget, type StampSpanFade, type StampSpanKept } from '#lib/paint/painting/studio/stamp-span-fade-pass.ts';
import { stampCardCover, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { keptStampSheetFilm, type StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { ShotLattice } from '../models/shot-lattice.ts';
import type { OccurrenceKey } from '../models/shot-props.ts';
import { shotStepLatticed, type ShotFadeSpan, type ShotGroundLay, type ShotMaskAt, type ShotPlaneRead, type ShotStepFrame } from '../models/shot-sheet-lays.ts';
import { createShotMaskPasses, type ShotCoverStep, type ShotMaskCoverage } from './shot-mask-passes.ts';

/** A rig's pieces as drawn this moment, stage-sized: their premultiplied linear colour, their motion, and the stage texels they cover. */
export type ShotPiecesDrawn = { readonly colour: GPUTextureView; readonly motion: GPUTextureView; readonly box: StampPixelBox };

/**
 * What a plane lays at one moment: its document's size and wrap periods, its sheets' lays, each sheet's kept films and
 * their reveals, its steps (null: nothing laid), its ground (the stage's paper where the plane lies at rest, its paper
 * through a lattice, or none), its fades, outermost first, each pieces rig's render, and its masks and reads.
 */
export type ShotSheetsLayFrame = {
  readonly document: { readonly width: number; readonly height: number; readonly periods: StampWrapPeriods };
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly reveals: readonly StampFilmRevealLinks[];
  readonly steps: readonly (ShotStepFrame | null)[];
  readonly ground: ShotGroundLay;
  readonly fades: readonly ShotFadeSpan[];
  readonly pieces: ReadonlyMap<string, ShotPiecesDrawn>;
  readonly masks: readonly ShotMaskAt[];
  readonly reads: readonly ShotPlaneRead[];
  /** The shot's light, in plane px, so a card turning keeps it where the world has it. */
  readonly light: PaintLight;
};

/** A frame's alphaOf mask as its lay multiplies it in: its drawable's coverage (null: it covers nothing). */
type ShotMaskStaged = { readonly coverage: ShotMaskCoverage | null; readonly invert: boolean };

/** Where a frame's lattices lie in their passes' vertices: the ground's, then each step's (null for none); and its masks. */
export type ShotSheetsStaged = {
  readonly ground: ShotStagedLattice | null;
  readonly steps: readonly (ShotStagedLattice | null)[];
  readonly masks: readonly ShotMaskStaged[];
};
type ShotStagedLattice = { readonly pass: StampLatticePass; readonly span: StampLatticeSpan; readonly box: StampPixelBox | null };

/**
 * Where a lay goes: the painting (texture and storage view), the plane's emission on the lay that glows (paper or
 * black), its motion when traced, its mask (shotSheetsLayer's `mask`; null for none), and where the frame's reads
 * gather (shotSheetsLayer's `coverageTarget`) on the lay that traces (null on the black lay, or for no reads).
 */
export type ShotSheetsLayInto = {
  readonly painting: StampFadedTarget;
  readonly backing: StampPaintBacking;
  readonly emission: GPUTexture | null;
  readonly motion: GPUTexture | null;
  readonly mask: GPUTexture | null;
  readonly coverage: GPUTexture | null;
};

const SHOT_PIECES_LAY = gpuUniformLayout('PiecesLay', [['origin', 'vec2u'], ['extent', 'vec2u']]);
// A rig's render laid as paint by its alpha (layPicture); its motion (premultiplied by cover, as three's blending
// wrote it) over the plane's by alpha. Its distance isn't the plane's: kept out. Masked, all it lays is taken times
// the mask, as a premultiplied picture fades.
const piecesLayWgsl = (compositor: StampPaintCompositor, stage: StampStage, traced: boolean, masked: boolean) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'read_write')}
${GPU_SRGB_WGSL}
${compositor.picture}
${SHOT_PIECES_LAY.wgsl}
@group(0) @binding(0) var<uniform> u: PiecesLay;
@group(0) @binding(1) var pieces: texture_2d<f32>;
${traced ? `@group(0) @binding(3) var piecesMotion: texture_2d<f32>;
@group(0) @binding(4) var motion: texture_storage_2d<rgba16float, read_write>;` : ''}
${masked ? '@group(0) @binding(5) var mask: texture_2d<f32>;' : ''}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn piecesLay(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let m = ${masked ? 'textureLoad(mask, pixel, 0).r' : '1.0'};
  let c = textureLoad(pieces, pixel, 0) * m;
  let a = clamp(c.a, 0.0, 1.0);
  if (a <= 0.0) { return; }${traced ? `
  let was = textureLoad(motion, pixel);
  let moved = textureLoad(piecesMotion, pixel, 0) * m;
  textureStore(motion, pixel, vec4f(was.xy * (1.0 - a) + moved.xy, was.z * (1.0 - a), was.w * (1.0 - a) + moved.w));` : ''}
  layPicture(pixel, max(c.rgb, vec3f(0.0)), a);
}`;

/** The relief over `frame`'s steps: each card and pieces rig catching the light as its sheet's look says. */
const shotCardReliefSteps = ({ steps }: ShotSheetsLayFrame) => stampCardReliefSteps(steps.map((step): StampCardReliefStepIn | null => {
  if (!step) return null;
  const { lay } = step;
  if (lay.kind === 'card') return { kind: 'card', sheet: lay.sheet, look: lay.look };
  if (lay.kind === 'pieces') return { kind: 'pieces', look: lay.look };
  return lay.kind === 'rim' ? lay : { kind: 'other' };
}));

/** What tells layer targets apart for one stage: plain, or an array of how many layers. */
const layerTargetKind = (shape: StampPaintTarget) => (shape.kind === 'array' ? `array ${shape.layers}` : 'plain');

/** The vertices `lattice` takes in a lattice pass. */
const latticeFloats = ({ triangles }: ShotLattice) => (triangles.length / 4) * STAMP_LATTICE_VERTEX_FLOATS;

/** A layer target's note: the texels its last film was copied over, cleared before the next; null for none yet. */
type ShotLayerTargetNote = { written: StampPixelBox | null };

/** An owner's layer targets, and the zeros that clear them, by size and layer count. */
type ShotLayerTargetStores = { readonly layers: StampGpuCacheStore<ShotLayerTargetNote>; readonly zeros: StampGpuCacheStore<null> };

const layerTargetStores = new WeakMap<StampPaintGpuOwner, ShotLayerTargetStores>();

/**
 * `owner`'s layer targets, made the first time they're asked for. Not the owner's `target`s, which any pass taking
 * the role may write: a layer target clears only what it last wrote, and its zeros are never written. Its note lives
 * and dies with it, so one given up and made again starts zeroed, with nothing to clear.
 */
function shotLayerTargetStores(owner: StampPaintGpuOwner): ShotLayerTargetStores {
  let stores = layerTargetStores.get(owner);
  if (!stores) layerTargetStores.set(owner, (stores = { layers: owner.cache.store('target'), zeros: owner.cache.store('target') }));
  return stores;
}

/** Lays of painted planes on `owner`'s device onto `stage`, each pass's uniform from `arena`, fading through `fade`. */
export function createShotSheetsLayer(owner: StampPaintGpuOwner, { stage, arena, fade }: { stage: StampStage; arena: StampUniformArena; fade: StampSpanFade }) {
  const { device } = owner, { margin } = stage, linearClamp = stampPaintSamplers(device).linearClamp, masking = createShotMaskPasses(owner, { stage, arena });
  const revealing = createStampRevealPass(owner, device, stage), glows = createStampPlaneGlows(owner, { stage, arena }), carding = createStampCardRelief(owner, { stage, arena });
  const passes = new Map<string, StampLatticePass>();
  const passOf = (shape: StampPaintTarget) => {
    const key = layerTargetKind(shape);
    let pass = passes.get(key);
    if (!pass) passes.set(key, (pass = createStampLatticePass(device, { layer: shape, stage, sampler: linearClamp })));
    return pass;
  };
  const rest = (encoder: GPUCommandEncoder) => owner.target('shot rest', {
    size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  }, encoder).createView();
  /** Where a moving card's lattice draws its travel, cleared by each draw. */
  const cardTravel = (encoder: GPUCommandEncoder) => owner.target('shot card travel', {
    size: [stage.width, stage.height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  }, encoder).createView();
  /** The size of the layer target a frame's films are copied into and cut over: its document a margin in, or the stage. */
  const layerSize = ({ document }: ShotSheetsLayFrame) =>
    ({ width: Math.max(stage.width, document.width + 2 * margin), height: Math.max(stage.height, document.height + 2 * margin) });
  const layerTargets = shotLayerTargetStores(owner);
  /** The layer target a sheet of `shape` copies `frame`'s films into (layerSize), for `encoder`'s work, and its note. */
  const layerOf = (encoder: GPUCommandEncoder, shape: StampPaintTarget, frame: ShotSheetsLayFrame) => {
    const { width: w, height: h } = layerSize(frame), layers = shape.kind === 'array' ? shape.layers : 1, key = `${w}x${h}x${layers}`;
    const usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING;
    const { textures: [texture], note } = layerTargets.layers.find(key, encoder)
      ?? layerTargets.layers.make(key, encoder, [{ width: w, height: h, layers, format: 'rgba16float', usage }], { written: null });
    return { texture, note };
  };
  /** The largest box cleared yet by layer count: one zeros target a count, grown to it, clears a box of any layer target. */
  const zerosReach = new Map<number, { w: number; h: number }>();
  /** Clears `box` of `layer` for `encoder`'s work. */
  const clearLayerBox = (encoder: GPUCommandEncoder, layer: GPUTexture, box: StampPixelBox) => {
    const layers = layer.depthOrArrayLayers, reach = zerosReach.get(layers), w = Math.max(reach?.w ?? 0, box.w), h = Math.max(reach?.h ?? 0, box.h), key = `${w}x${h}x${layers}`;
    zerosReach.set(layers, { w, h });
    // Never written: WebGPU makes a texture zeroed.
    const [zeros] = (layerTargets.zeros.find(key, encoder)
      ?? layerTargets.zeros.make(key, encoder, [{ width: w, height: h, layers, format: 'rgba16float', usage: GPUTextureUsage.COPY_SRC }], null)).textures;
    copyStampTextureBox(encoder, { texture: zeros, x: 0, y: 0 }, { texture: layer, x: box.x, y: box.y }, box);
  };
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });

  /** Stages `lattice` in its sheet's pass: its span and the stage texels it reaches. */
  function stageLattice(shape: StampPaintTarget, lattice: ShotLattice): ShotStagedLattice {
    const pass = passOf(shape), { travel } = lattice;
    const { span, reach } = pass.add(lattice.triangles, travel ? (_, v) => ({ x: travel[2 * v], y: travel[2 * v + 1] }) : undefined);
    return { pass, span, box: stampStageTexelsWithin(stage, reach.x0, reach.y0, reach.x1, reach.y1) };
  }

  /**
   * Copies `film` into its layer target a margin in, clearing what the last copy left: the layer as a lay reads it,
   * the texels its paint lies over and the target's size.
   */
  function copyFilm(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, sheet: number, film: StampSheetFilmKept) {
    const kept = keptStampSheetFilm(owner, film, encoder);
    if (!kept || !film.box) return null;
    const shape = frame.lays.compositors[sheet].targets.layer, { texture: target, note } = layerOf(encoder, shape, frame);
    if (note.written) clearLayerBox(encoder, target, note.written);
    const at = stampStageTexelsOf(stage, film.box);
    copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: target, x: at.x, y: at.y }, at);
    note.written = at;
    return { view: target.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' }), at };
  }

  /** Sheet `sheet`'s film `film` cut by its reveals over `at`, texels of its layer target; null for one nothing cuts. */
  const cutOf = (encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, sheet: number, film: number, at: StampPixelBox) =>
    revealing.cut(encoder, arena, { links: frame.reveals[sheet][film] ?? [], box: at, size: layerSize(frame), periods: frame.document.periods });

  /** Lays a rig's render as paint, and over the plane's motion when traced, taken times `mask` when given. */
  function layPieces(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, drawn: ShotPiecesDrawn, motion: GPUTexture | null, mask: GPUTexture | null) {
    const traced = motion !== null, { box } = drawn;
    const pipeline = pipelineOf(piecesLayWgsl(compositor, stage, traced, mask !== null));
    dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
      const put = gpuUniformWriter(SHOT_PIECES_LAY, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
    }), drawn.colour, painting, motion && drawn.motion, motion?.createView() ?? null, mask?.createView() ?? null], box.w, box.h);
  }

  /** Lays step `index`'s cover (`step`) over the coverage `into` gathers of each read drawable it lays. */
  function gather(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, into: ShotSheetsLayInto, index: number, step: ShotCoverStep) {
    if (into.coverage) masking.cover(encoder, into.coverage, frame.reads.map((read) => read.steps.has(index)), step, into.mask);
  }

  return {
    /**
     * Starts a frame whose planes lay `frames`: room in every pass for all their lattices, each laid once. The frame
     * before was submitted, so what its reveals' arrival maps were drawn from goes.
     */
    reserve(frames: readonly Omit<ShotSheetsLayFrame, 'pieces'>[]) {
      const floats = new Map<StampLatticePass, number>();
      const room = (shape: StampPaintTarget, lattice: ShotLattice) => floats.set(passOf(shape), (floats.get(passOf(shape)) ?? 0) + latticeFloats(lattice));
      for (const frame of frames) {
        if (frame.ground?.kind === 'placed') room(frame.lays.compositors[0].targets.layer, frame.ground.lattice);
        for (const step of frame.steps) if (step && shotStepLatticed(step.lay)) room(frame.lays.compositors[step.lay.sheet].targets.layer, step.lay.lattice);
      }
      for (const pass of passes.values()) pass.reset(floats.get(pass) ?? 0);
      revealing.release();
    },
    /**
     * Stages `frame`'s lattices, once for every backing it's laid on, and its masks, each alphaOf mask reading what
     * `coverageOf` gives of its drawable.
     */
    stage(frame: ShotSheetsLayFrame, coverageOf: (drawable: OccurrenceKey) => ShotMaskCoverage | null): ShotSheetsStaged {
      const groundShape = frame.lays.compositors[0].targets.layer, ground = frame.ground?.kind === 'placed' ? stageLattice(groundShape, frame.ground.lattice) : null;
      return {
        ground,
        steps: frame.steps.map((step) => (step && shotStepLatticed(step.lay) ? stageLattice(frame.lays.compositors[step.lay.sheet].targets.layer, step.lay.lattice) : null)),
        masks: frame.masks.map((mask): ShotMaskStaged => ({ coverage: coverageOf(mask.drawable), invert: mask.invert })),
      };
    },
    /**
     * A frame's `masks` multiplied into one over the stage; null for a plane with none. Laid before the frame, as it's
     * laid on every backing alike.
     */
    mask(encoder: GPUCommandEncoder, { masks }: ShotSheetsStaged): GPUTexture | null {
      if (!masks.length) return null;
      const mask = masking.begin(encoder);
      for (const { coverage, invert } of masks) masking.coverage(encoder, mask, coverage, invert);
      return mask;
    },
    /** Where `frame`'s reads gather as `encoder`'s work lays it; null for none. */
    coverageTarget(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame): GPUTexture | null {
      return frame.reads.length ? masking.coverageTarget(encoder, frame.reads.length) : null;
    },
    /**
     * Lays `frame` (its lattices `staged`) into `into`, its ground first over the backing, each glowing film adding
     * the light it lays over what's under it to the emission when given. Returns the stage texels its paint and
     * paper were laid over; null for none.
     */
    lay(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, staged: ShotSheetsStaged, into: ShotSheetsLayInto): StampPixelBox | null {
      const { lays: { lays, compositors }, films } = frame, painting = into.painting.view, restView = rest(encoder), { mask } = into;
      const motion = into.motion, traced = motion?.createView() ?? null, { coverage } = into, emission = into.emission?.createView() ?? null;
      lays[0].drawPaper(encoder, painting, into.backing, stage.width, stage.height);
      // The back's paper shows wherever the frame does, whatever its ground's lattice reaches.
      const whole = into.backing === 'paper' || frame.ground?.kind === 'stage';
      if (coverage) masking.startCoverage(encoder, coverage, frame.reads.map((read) => read.ground && whole));
      let laid: StampPixelBox | null = frame.ground?.kind === 'stage' ? { x: 0, y: 0, w: stage.width, h: stage.height } : null;
      if (staged.ground?.box) {
        const { pass, span, box } = staged.ground;
        pass.draw(encoder, span, { rest: 'region', motion: traced ? 'over' : null }, { rest: restView, motion: traced, source: null });
        lays[0].drawPlacedPaper(encoder, painting, restView, box);
        if (coverage && !whole) masking.cover(encoder, coverage, frame.reads.map((read) => read.ground), { kind: 'ground', rest: restView, box }, null);
        laid = stampBoxUnion(laid, box);
      }
      const gathered: StampFadedTarget[] = coverage ? [{ texture: coverage, shape: { kind: 'array', layers: coverage.depthOrArrayLayers }, view: coverage.createView({ dimension: '2d-array' }) }] : [];
      const fadeTargets = [into.painting, ...[into.emission, into.motion].flatMap((texture) => (texture ? [stampPlainFaded(texture)] : [])), ...gathered];
      const open: { span: ShotFadeSpan; kept: StampSpanKept }[] = [];
      const lit = shotCardReliefSteps(frame), { light } = frame, maskView = mask?.createView() ?? null;
      carding.begin();
      // Each sheet's tone as its card was laid, for its rim to shade the face with once its films are on.
      const tones = new Map<number, number>();
      frame.steps.forEach((step, index) => {
        for (const span of frame.fades) if (span.first === index) open.push({ span, kept: fade.keep(encoder, fadeTargets, open.length) });
        const staging = staged.steps[index], lighting = lit[index];
        if (step && step.lay.kind === 'rim') {
          if (lighting?.kind === 'rim') carding.rim(encoder, lighting.level, { compositor: compositors[step.lay.sheet], painting, light }, tones.get(step.lay.sheet));
        } else if (step && step.lay.kind === 'pieces') {
          const drawn = frame.pieces.get(step.lay.rig);
          if (drawn) {
            const onto = { compositor: compositors[0], painting, light };
            const shadow = lighting?.kind === 'cast' ? carding.cast(encoder, lighting, { kind: 'picture', picture: drawn.colour, box: drawn.box, mask: maskView }, onto) : null;
            layPieces(encoder, compositors[0], painting, drawn, motion, mask);
            if (lighting?.kind === 'cast' && lighting.rim === 'now') carding.rim(encoder, lighting.level, onto);
            gather(encoder, frame, into, index, { kind: 'pieces', pieces: drawn.colour, box: drawn.box });
            laid = stampBoxUnion(stampBoxUnion(laid, drawn.box), shadow);
          }
        } else if (step && shotStepLatticed(step.lay) && staging?.box) {
          const lay = step.lay, { pass, span, box } = staging, compositor = compositors[lay.sheet];
          if (lay.kind === 'card') {
            tones.set(lay.sheet, Math.min(1, lay.shade));
            const edge = stampCardCover(owner, device, encoder, arena, lay.cardEdge, lay.films.map(({ film, shown }) => ({ film: films[lay.sheet][film], shown })), {
              reveals: lay.films.map(({ film }) => frame.reveals[lay.sheet][film] ?? []), pass: revealing, stage, size: layerSize(frame), periods: frame.document.periods,
            });
            if (edge) {
              const edgeBox = stampStageTexelsOf(stage, edge.box);
              // The lattice covers the card's edge box, ground beside its cut included: its travel goes to a map the
              // card lays by its own cover.
              const moving = traced && { travel: cardTravel(encoder), into: traced };
              pass.draw(encoder, span, { rest: 'region', motion: moving ? 'fresh' : null }, { rest: restView, motion: moving ? moving.travel : null, source: null });
              const caster = { kind: 'card', edge: edge.view, edgeBox, rest: restView, box, mask: maskView } as const;
              const shadow = lighting?.kind === 'cast' ? carding.cast(encoder, lighting, caster, { compositor, painting, light }) : null;
              lays[lay.sheet].layCard(encoder, { edge: edge.view, edgeBox, painting, box, rest: restView, mask: maskView, motion: moving || null });
              gather(encoder, frame, into, index, { kind: 'card', edge: edge.view, edgeBox, rest: restView, box });
              laid = stampBoxUnion(stampBoxUnion(laid, box), shadow);
            }
          } else if (step.opacity > 0) {
            const copied = copyFilm(encoder, frame, lay.sheet, films[lay.sheet][lay.film]);
            if (copied) {
              const { view: layer } = copied, reveal = cutOf(encoder, frame, lay.sheet, lay.film, copied.at);
              pass.draw(encoder, span, { rest: 'paint', motion: traced ? 'over' : null }, { rest: restView, motion: traced, source: layer });
              glows.layAdding(encoder, step.glow && emission ? { compositor, painting, box, emission, glow: step.glow } : null, () => lays[lay.sheet].layGroup(encoder, {
                layer, painting, index: lay.film, opacity: step.opacity, glaze: true, box, backing: into.backing, rest: restView, paperFromRest: true, mask: maskView, reveal,
              }));
              gather(encoder, frame, into, index, { kind: 'film', compositor, layer, rest: restView, reveal, opacity: step.opacity, box });
              laid = stampBoxUnion(laid, box);
            }
          }
        }
        // Inner spans close first: they were opened last.
        while (open.length && open.at(-1)!.span.last === index) {
          const { span, kept } = open.pop()!;
          fade.mix(encoder, kept, span.visibility, { x: 0, y: 0, w: stage.width, h: stage.height });
        }
      });
      return laid;
    },
    /** Uploads the frame's lattices: before its encoder is submitted. */
    flush() {
      for (const pass of passes.values()) pass.flush();
    },
  };
}

export type ShotSheetsLayer = ReturnType<typeof createShotSheetsLayer>;
