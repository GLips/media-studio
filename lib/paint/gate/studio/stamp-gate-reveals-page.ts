// stamp-gate-reveals-page.ts: the gate page's reveals (stamp-gate-reveals.ts): its paintings drawn as stills on one
// surface, through the shot's renderer opaque and clear over HTML, and as a painted texture, each frame held to the
// twin of what its reveals show; and what the clock and the caches make of a reveal moving.

import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingSimilarityPose, type PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import { paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingEvaluation } from '#lib/paint/document/models/painting-source.ts';
import { paintingFilmPicture } from '#lib/paint/document/studio/painting-film-readback.ts';
import { solvePaintingSheets } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import { createStampPaintCostTally, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampPointBox } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { copyStampLayerForReadback, readStampLayerCopy } from '#lib/paint/painting/studio/stamp-layer-readback.ts';
import { drawStampSheetsStill, readStampSheetsPicture } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import { compileShotPaintedTextures } from '#lib/paint/shot/models/shot-painted-texture-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import { createShotCanvasElements } from '#lib/paint/shot/studio/shot-canvas.ts';
import { createShotPaintedTextures } from '#lib/paint/shot/studio/shot-painted-textures.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { stampGateFrameDifference, stampGateFramePasses, stampGateLaidShare, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  STAMP_GATE_FIELD_COLUMNS, STAMP_GATE_FIELD_SEEKS, STAMP_GATE_FIELDS, STAMP_GATE_INK, STAMP_GATE_INK_AT, STAMP_GATE_INK_RAMP, STAMP_GATE_INK_TEXELS, STAMP_GATE_NESTED_AT,
  STAMP_GATE_NESTED_HERON, STAMP_GATE_NESTED_MOVE, STAMP_GATE_REEDS_AT, STAMP_GATE_REVEAL_ENDS, STAMP_GATE_REVEAL_HIDDEN_FOOT, STAMP_GATE_REVEAL_HIDDEN_FOOT_AT, STAMP_GATE_REVEAL_IDS,
  STAMP_GATE_REVEALED_REEDS, STAMP_GATE_WRAPPED_AT, STAMP_GATE_WRAPPED_INK, STAMP_GATE_WRAPPED_TEXELS, stampGateFieldShownAt, stampGateInkShownAt, stampGateNestedClass,
  stampGateNestedPart, stampGateNestedShownAt, stampGateReedsShownAt, stampGateRevealedReedsShot, stampGateRevealShot, stampGateRevealSplit, stampGateRevealSplitHeld,
  stampGateRevealSplitText, stampGateTexelsChanged, stampGateWrappedShownAt, type StampGateRevealFrame, type StampGateRevealId,
} from '../models/stamp-gate-reveals.ts';
import { STAMP_GATE_WET_CONTACT, STAMP_GATE_FAR_SHALLOWS, STAMP_GATE_FOOT_BOX, stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { STAMP_GATE_SHOT_FPS } from '../models/stamp-gate-shots.ts';
import { stampGateCanvasBytes, stampGateRgb, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, stampGateSolvedText, withGateShotRenderer } from './stamp-gate-shot-frames.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

const { lo: LO, hi: HI } = STAMP_GATE_REVEAL_ENDS;

const differenceText = (d: StampGateFrameDifference) => `max ${d.max}, mean ${d.mean.toFixed(4)}`;
const rgbFrame = (rgba: Uint8ClampedArray, width: number, height: number): StampGateRevealFrame => ({ bytes: stampGateRgb(rgba), width, height, channels: 3 });

/** One still: an evaluation solved and laid at scene second `at`, posed by `poses`. */
type RevealStill = { readonly evaluation: PaintingEvaluation; readonly at: number; readonly poses?: PaintingPoses };

/** `stills` drawn in turn on one surface, so one device's caches serve them all: each frame, and what each cost. */
function revealStills(stills: readonly RevealStill[]): Promise<{ frames: StampGateRevealFrame[]; costs: StampPaintCosts[] }> {
  const { widthPx: width, heightPx: height } = stills[0].evaluation.document;
  return withGateSurface({ width, height }, stampGateSheetImageUrl, async (surface, frame) => {
    const tally = createStampPaintCostTally(), costs: StampPaintCosts[] = [];
    const frames = await gpuEachInTurn(stills, async ({ evaluation, at, poses }) => {
      const compiled = compilePaintingSelection(evaluation, stampGateSheetBrushOf);
      const { composite, release } = await solvePaintingSheets(surface.owner, compiled, { at, costs: tally, ...(poses && { poses }) });
      await drawStampSheetsStill(surface, composite);
      release();
      await surface.owner.device.queue.onSubmittedWorkDone();
      costs.push(tally.take());
      return rgbFrame(frame(), width, height);
    });
    return { frames, costs };
  });
}

const stillsAt = (evaluation: PaintingEvaluation, times: readonly number[], poses?: PaintingPoses): RevealStill[] => times.map((at) => ({ evaluation, at, ...(poses && { poses }) }));

/** `props`' frames at `times` through the shot's renderer, opaque, as RGB; and each frame's costs. */
async function revealShotFrames(props: PaintedShotProps, times: readonly number[]) {
  const { frames, costs } = await stampGateShotFrames(props, times), { width, height } = props.camera.stage.frame;
  return { frames: frames.map((rgba) => rgbFrame(rgba, width, height)), costs };
}

/** A clear back's frames, a glaze's two images (shot-canvas.ts), each premultiplied RGBA. */
type ClearBackFrames = { readonly colour: StampGateRevealFrame[]; readonly filter: StampGateRevealFrame[] };

/** `props`, a clear back, drawn over HTML at `times` through the shot's renderer into a glaze's colour and filter. */
async function clearBackFrames(props: PaintedShotProps, times: readonly number[]): Promise<ClearBackFrames> {
  const { shot, problems } = compilePaintedShot(props, [], STAMP_GATE_SHOT_FPS, { htmlBehind: true });
  if (!shot) throw paintingProblemsError('stamp gate reveal', problems);
  const { width, height } = shot.camera.stage.frame, canvas = createShotCanvasElements();
  const premultiplied = (rgba: Uint8ClampedArray): StampGateRevealFrame => {
    const bytes = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      for (let c = 0; c < 3; c++) bytes[i + c] = Math.round((rgba[i + c] * rgba[i + 3]) / 255);
      bytes[i + 3] = rgba[i + 3];
    }
    return { bytes, width, height, channels: 4 };
  };
  const drawn = await withGateShotRenderer(shot, [canvas], (renderer) => gpuEachInTurn(times, async (t) => {
    await renderer.draw(t, 'fast');
    await renderer.finish();
    return { colour: premultiplied(stampGateCanvasBytes(canvas.colour)), filter: premultiplied(stampGateCanvasBytes(canvas.filter)) };
  }));
  return { colour: drawn.map(({ colour }) => colour), filter: drawn.map(({ filter }) => filter) };
}

