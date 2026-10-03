// shot-sheets-lay.ts: a painted plane's selection laid at one moment onto its painting (ENGINE 5.4, 6.1 step 6), on
// the GPU: its ground, then each composite step through its lattice (shot-sheet-lays.ts), back to front. A film is
// copied into a layer target a margin in and laid where its lattice's rest map reads it; a card lays its sheet's
// paper over its edge alike; a pieces rig's render lays as paint by its alpha (ENGINE 6.5).
//
// Everything lies through rest maps, so the plane's place, its nodes and a frame moment's poses are one path; at rest
// a lattice is one exact cell.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import type { StampGroupGlow } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampBoxUnion, stampStageTexelsOf, stampStageTexelsWithin, stampStageWgsl, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampLatticePass, STAMP_LATTICE_VERTEX_FLOATS, type StampLatticePass, type StampLatticeSpan } from '#lib/paint/painting/studio/stamp-lattice-pass.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from '#lib/paint/painting/studio/stamp-paint-compositor.ts';
import { copyStampTextureBox, dispatchStampCompute, STAMP_WORKGROUP, stampPaintSamplers } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { STAMP_NO_REST, type StampPaintBacking } from '#lib/paint/painting/studio/stamp-paint-lay-pass.ts';
import { STAMP_GLOW_SOURCE, stampGlowSourceWgsl } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import { stampSheetEdge, type StampSheetsLays } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { keptStampSheetFilm, type StampSheetFilmKept } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { ShotLattice } from '../models/shot-lattice.ts';
import type { ShotFadeSpan, ShotGroundLay, ShotStepFrame } from '../models/shot-sheet-lays.ts';
import { shotPlainFaded, type ShotFadedTarget, type ShotGroupFade, type ShotGroupKept } from './shot-group-pass.ts';

/** A rig's pieces as drawn this moment, stage-sized: their premultiplied linear colour, their motion, and the stage texels they cover. */
export type ShotPiecesDrawn = { readonly colour: GPUTextureView; readonly motion: GPUTextureView; readonly box: StampPixelBox };

/**
 * What a plane lays at one moment: its document's size, its sheets' lays, each sheet's kept films, its steps (null:
 * nothing laid), its ground (the stage's paper where the plane lies at rest, its paper through a lattice, or none),
 * its fades, outermost first, and each pieces rig's render by its occurrence.
 */
export type ShotSheetsLayFrame = {
  readonly document: { readonly width: number; readonly height: number };
  readonly lays: StampSheetsLays;
  readonly films: readonly (readonly StampSheetFilmKept[])[];
  readonly steps: readonly (ShotStepFrame | null)[];
  readonly ground: ShotGroundLay;
  readonly fades: readonly ShotFadeSpan[];
  readonly pieces: ReadonlyMap<string, ShotPiecesDrawn>;
};

/** Where a frame's lattices lie in their passes' vertices: the ground's, then each step's (null for none). */
export type ShotSheetsStaged = { readonly ground: ShotStagedLattice | null; readonly steps: readonly (ShotStagedLattice | null)[] };
type ShotStagedLattice = { readonly pass: StampLatticePass; readonly span: StampLatticeSpan; readonly box: StampPixelBox | null };

/** Where a lay goes: the painting (its texture and storage view), and the plane's emission and motion when traced. */
export type ShotSheetsLayInto = {
  readonly painting: ShotFadedTarget;
  readonly backing: StampPaintBacking;
  readonly emission: GPUTexture | null;
  readonly motion: GPUTexture | null;
};