const LEVEL_WGSL = (level: number) => /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
@group(0) @binding(0) var painted: texture_2d<f32>;
@fragment fn copyLevel(@builtin(position) at: vec4f) -> @location(0) vec4f { return textureLoad(painted, vec2i(at.xy), ${level}); }`;

/** Mip `level` of `texture` (encoded, as its handle holds it) read back as RGB bytes. */
async function readTextureLevel(owner: StampPaintGpuOwner, texture: GPUTexture, level: number): Promise<StampGateRevealFrame> {
  const width = Math.max(1, texture.width >> level), height = Math.max(1, texture.height >> level), { device } = owner;
  const target = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  try {
    const copy = await owner.checked(`reading a painted texture's level ${level}`, () => {
      const module = device.createShaderModule({ code: LEVEL_WGSL(level) });
      const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, targets: [{ format: 'rgba16float' }] } });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, stampBindGroup(device, pipeline, [texture.createView()]));
      pass.draw(3);
      pass.end();
      const copied = copyStampLayerForReadback(device, encoder, target, { x: 0, y: 0, w: width, h: height });
      device.queue.submit([encoder.finish()]);
      return copied;
    });
    const { values } = await readStampLayerCopy(copy), bytes = new Uint8ClampedArray(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) bytes[i * 3 + c] = Math.round(255 * values[i * 4 + c]);
    return { bytes, width, height, channels: 3 };
  } finally {
    target.destroy();
  }
}

/**
 * The ink as a painted texture its size, brought to each of `times` and read at levels 0 and 1, and the ink unrevealed
 * as another, read at level 0 once drawn.
 */
async function inkTextureLevels(times: readonly number[]) {
  const ink = painting(STAMP_GATE_INK), whole = painting(STAMP_GATE_INK, { reveal: 'none' }), { widthPx, heightPx } = ink.document;
  const compiled = compileShotPaintedTextures([
    { id: 'ink', source: ({ at }) => layersOf(ink, ['ink'], { at }), widthPx, heightPx }, { id: 'whole', source: layersOf(whole, ['ink']), widthPx, heightPx },
  ]);
  if (!compiled.textures) throw new Error(`stamp gate: the ink's textures: ${compiled.problems.map(paintingProblemText).join('; ')}`);
  const owner = await createStampPaintGpuOwner(stampGateSheetImageUrl), textures = createShotPaintedTextures(owner, compiled.textures, { brushOf: stampGateSheetBrushOf });
  try {
    const [revealed, unrevealed] = textures.handles.map(({ texture }) => texture);
    const levels = await gpuEachInTurn(times, async (t) => {
      await textures.update(t);
      return { base: await readTextureLevel(owner, revealed, 0), half: await readTextureLevel(owner, revealed, 1) };
    });
    return { levels, whole: await readTextureLevel(owner, unrevealed, 0) };
  } finally {
    textures.dispose();
    owner.dispose();
  }
}

const shareText = (share: number) => share.toFixed(3);

/** How far `frame` lays at document texel `p` of what `whole` lays over `lo`, in linear light (stampGateLaidShare). */
const shareAt = (frame: StampGateRevealFrame, lo: StampGateRevealFrame, whole: StampGateRevealFrame, p: StampPoint) =>
  stampGateLaidShare(frame.bytes, whole.bytes, lo.bytes, frame, (q) => Math.floor(q.x) === Math.floor(p.x) && Math.floor(q.y) === Math.floor(p.y));

/** How many of `frame`'s texels lie where `within` holds. */
function texelsWhere({ width, height }: StampGateRevealFrame, within: (p: StampPoint) => boolean): number {
  let count = 0;
  for (let texel = 0; texel < width * height; texel++) if (within({ x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 })) count++;
  return count;
}

/**
 * A band across a wrapped sheet's seam: mid-reveal, held to its twin read round the seam, the band shown just past the
 * seam on the left and not yet ahead of its front.
 */
async function checkWrapSeam(): Promise<StampGateWashCheck> {
  const ink = painting(STAMP_GATE_WRAPPED_INK), t = STAMP_GATE_WRAPPED_AT, { pastSeam, ahead } = STAMP_GATE_WRAPPED_TEXELS;
  const { frames: [atLo, atMid, whole] } = await revealStills([...stillsAt(ink, [LO, t]), ...stillsAt(painting(STAMP_GATE_WRAPPED_INK, { revealed: false }), [HI])]);
  const split = stampGateRevealSplit(atMid, atLo.bytes, whole.bytes, stampGateWrappedShownAt(t), 1), past = shareAt(atMid, atLo, whole, pastSeam), early = shareAt(atMid, atLo, whole, ahead);
  return {
    id: 'reveal/strokes: wrap seam', passed: stampGateRevealSplitHeld(split) && past >= 0.97 && early <= 0.03,
    detail: `at ${t} s ${stampGateRevealSplitText(split)}; past the seam on the left the band shows ${shareText(past)} (1 wanted), ahead of its front ${shareText(early)} (0 wanted)`,
  };
}

/**
 * reveal/strokes: the ink at three times and fully revealed, held to its twin; round and flat caps; the crossing shown
 * by the first stroke to reach it; paint no stroke covers never shown; the first stroke's soft ramp falling from shown
 * to hidden behind its front; and a band across a wrapped sheet's seam.
 */