const SHOT_PIECES_LAY = gpuUniformLayout('PiecesLay', [['origin', 'vec2u'], ['extent', 'vec2u']]);
// A rig's render laid as paint by its alpha (layPicture); its motion (premultiplied by cover, as three's blending
// wrote it) over the plane's by alpha. Its distance isn't the plane's: kept out.
const piecesLayWgsl = (compositor: StampPaintCompositor, stage: StampStage, traced: boolean) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'read_write')}
${GPU_SRGB_WGSL}
${compositor.picture}
${SHOT_PIECES_LAY.wgsl}
@group(0) @binding(0) var<uniform> u: PiecesLay;
@group(0) @binding(1) var pieces: texture_2d<f32>;
${traced ? `@group(0) @binding(3) var piecesMotion: texture_2d<f32>;
@group(0) @binding(4) var motion: texture_storage_2d<rgba16float, read_write>;` : ''}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn piecesLay(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let c = textureLoad(pieces, pixel, 0);
  let a = clamp(c.a, 0.0, 1.0);
  if (a <= 0.0) { return; }${traced ? `
  let was = textureLoad(motion, pixel);
  let moved = textureLoad(piecesMotion, pixel, 0);
  textureStore(motion, pixel, vec4f(was.xy * (1.0 - a) + moved.xy, was.z * (1.0 - a), was.w * (1.0 - a) + moved.w));` : ''}
  layPicture(pixel, max(c.rgb, vec3f(0.0)), a);
}`;

/** What tells layer targets apart for one stage: plain, or an array of how many layers. */
const layerTargetKind = (shape: StampPaintTarget) => (shape.kind === 'array' ? `array ${shape.layers}` : 'plain');

/** The vertices `lattice` takes in a lattice pass. */
const latticeFloats = ({ triangles }: ShotLattice) => (triangles.length / 4) * STAMP_LATTICE_VERTEX_FLOATS;

/** Lays of painted planes on `owner`'s device onto `stage`, each pass's uniform from `arena`, fading through `fade`. */
export function createShotSheetsLayer(owner: StampPaintGpuOwner, { stage, arena, fade }: { stage: StampStage; arena: StampUniformArena; fade: ShotGroupFade }) {
  const { device } = owner, { margin } = stage, linearClamp = stampPaintSamplers(device).linearClamp;
  const passes = new Map<string, StampLatticePass>();
  const passOf = (shape: StampPaintTarget) => {
    const key = layerTargetKind(shape);
    let pass = passes.get(key);
    if (!pass) passes.set(key, (pass = createStampLatticePass(device, { layer: shape, stage, sampler: linearClamp })));
    return pass;
  };
  const rest = () => owner.target('shot rest', { size: [stage.width, stage.height], format: 'rg32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }).createView();
  /**
   * The layer target a sheet of `shape` copies its films into, a margin in, big enough for `width` × `height`
   * document px past the stage; and its texels last written, cleared before the next film is copied in.
   */
  const layers = new Map<string, { texture: GPUTexture; zeros: GPUTexture; written: StampPixelBox | null }>();
  const layerOf = (shape: StampPaintTarget, width: number, height: number) => {
    const w = Math.max(stage.width, width + 2 * margin), h = Math.max(stage.height, height + 2 * margin), count = shape.kind === 'array' ? shape.layers : 1;
    const key = `${layerTargetKind(shape)}|${w}|${h}`;
    let held = layers.get(key);
    if (!held) {
      const size = [w, h, count], usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING;
      // `zeros` is never written: WebGPU makes a texture zeroed, and a copy of it clears a box of the layer.
      held = { texture: owner.target(`shot layer ${key}`, { size, format: 'rgba16float', usage }), zeros: owner.target(`shot layer zeros ${key}`, { size, format: 'rgba16float', usage }), written: null };
      layers.set(key, held);
    }
    return held;
  };
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });

  /** Stages `lattice` in its sheet's pass: its span and the stage texels it reaches. */
  function stageLattice(shape: StampPaintTarget, lattice: ShotLattice): ShotStagedLattice {
    const pass = passOf(shape), { travel } = lattice;
    const { span, reach } = pass.add(lattice.triangles, travel ? (_, v) => ({ x: travel[2 * v], y: travel[2 * v + 1] }) : undefined);
    return { pass, span, box: stampStageTexelsWithin(stage, reach.x0, reach.y0, reach.x1, reach.y1) };
  }

  /** Copies `film` into its layer target a margin in, clearing what the last copy left: the layer as a lay reads it. */
  function copyFilm(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, sheet: number, film: StampSheetFilmKept): GPUTextureView | null {
    const kept = keptStampSheetFilm(owner, film, encoder);
    if (!kept || !film.box) return null;
    const shape = frame.lays.compositors[sheet].targets.layer, target = layerOf(shape, frame.document.width, frame.document.height);
    if (target.written) copyStampTextureBox(encoder, { texture: target.zeros, x: 0, y: 0 }, { texture: target.texture, x: target.written.x, y: target.written.y }, target.written);
    const at = stampStageTexelsOf(stage, film.box);
    copyStampTextureBox(encoder, { texture: kept, x: 0, y: 0 }, { texture: target.texture, x: at.x, y: at.y }, at);
    target.written = at;
    return target.texture.createView({ dimension: shape.kind === 'array' ? '2d-array' : '2d' });
  }

  /** Adds a film's glow over `box`, read through its lattice's rest map, to the plane's emission. */
  function addGlow(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, emission: GPUTexture, layer: GPUTextureView, restView: GPUTextureView, glow: StampGroupGlow, opacity: number, box: StampPixelBox) {
    const pipeline = pipelineOf(stampGlowSourceWgsl(compositor, 'moved group', stage, STAMP_NO_REST, STAMP_WORKGROUP));
    dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
      const put = gpuUniformWriter(STAMP_GLOW_SOURCE, views);
      put('threshold', glow.threshold);
      put('strength', glow.amount * opacity);
      put('glaze', 1);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
    }), painting, emission.createView(), layer, restView], box.w, box.h);
  }

  /** Lays a rig's render as paint, and over the plane's motion when traced. */
  function layPieces(encoder: GPUCommandEncoder, compositor: StampPaintCompositor, painting: GPUTextureView, drawn: ShotPiecesDrawn, motion: GPUTexture | null) {
    const traced = motion !== null, { box } = drawn;
    const pipeline = pipelineOf(piecesLayWgsl(compositor, stage, traced));
    dispatchStampCompute(device, encoder, pipeline, [arena.slot((views) => {
      const put = gpuUniformWriter(SHOT_PIECES_LAY, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
    }), drawn.colour, painting, ...(motion ? [drawn.motion, motion.createView()] : [])], box.w, box.h);
  }

  return {
    /** Starts a frame whose planes lay `frames`: room in every pass for all their lattices, each laid once. */
    reserve(frames: readonly Omit<ShotSheetsLayFrame, 'pieces'>[]) {
      const floats = new Map<StampLatticePass, number>();
      const room = (shape: StampPaintTarget, lattice: ShotLattice) => floats.set(passOf(shape), (floats.get(passOf(shape)) ?? 0) + latticeFloats(lattice));
      for (const frame of frames) {
        const groundShape = frame.lays.compositors[0].targets.layer;
        if (frame.ground?.kind === 'placed') room(groundShape, frame.ground.lattice);
        for (const step of frame.steps) if (step && step.lay.kind !== 'pieces') room(frame.lays.compositors[step.lay.sheet].targets.layer, step.lay.lattice);
      }
      for (const pass of passes.values()) pass.reset(floats.get(pass) ?? 0);
    },
    /** Stages `frame`'s lattices, once for every backing it's laid on. */
    stage(frame: ShotSheetsLayFrame): ShotSheetsStaged {
      const ground = frame.ground?.kind === 'placed' ? stageLattice(frame.lays.compositors[0].targets.layer, frame.ground.lattice) : null;
      return { ground, steps: frame.steps.map((step) => (step && step.lay.kind !== 'pieces' ? stageLattice(frame.lays.compositors[step.lay.sheet].targets.layer, step.lay.lattice) : null)) };
    },
    /**
     * Lays `frame` (its lattices `staged`) into `into`, its ground first over the backing; on a measuring backing's
     * second lay (black), no glow or motion. Returns the stage texels its paint and paper were laid over; null for none.
     */
    lay(encoder: GPUCommandEncoder, frame: ShotSheetsLayFrame, staged: ShotSheetsStaged, into: ShotSheetsLayInto): StampPixelBox | null {
      const { lays: { lays, compositors }, films } = frame, painting = into.painting.view, restView = rest();
      const motion = into.motion, traced = motion?.createView() ?? null;
      lays[0].drawPaper(encoder, painting, into.backing, stage.width, stage.height);
      let laid: StampPixelBox | null = frame.ground?.kind === 'stage' ? { x: 0, y: 0, w: stage.width, h: stage.height } : null;
      if (staged.ground?.box) {
        const { pass, span, box } = staged.ground;
        pass.draw(encoder, span, { rest: 'region', motion: !!traced }, { rest: restView, motion: traced, source: null });
        lays[0].drawPlacedPaper(encoder, painting, restView, box);
        laid = stampBoxUnion(laid, box);
      }
      const fadeTargets = [into.painting, ...[into.emission, into.motion].flatMap((texture) => (texture ? [shotPlainFaded(texture)] : []))];
      const open: { span: ShotFadeSpan; kept: ShotGroupKept }[] = [];
      // A span at full visibility would mix back exactly what it laid: it's laid in place, nothing kept.
      const fading = frame.fades.filter(({ visibility }) => visibility < 1);
      frame.steps.forEach((step, index) => {
        for (const span of fading) if (span.first === index) open.push({ span, kept: fade.keep(encoder, fadeTargets, open.length) });
        const staging = staged.steps[index];
        if (step && step.lay.kind === 'pieces') {
          const drawn = frame.pieces.get(step.lay.rig);
          if (drawn) {
            layPieces(encoder, compositors[0], painting, drawn, motion);
            laid = stampBoxUnion(laid, drawn.box);
          }
        } else if (step && step.lay.kind !== 'pieces' && staging?.box) {
          const lay = step.lay, { pass, span, box } = staging, compositor = compositors[lay.sheet];
          if (lay.kind === 'card') {
            const edge = stampSheetEdge(owner, device, encoder, arena, films[lay.sheet]);
            if (edge) {
              pass.draw(encoder, span, { rest: 'region', motion: !!traced }, { rest: restView, motion: traced, source: null });
              lays[lay.sheet].layCard(encoder, { edge: edge.view, edgeBox: stampStageTexelsOf(stage, edge.box), painting, box, rest: restView });
              laid = stampBoxUnion(laid, box);
            }
          } else if (step.opacity > 0) {
            const layer = copyFilm(encoder, frame, lay.sheet, films[lay.sheet][lay.film]);
            if (layer) {
              pass.draw(encoder, span, { rest: 'paint', motion: !!traced }, { rest: restView, motion: traced, source: layer });
              lays[lay.sheet].layGroup(encoder, { layer, painting, index: lay.film, opacity: step.opacity, glaze: true, box, backing: into.backing, rest: restView, paperFromRest: true });
              if (step.glow && into.emission) addGlow(encoder, compositor, painting, into.emission, layer, restView, step.glow, step.opacity, box);
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