async function checkStrokes(): Promise<StampGateWashCheck[]> {
  const { early, mid, late } = STAMP_GATE_INK_AT, times = [early, mid, late, HI], ink = painting(STAMP_GATE_INK);
  const { frames: [atLo, ...drawn] } = await revealStills(stillsAt(ink, [LO, ...times]));
  const { frames: [whole] } = await revealStills(stillsAt(painting(STAMP_GATE_INK, { reveal: 'none' }), [HI]));
  const atHi = drawn[3], share = (frame: StampGateRevealFrame, p: StampPoint) => shareAt(frame, atLo, whole, p);
  const splits = times.map((t, i) => ({ t, split: stampGateRevealSplit(drawn[i], atLo.bytes, whole.bytes, stampGateInkShownAt(t), 1) }));
  const bare = stampGateTexelsChanged(atLo, Uint8Array.from({ length: atLo.bytes.length }, (_, i) => atLo.bytes[i % 3]));
  const { roundEnd, flatEnd, crossing, secondOnly, uncovered } = STAMP_GATE_INK_TEXELS, painted = (p: StampPoint) => stampGateTexelsChanged(whole, atLo.bytes, (q) => Math.floor(q.x) === p.x && Math.floor(q.y) === p.y) === 1;
  const ramp = Array.from({ length: STAMP_GATE_INK_RAMP.x1 - STAMP_GATE_INK_RAMP.x0 + 1 }, (_, i) => share(drawn[0], { x: STAMP_GATE_INK_RAMP.x0 + i, y: STAMP_GATE_INK_RAMP.y }));
  const rising = ramp.every((s, i) => i === 0 || s <= ramp[i - 1] + 0.03), within = ramp.filter((s) => s > 0.1 && s < 0.9).length;
  const hiSplit = splits[3].split;
  return [
    {
      id: 'reveal/strokes: twin', passed: splits.every(({ split }) => stampGateRevealSplitHeld(split)) && bare === 0,
      detail: `${splits.map(({ t, split }) => `at ${t} s ${stampGateRevealSplitText(split)}`).join('; ')}; all hidden, ${bare} texels off bare paper (0 wanted)`,
    },
    {
      id: 'reveal/strokes: caps', passed: painted(roundEnd) && painted(flatEnd) && share(atHi, roundEnd) >= 0.97 && share(atHi, flatEnd) <= 0.03,
      detail: `fully revealed, past the round end of the first stroke it shows ${shareText(share(atHi, roundEnd))} of its paint (1 wanted), past the flat end of the second ${shareText(share(atHi, flatEnd))} (0 wanted)`,
    },
    {
      id: 'reveal/strokes: crossing', passed: share(drawn[2], crossing) >= 0.97 && share(drawn[2], secondOnly) <= 0.03 && share(atHi, secondOnly) >= 0.97,
      detail: `at ${late} s the crossing shows ${shareText(share(drawn[2], crossing))} (the first stroke passed it, 1 wanted), the second stroke below it ${shareText(share(drawn[2], secondOnly))} (not yet reached, 0 wanted; ${shareText(share(atHi, secondOnly))} once it has)`,
    },
    {
      id: 'reveal/strokes: uncovered', passed: painted(uncovered) && share(atHi, uncovered) <= 0.03 && hiSplit.hidden > 0 && hiSplit.hiddenOff === 0,
      detail: `fully revealed, paint no stroke covers shows ${shareText(share(atHi, uncovered))} (0 wanted); ${hiSplit.hiddenOff} of ${hiSplit.hidden} texels no stroke covers off all-hidden`,
    },
    {
      id: 'reveal/strokes: soft ramp', passed: rising && ramp[0] >= 0.97 && ramp.at(-1)! <= 0.03 && within >= 8,
      detail: `at ${early} s along the first stroke from x ${STAMP_GATE_INK_RAMP.x0} to ${STAMP_GATE_INK_RAMP.x1}, it shows ${ramp.map(shareText).join(' ')}: ${rising ? 'falling' : 'not falling'} toward its front, ${within} texels part shown (8 at least wanted)`,
    },
    await checkWrapSeam(),
  ];
}

/**
 * reveal/fields: the flood, the moon and the petal as stills sought forward and back, each column held to its field's
 * twin; a frame sought back drawn as it was going forward, each step forward moving it, and nothing solved after the
 * first.
 */
async function checkFields(): Promise<StampGateWashCheck[]> {
  const { forward, back } = STAMP_GATE_FIELD_SEEKS, fields = painting(STAMP_GATE_FIELDS), times = [LO, ...forward, ...back];
  const { frames: [atLo, ...seen], costs } = await revealStills(stillsAt(fields, times));
  const { frames: [whole] } = await revealStills(stillsAt(painting(STAMP_GATE_FIELDS, { revealed: false }), [HI]));
  const columns = STAMP_GATE_FIELD_COLUMNS.map((column): StampGateWashCheck => {
    const splits = forward.map((t, i) => ({ t, split: stampGateRevealSplit(seen[i], atLo.bytes, whole.bytes, stampGateFieldShownAt(column, t), 1) }));
    return { id: `reveal/fields: ${column}`, passed: splits.every(({ split }) => stampGateRevealSplitHeld(split)), detail: splits.map(({ t, split }) => `at ${t} s ${stampGateRevealSplitText(split)}`).join('; ') };
  });
  const sought = back.map((t, i) => ({ t, d: stampGateFrameDifference(seen[forward.length + i].bytes, seen[forward.indexOf(t)].bytes) }));
  const moved = forward.slice(1).map((t, i) => ({ t, changed: stampGateTexelsChanged(seen[i + 1], seen[i].bytes) }));
  const solved = costs.slice(1).flatMap(stampGateSolvedText);
  return [...columns, {
    id: 'reveal/fields: seeks', passed: sought.every(({ d }) => stampGateFramePasses(d)) && moved.every(({ changed }) => changed > 0) && !solved.length,
    detail: `sought back, ${sought.map(({ t, d }) => `at ${t} s as forward (${differenceText(d)})`).join(', ')}; forward ${moved.map(({ t, changed }) => `${changed} texels moved by ${t} s`).join(', ')}; after the first still it solved ${solved.join(', ') || 'nothing'}`,
  }];
}

/** Of the nested heron's body at `t`, by how its two reveals split it: texels well inside each class, and how many lay otherwise than they should. */
function nestedClasses(frame: StampGateRevealFrame, lo: ArrayLike<number>, whole: ArrayLike<number>, t: number) {
  const tally = { 'group only': { all: 0, off: 0 }, 'band only': { all: 0, off: 0 }, both: { all: 0, off: 0 } };
  const { width, height } = frame, classOf = (x: number, y: number) => stampGateNestedClass({ x: x + 0.5, y: y + 0.5 }, t);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const kind = classOf(x, y);
      if (kind === null || kind === 'neither' || ![-1, 0, 1].every((j) => [-1, 0, 1].every((i) => classOf(x + i, y + j) === kind))) continue;
      const texel = y * width + x, against = kind === 'both' ? whole : lo, at = texel * 3;
      tally[kind].all++;
      if ([0, 1, 2].some((c) => Math.abs(frame.bytes[at + c] - against[at + c]) > 2)) tally[kind].off++;
    }
  }
  return tally;
}

/** Whether a document point lies on the nested heron's `part`. */
const onNestedPart = (part: 'wing' | 'ground') => (p: StampPoint) => stampGateNestedPart(p) === part;

/** Whether a document point lies in box `x, y, w, h`. */
const inBox = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => (p: StampPoint) => p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;

/**
 * reveal/sheets: the nested heron mid-reveal, its body cut by its group's front and its own band at once and its
 * wing's sheets, cards and all, by the front alone; the root's ground and water never cut; the hidden foot leaving
 * the shallows as its water left them.
 */
async function checkSheets(): Promise<StampGateWashCheck[]> {
  const heron = painting(STAMP_GATE_NESTED_HERON), t = STAMP_GATE_NESTED_AT;
  const { frames: [atLo, atMid, atHi, whole, bare] } = await revealStills([
    ...stillsAt(heron, [LO, t, HI]), ...stillsAt(painting(STAMP_GATE_NESTED_HERON, { reveal: 'none' }), [HI]), ...stillsAt(painting(STAMP_GATE_NESTED_HERON, { reveal: 'none', heron: false }), [HI]),
  ]);
  const mid = stampGateRevealSplit(atMid, atLo.bytes, whole.bytes, stampGateNestedShownAt(t), 1), full = stampGateRevealSplit(atHi, atLo.bytes, whole.bytes, stampGateNestedShownAt(HI), 1);
  const classes = nestedClasses(atMid, atLo.bytes, whole.bytes, t), ground = onNestedPart('ground'), wing = onNestedPart('wing');
  const groundOff = [atLo, atMid, atHi].map((frame) => stampGateTexelsChanged(frame, whole.bytes, ground)), groundTexels = texelsWhere(whole, ground);
  const cardsGone = stampGateTexelsChanged(atLo, bare.bytes, wing), cards = stampGateTexelsChanged(whole, bare.bytes, wing);
  const classText = Object.entries(classes).map(([kind, { all, off }]) => `${kind} ${off} of ${all} off`).join(', ');
  return [
    {
      id: 'reveal/sheets: nesting', passed: stampGateRevealSplitHeld(mid) && stampGateRevealSplitHeld(full) && Object.values(classes).every(({ all, off }) => all > 0 && off === 0),
      detail: `at ${t} s ${stampGateRevealSplitText(mid)}; fully revealed ${stampGateRevealSplitText(full)}; of the body, shown by the group's front or its band alone hidden, by both shown: ${classText} (0 off wanted)`,
    },
    {
      id: 'reveal/sheets: cards', passed: cardsGone === 0 && cards > 0,
      detail: `all hidden, the wing's sheets lay ${cardsGone} texels otherwise than the root's paper with no heron (0 wanted: cards go with their paint); revealed, ${cards}`,
    },
    {
      id: 'reveal/sheets: ground', passed: groundOff.every((off) => off === 0) && groundTexels > 0,
      detail: `the ground and water (${groundTexels} texels) at ${LO}, ${t} and ${HI} s: ${groundOff.join(', ')} texels off the unrevealed painting (0 wanted)`,
    },
    await checkHiddenFoot(),
  ];
}

/**
 * The wet-contact heron hidden whole: the sheet laid as the shallows' film alone, where the foot's water left it on
 * the root's paper, which differs under the foot from the shallows painted alone, and nowhere far from it.
 */
async function checkHiddenFoot(): Promise<StampGateWashCheck> {
  const at = STAMP_GATE_REVEAL_HIDDEN_FOOT_AT, evaluation = painting(STAMP_GATE_REVEAL_HIDDEN_FOOT), { widthPx: width, heightPx: height } = evaluation.document;
  const { cut, film } = await withGateSurface({ width, height }, stampGateSheetImageUrl, async ({ owner }) => {
    const { composite, release } = await solvePaintingSheets(owner, compilePaintingSelection(evaluation, stampGateSheetBrushOf), { at });
    try {
      const whole = stampPointBox({ x: 0, y: 0, w: width, h: height });
      return { cut: await readStampSheetsPicture(owner, composite, whole, 'paper'), film: await paintingFilmPicture({ owner, brushOf: stampGateSheetBrushOf }, layersOf(evaluation, ['shallows', 'heron'], { at }), 'shallows', 'sheet') };
    } finally {
      release();
    }
  });
  const largest = cut.rgba.reduce((most, v, i) => Math.max(most, Math.abs(v - film.rgba[i])), 0);
  const [{ frames: [hidden] }, { frames: [alone] }] = [await revealStills(stillsAt(evaluation, [at])), await revealStills(stillsAt(painting(STAMP_GATE_WET_CONTACT, { heron: false }), [at]))];
  const under = stampGateTexelsChanged(hidden, alone.bytes, inBox(STAMP_GATE_FOOT_BOX)), far = stampGateTexelsChanged(hidden, alone.bytes, inBox(STAMP_GATE_FAR_SHALLOWS));
  return {
    id: 'reveal/sheets: isolation', passed: largest <= 2 / 255 && under > 0 && far === 0,
    detail: `hidden whole at ${at} s, the heron's sheet lays as the shallows' film on its paper, ${largest.toExponential(2)} off at most (${(2 / 255).toExponential(2)} allowed); against the shallows painted alone, ${under} texels differ under the foot (its water stays) and ${far} far from it (0 wanted)`,
  };
}

/** A mid-reveal frame of one surface against its own ends, as a check. */
function surfaceCheck(surface: string, [atLo, atMid]: readonly StampGateRevealFrame[], whole: StampGateRevealFrame, reach: number, extra: { passed: boolean; detail: string } = { passed: true, detail: '' }): StampGateWashCheck {
  const split = stampGateRevealSplit(atMid, atLo.bytes, whole.bytes, stampGateInkShownAt(STAMP_GATE_INK_AT.mid), reach);
  return { id: `reveal/surfaces: ${surface}`, passed: stampGateRevealSplitHeld(split) && extra.passed, detail: `at ${STAMP_GATE_INK_AT.mid} s ${stampGateRevealSplitText(split)}${extra.detail}` };
}

/** The rigged heron's reeds, a rig drawn as pieces, through the shot at `times`; and unrevealed, fully shown. */
async function reedsPieces(times: readonly number[]) {
  const reeds = painting(STAMP_GATE_REVEALED_REEDS), keys = ['water', 'heron', 'reeds'];
  const { frames } = await revealShotFrames(stampGateRevealedReedsShot(({ at }) => layersOf(reeds, keys, { at })), times);
  const [whole] = (await revealShotFrames(stampGateRevealedReedsShot(layersOf(painting(STAMP_GATE_REVEALED_REEDS, { revealed: false }), keys)), [HI])).frames;
  return { frames, whole };
}

/**
 * reveal/surfaces: the ink revealed through a still, a shot, a clear back over HTML (a glaze, both its images) and a
 * painted texture, each held to the twin against its own ends; over HTML, all hidden lays nothing; the texture laid
 * and re-mipped as its reveal moves; and a rig's reeds, drawn as pieces, their paint and card cut alike.
 */
async function checkSurfaces(): Promise<StampGateWashCheck[]> {
  const ink = painting(STAMP_GATE_INK), whole = painting(STAMP_GATE_INK, { reveal: 'none' }), times = [LO, STAMP_GATE_INK_AT.mid, HI];
  const stills = await revealStills([...stillsAt(ink, times), ...stillsAt(whole, [HI])]);
  const shot = await revealShotFrames(stampGateRevealShot(({ at }) => layersOf(ink, ['ink'], { at })), times), [shotWhole] = (await revealShotFrames(stampGateRevealShot(layersOf(whole, ['ink'])), [HI])).frames;
  const clear = await clearBackFrames(stampGateRevealShot(({ at }) => layersOf(ink, ['ink'], { ground: 'transparent', at })), times);
  const clearWhole = await clearBackFrames(stampGateRevealShot(layersOf(whole, ['ink'], { ground: 'transparent' })), [HI]);
  const textured = await inkTextureLevels(times), [loLevels, midLevels, hiLevels] = textured.levels;
  const laidClear = [clear.colour[0], clear.filter[0]].reduce((most, { bytes }) => Array.from(bytes).reduce((m, v, i) => (i % 4 === 3 ? Math.max(m, v) : m), most), 0);
  const filterSplit = stampGateRevealSplit(clear.filter[1], clear.filter[0].bytes, clearWhole.filter[0].bytes, stampGateInkShownAt(STAMP_GATE_INK_AT.mid), 1);
  const remipped = [loLevels, hiLevels].map(({ half }) => stampGateTexelsChanged(midLevels.half, half.bytes));
  const pieces = await reedsPieces([LO, STAMP_GATE_REEDS_AT]), piecesSplit = stampGateRevealSplit(pieces.frames[1], pieces.frames[0].bytes, pieces.whole.bytes, stampGateReedsShownAt(STAMP_GATE_REEDS_AT), 1);
  return [
    surfaceCheck('still', stills.frames, stills.frames[3], 1),
    surfaceCheck('shot', shot.frames, shotWhole, 1),
    surfaceCheck('html', clear.colour, clearWhole.colour[0], 1, {
      passed: laidClear === 0 && stampGateRevealSplitHeld(filterSplit),
      detail: ` in the glaze's colour, ${stampGateRevealSplitText(filterSplit)} in its filter; all hidden over HTML, either's most opaque texel ${laidClear} (0 wanted)`,
    }),
    surfaceCheck('texture', textured.levels.map(({ base }) => base), textured.whole, 1, {
      passed: remipped.every((changed) => changed > 0), detail: `; its level 1 at ${STAMP_GATE_INK_AT.mid} s differs from it all hidden in ${remipped[0]} texels and all shown in ${remipped[1]} (re-mipped as it moves)`,
    }),
    { id: 'reveal/surfaces: pieces', passed: stampGateRevealSplitHeld(piecesSplit), detail: `the reeds drawn as pieces, at ${STAMP_GATE_REEDS_AT} s ${stampGateRevealSplitText(piecesSplit)}` },
  ];
}

/** Frames at 24 fps from 1 s: within the first hold of 6 the first two, past it the third. */
const HOLD = 6, HELD_TIMES = [1, 1.15, 1.3] as const, FRAME_TIMES = [1, 1 + 1 / 24, 1 + 2 / 24] as const;

/**
 * reveal/clock: held on sixes, the reveal steps with its source; unheld, it moves every frame, no texel jumping, and
 * solves nothing; an edited reveal solves nothing and lays anew; posed, a node's reveal goes with its paint; a
 * dissolve's ends show each side's reveal at its own time.
 */
async function checkClock(): Promise<StampGateWashCheck[]> {
  const ink = painting(STAMP_GATE_INK), revealed = ({ at }: { at: number }) => layersOf(ink, ['ink'], { at });
  const held = (await revealShotFrames(stampGateRevealShot(revealed, HOLD), HELD_TIMES)).frames;
  const within = stampGateFrameDifference(held[0].bytes, held[1].bytes), past = stampGateTexelsChanged(held[1], held[2].bytes);
  const smooth = await revealShotFrames(stampGateRevealShot(revealed), [LO, HI, ...FRAME_TIMES]), [atLo, atHi, ...frames] = smooth.frames;
  const steps = frames.slice(1).map((frame, i) => ({ changed: stampGateTexelsChanged(frame, frames[i].bytes), largest: stampGateFrameDifference(frame.bytes, frames[i].bytes).max }));
  const range = stampGateFrameDifference(atLo.bytes, atHi.bytes).max, smoothSolved = smooth.costs.slice(3).flatMap(stampGateSolvedText);
  const edit = await revealStills([{ evaluation: ink, at: STAMP_GATE_INK_AT.mid }, { evaluation: painting(STAMP_GATE_INK, { reveal: 'slow' }), at: STAMP_GATE_INK_AT.mid }]);
  const editSolved = stampGateSolvedText(edit.costs[1]), edited = stampGateTexelsChanged(edit.frames[1], edit.frames[0].bytes);
  const heron = painting(STAMP_GATE_NESTED_HERON), poses: PaintingPoses = new Map([['heron', paintingSimilarityPose({ ma: 1, mb: 0, kx: STAMP_GATE_NESTED_MOVE.x, ky: STAMP_GATE_NESTED_MOVE.y })]]);
  const { frames: [posedLo, posedMid, posedWhole] } = await revealStills([...stillsAt(heron, [LO, STAMP_GATE_NESTED_AT], poses), ...stillsAt(painting(STAMP_GATE_NESTED_HERON, { reveal: 'none' }), [HI], poses)]);
  const posed = stampGateRevealSplit(posedMid, posedLo.bytes, posedWhole.bytes, stampGateNestedShownAt(STAMP_GATE_NESTED_AT, STAMP_GATE_NESTED_MOVE), 1);
  const mid = STAMP_GATE_INK_AT.mid, shotOf = async (props: PaintedShotProps) => (await revealShotFrames(props, [0])).frames[0];
  const sides = await gpuEachInTurn([mid, HI], (at) => shotOf(stampGateRevealShot(layersOf(ink, ['ink'], { at }))));
  const ends = await gpuEachInTurn([0, 1], (k) => shotOf(stampGateRevealShot(dissolve(layersOf(ink, ['ink'], { at: mid }), layersOf(ink, ['ink'], { at: HI }), k))));
  const atEnds = ends.map((frame, i) => stampGateFrameDifference(frame.bytes, sides[i].bytes));
  return [
    {
      id: 'reveal/clock: held', passed: stampGateFramePasses(within) && past > 0,
      detail: `held on ${HOLD}s at ${HELD_TIMES.join(', ')} s: within a hold ${differenceText(within)}, past it ${past} texels moved (alike within, moved past, wanted)`,
    },
    {
      id: 'reveal/clock: smooth', passed: steps.every(({ changed, largest }) => changed > 0 && largest <= range / 2) && !smoothSolved.length,
      detail: `unheld, frame by frame from 1 s: ${steps.map(({ changed, largest }) => `${changed} texels moved, the most ${largest} levels`).join('; ')} (each moving, none past half the reveal's ${range} levels, wanted); solved ${smoothSolved.join(', ') || 'nothing'}`,
    },
    {
      id: 'reveal/clock: edited', passed: !editSolved.length && edited > 0,
      detail: `its reveal slowed, the still at ${mid} s solved ${editSolved.join(', ') || 'nothing'} and laid ${edited} texels otherwise`,
    },
    {
      id: 'reveal/clock: posed', passed: stampGateRevealSplitHeld(posed),
      detail: `the heron moved ${STAMP_GATE_NESTED_MOVE.x}, ${STAMP_GATE_NESTED_MOVE.y} px, its reveals moved with it: at ${STAMP_GATE_NESTED_AT} s ${stampGateRevealSplitText(posed)}`,
    },
    {
      id: 'reveal/clock: dissolve ends', passed: atEnds.every(stampGateFramePasses),
      detail: `dissolving from the ink at ${mid} s to it at ${HI} s: at k 0 ${differenceText(atEnds[0])} from the first alone, at k 1 ${differenceText(atEnds[1])} from the second`,
    },
  ];
}

/** Reveal case `id`'s checks. */
export async function checkStampGateRevealCase(id: StampGateRevealId): Promise<StampGateWashCheck[]> {
  const checks: Record<StampGateRevealId, () => Promise<StampGateWashCheck[]>> = {
    'reveal/strokes': checkStrokes, 'reveal/fields': checkFields, 'reveal/sheets': checkSheets, 'reveal/surfaces': checkSurfaces, 'reveal/clock': checkClock,
  };
  if (!(id in checks)) throw new Error(`stamp gate: no reveal case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_REVEAL_IDS.join(', ')}`);
  return checks[id]();
}
