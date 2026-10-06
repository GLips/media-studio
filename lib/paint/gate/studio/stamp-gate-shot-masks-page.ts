// stamp-gate-shot-masks-page.ts: the gate page's masked shot (stamp-gate-shot-masks.ts), drawn through the shot's
// renderer (stamp-gate-shot-frames.ts): alphaOf masks cutting a tint to the heron's wing, to all but it, to a disc
// moving across, a picture or a three plane, to the heron revealed by its document over frames and faded, to the
// disc faded, held and instanced, and to the wing a depth farther as the camera pans.

import { CircleGeometry, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import type { ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateFrameDifference, stampGateFrameDifferenceText as differenceText, stampGateFramePasses, stampGateLaidShare } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  STAMP_GATE_MASKS_ACROSS, STAMP_GATE_MASKS_AT, STAMP_GATE_MASKS_DISC, STAMP_GATE_MASKS_WHIP, STAMP_GATE_MASKS_WING, stampGateMaskDiscBox, stampGateMaskDiscCentre,
  stampGateMaskedShot, stampGateMaskedView, stampGateNearDiscCentre, stampGateTintAgainstTwin, stampGateTintSplit, stampGateWellInsideVane,
  type StampGateMaskedShot, type StampGateShotMaskId,
} from '../models/stamp-gate-shot-masks.ts';
import { paintSimilarityApply } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintFilmShutter } from '#lib/paint/animation/models/paint-camera.ts';
import { STAMP_GATE_SHOT_FPS } from '../models/stamp-gate-shot-span.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, type StampGateShotDraw } from './stamp-gate-shot-frames.ts';

/** The masked shot as `shown` says, drawn as `draws` say: each frame's RGB bytes, and its costs. */
async function maskedFrames(shown: StampGateMaskedShot, draws: readonly StampGateShotDraw[]) {
  const { frames, costs } = await stampGateShotFrames(stampGateMaskedShot(shown), draws);
  return { frames: frames.map(stampGateRgb), costs };
}

/** The disc as a three plane: a flat grey disc on its plane, where stampGateMaskDiscCentre puts it. */
const THREE_DISC: ThreeSource = {
  kind: 'three',
  build: ({ plane }) => {
    const geometry = new CircleGeometry(plane.length(STAMP_GATE_MASKS_DISC.r), 64), material = new MeshBasicNodeMaterial({ color: 0x8890a0 }), mesh = new Mesh(geometry, material);
    const scene = new Scene();
    scene.add(mesh);
    return {
      scene,
      poseAt: ({ at }) => {
        const p = plane.point(stampGateMaskDiscCentre(at));
        mesh.position.set(p.x, p.y, p.z);
      },
      dispose: () => {
        material.dispose();
        geometry.dispose();
      },
    };
  },
};

/** How far the camera pans for the three disc's check, px: the tint and the disc, at their depths, move apart. */
const PAN = 24;

/** The disc frames' scene seconds: the disc moves between them. */
const DISC_TIMES = [0, 1] as const;

/** How each frame `cut` (the tint cut to the disc) differs from `bare`, `width` px wide, at `times`, round the disc as `shown`'s camera shows it. */
const discSplits = (cut: readonly ArrayLike<number>[], bare: readonly ArrayLike<number>[], width: number, shown: StampGateMaskedShot, times: readonly number[] = DISC_TIMES) =>
  times.map((at, i) => ({ at, split: stampGateTintSplit(cut[i], bare[i], width, stampGateMaskDiscBox(at, stampGateMaskedView(shown, STAMP_GATE_MASKS_DISC.depth, at))) }));
const discText = (splits: ReturnType<typeof discSplits>) => splits.map(({ at, split }) => `at ${at} s, ${split.inside} texels round it and ${split.outside} past it`).join('; ');

/**
 * alphaOf: the tint cut to the wing's coverage changes only round the wing, all through its vane; inverted, it leaves
 * the vane and tints all past the wing. Cut to a moving disc, it follows the disc: a picture plane's, and a three
 * plane's where the panned camera shows it.
 */
async function checkAlphaOf(): Promise<StampGateWashCheck[]> {
  const { width } = stampGateMaskedShot({ heron: 'unmasked', tint: 'none' }).camera.stage.frame, times = DISC_TIMES;
  const [[bare], [wing], [notWing], discBare, discCut] = await Promise.all([
    maskedFrames({ heron: 'unmasked', tint: 'none' }, [0]), maskedFrames({ heron: 'unmasked', tint: 'wing' }, [0]), maskedFrames({ heron: 'unmasked', tint: 'not wing' }, [0]),
    maskedFrames({ heron: 'unmasked', disc: 'picture', tint: 'none' }, times), maskedFrames({ heron: 'unmasked', disc: 'picture', tint: 'disc' }, times),
  ].map(async (drawn) => (await drawn).frames));
  const threeShown = { heron: 'none', disc: THREE_DISC, tint: 'disc', pan: PAN } as const;
  const [threeBare, threeCut] = await Promise.all([maskedFrames({ ...threeShown, tint: 'none' }, times), maskedFrames(threeShown, times)].map(async (drawn) => (await drawn).frames));
  const onWing = stampGateTintSplit(wing, bare, width, STAMP_GATE_MASKS_WING), offWing = stampGateTintSplit(notWing, bare, width, STAMP_GATE_MASKS_WING);
  const onDisc = discSplits(discCut, discBare, width, { heron: 'unmasked', disc: 'picture', tint: 'disc' }), onThree = discSplits(threeCut, threeBare, width, threeShown);
  return [
    {
      id: 'shot/masks: alphaOf', passed: onWing.outside === 0 && onWing.vane === onWing.vaneAll && onWing.vaneAll > 0,
      detail: `the tint cut to heron/wing changed ${onWing.inside} texels round the wing and ${onWing.outside} past it (0 wanted), ${onWing.vane} of the ${onWing.vaneAll} well inside its vane (all wanted)`,
    },
    {
      id: 'shot/masks: alphaOf inverted', passed: offWing.vane === 0 && offWing.outside === offWing.beyond,
      detail: `the tint cut to all but heron/wing changed ${offWing.vane} texels well inside its vane (0 wanted) and ${offWing.outside} of the ${offWing.beyond} past the wing (all wanted)`,
    },
    {
      id: 'shot/masks: alphaOf picture', passed: onDisc.every(({ split }) => split.inside > 0 && split.outside === 0),
      detail: `the tint cut to the moving disc changed, ${discText(onDisc)} (0 past it wanted)`,
    },
    {
      id: 'shot/masks: alphaOf three', passed: onThree.every(({ split }) => split.inside > 0 && split.outside === 0),
      detail: `the tint cut to the moving three disc, the camera panned ${PAN} px, changed, ${discText(onThree)} where it shows (0 past it wanted)`,
    },
  ];
}

/** The kept frames' scene seconds: the heron revealed not at all, in part, wholly, and wholly a second on. */
const KEPT_TIMES = [STAMP_GATE_MASKS_AT.none, STAMP_GATE_MASKS_AT.part, STAMP_GATE_MASKS_AT.whole, STAMP_GATE_MASKS_AT.whole + 1] as const;

/**
 * A painted plane reading another: the tint cut to the wing of the heron its document reveals draws each frame as
 * drawn alone, laying nothing anew once both hold. Cut to the heron faded to half, or dissolving halfway, it reads
 * half the coverage, cutting its opacity: a glaze's light is concave in opacity, laying over half.
 */
async function checkAlphaOfPainted(): Promise<StampGateWashCheck[]> {
  const shown = { heron: 'revealed', tint: 'wing' } as const, { width } = stampGateMaskedShot(shown).camera.stage.frame;
  const kept = await maskedFrames(shown, KEPT_TIMES), alone = await Promise.all(KEPT_TIMES.map(async (at) => (await maskedFrames(shown, [at])).frames[0]));
  const differences = kept.frames.map((frame, i) => stampGateFrameDifference(frame, alone[i])), misses = kept.costs.map(({ counts }) => counts.get('picture misses') ?? 0);
  const tinted = await Promise.all((['unmasked', 'half', 'dissolving'] as const).map(async (heron) => {
    const [[bare], [cut], [uncut]] = await Promise.all((['none', 'heron', 'uncut'] as const).map(async (tint) => (await maskedFrames({ heron, tint }, [0])).frames));
    return stampGateLaidShare(cut, uncut, bare, { width, channels: 3 }, stampGateWellInsideVane);
  }));
  const [unfaded, faded, dissolving] = tinted, share = unfaded > 0 ? faded / unfaded : 0, dissolvedShare = unfaded > 0 ? dissolving / unfaded : 0;
  return [
    {
      id: 'shot/masks: alphaOf kept', passed: differences.every(stampGateFramePasses) && misses.at(-1) === 0,
      detail: `at ${KEPT_TIMES.join(', ')} s, each frame against it drawn alone: ${differences.map(differenceText).join('; ')}; laid ${misses.join(', ')} pictures anew (none at the last wanted)`,
    },
    {
      id: 'shot/masks: alphaOf faded', passed: share >= 0.45 && share <= 0.8,
      detail: `the tint cut to heron/heron lays ${unfaded.toFixed(3)} of itself over the vane, ${faded.toFixed(3)} with the heron at half visibility: ${share.toFixed(3)} as much (0.45..0.8 wanted: half its opacity)`,
    },
    {
      id: 'shot/masks: alphaOf dissolving', passed: Math.abs(dissolvedShare - share) <= 0.03,
      detail: `with the heron dissolving halfway to water lying elsewhere, the tint cut to heron/heron lays ${dissolvedShare.toFixed(3)} as much as unfaded (${share.toFixed(3)}, as faded to half, within 0.03 wanted)`,
    },
  ];
}

/** The held frames' scene seconds: frames 0, 3 and 7 at 24 fps, the first two within a hold of HOLD, the last past it. */
const HOLD = 6, HELD_TIMES = [0, 0.15, 0.3] as const;

/** The disc as `disc` shows it, the tint as `tint` cuts it, at scene second 0. */
const discFrame = async (shown: Omit<StampGateMaskedShot, 'heron'>) => (await maskedFrames({ heron: 'none', ...shown }, [0])).frames[0];

/** How much the tint cut to the disc lays near the disc's centre, `radius` px, as a share of the tint uncut, the disc shown as `shown`. */
async function discTintShare(shown: Omit<StampGateMaskedShot, 'heron' | 'tint'>, width: number, radius: number) {
  const [bare, cut, uncut] = await Promise.all((['none', 'disc', 'uncut'] as const).map((tint) => discFrame({ ...shown, tint })));
  return stampGateLaidShare(cut, uncut, bare, { width, channels: 3 }, stampGateNearDiscCentre(0, radius));
}

/** Frames held: the first two (within a hold) alike, the last (past it) not. */
const heldText = ([within, past]: ReturnType<typeof stampGateFrameDifference>[]) => `within a hold ${differenceText(within)}, past it ${differenceText(past)}`;
const heldPasses = ([within, past]: ReturnType<typeof stampGateFrameDifference>[]) => stampGateFramePasses(within) && !stampGateFramePasses(past);

/**
 * The disc's sources, drawn and read: a picture disc at half visibility lays half of itself, the tint cut to it half
 * its coverage; a three disc hidden draws and cuts as none; held, a disc and its tint keep still within a hold; the
 * tint cut to an instanced spot follows it and fades with it.
 */
async function checkSources(): Promise<StampGateWashCheck[]> {
  const { width } = stampGateMaskedShot({ heron: 'none', tint: 'none' }).camera.stage.frame, wellInside = STAMP_GATE_MASKS_DISC.r - 4, spotInside = STAMP_GATE_MASKS_DISC.spot - 6;
  const [empty, whole, half, hidden] = await Promise.all([
    discFrame({ tint: 'none' }), discFrame({ disc: 'picture', tint: 'none' }), discFrame({ disc: 'picture', discVisibility: 0.5, tint: 'none' }),
    discFrame({ disc: THREE_DISC, discVisibility: 0, tint: 'disc' }),
  ]);
  const drawnShare = stampGateLaidShare(half, whole, empty, { width, channels: 3 }, stampGateNearDiscCentre(0, wellInside)), asEmpty = stampGateFrameDifference(hidden, empty);
  const [wholeTint, halfTint, spotTint, halfSpotTint] = await Promise.all([
    discTintShare({ disc: 'picture' }, width, wellInside), discTintShare({ disc: 'picture', discVisibility: 0.5 }, width, wellInside),
    discTintShare({ disc: 'spot' }, width, spotInside), discTintShare({ disc: 'spot', discVisibility: 0.5 }, width, spotInside),
  ]);
  const held = await Promise.all((['picture', THREE_DISC] as const).map(async (disc) => {
    const { frames } = await maskedFrames({ heron: 'none', disc, discHold: HOLD, tint: 'disc' }, HELD_TIMES);
    return [stampGateFrameDifference(frames[0], frames[1]), stampGateFrameDifference(frames[1], frames[2])];
  }));
  const [spotBare, spotCut] = await Promise.all((['none', 'disc'] as const).map(async (tint) => (await maskedFrames({ heron: 'none', disc: 'spot', tint }, DISC_TIMES)).frames));
  const onSpot = discSplits(spotCut, spotBare, width, { heron: 'none', disc: 'spot', tint: 'disc' }), tintShare = halfTint / wholeTint, spotShare = halfSpotTint / spotTint;
  return [
    {
      id: 'shot/masks: source faded', passed: drawnShare >= 0.45 && drawnShare <= 0.55 && wholeTint >= 0.95 && tintShare >= 0.45 && tintShare <= 0.8,
      detail: `the picture disc at half visibility lays ${drawnShare.toFixed(3)} of itself (0.45..0.55 wanted); the tint cut to it lays ${wholeTint.toFixed(3)} of itself unfaded (0.95 at least wanted), ${tintShare.toFixed(3)} as much at half (0.45..0.8 wanted: half its opacity)`,
    },
    {
      id: 'shot/masks: source hidden', passed: asEmpty.max <= 1,
      detail: `the three disc at visibility 0, the tint cut to it, is drawn as no disc and no tint: ${differenceText(asEmpty)} (a level at most wanted, the half-float rounding of laying the tint's empty picture)`,
    },
    {
      id: 'shot/masks: source held', passed: held.every(heldPasses),
      detail: `held on ${HOLD}s at ${HELD_TIMES.join(', ')} s, the tint cut to it: the picture disc ${heldText(held[0])}; the three disc ${heldText(held[1])} (alike within, not past, wanted)`,
    },
    {
      id: 'shot/masks: alphaOf instanced', passed: onSpot.every(({ split }) => split.inside > 0 && split.outside === 0) && spotShare >= 0.45 && spotShare <= 0.8,
      detail: `the tint cut to an instanced plane's moving spot changed, ${discText(onSpot)} (0 past it wanted); the plane at half visibility, it lays ${spotShare.toFixed(3)} as much (0.45..0.8 wanted)`,
    },
  ];
}

/** Pictures laid anew at each of a drawing's frames. */
const laidAnew = ({ costs }: Awaited<ReturnType<typeof maskedFrames>>) => costs.map(({ counts }) => counts.get('picture misses') ?? 0);

/**
 * A mask across depths: the tint a depth nearer than the heron, cut to its wing, stays on the wing where the camera
 * shows it as a pan parts the two depths, laid anew each frame the parallax moves. At the heron's own depth it lays
 * nothing anew once both hold.
 */
async function checkAcrossDepths(): Promise<StampGateWashCheck[]> {
  const { shown, times } = STAMP_GATE_MASKS_ACROSS, { width } = stampGateMaskedShot(shown).camera.stage.frame;
  const discShown = { ...shown, heron: 'none', disc: 'picture', tint: 'disc' } as const;
  const [bare, cut, oneDepth, discBare, discCut] = await Promise.all([
    maskedFrames({ ...shown, tint: 'none' }, times), maskedFrames(shown, times), maskedFrames({ ...shown, tintDepth: 2 }, times),
    maskedFrames({ ...discShown, tint: 'none' }, times), maskedFrames(discShown, times),
  ]);
  const splits = times.map((at, i) => ({ at, split: stampGateTintSplit(cut.frames[i], bare.frames[i], width, STAMP_GATE_MASKS_WING, stampGateMaskedView(shown, 2, at)) }));
  const onDisc = discSplits(discCut.frames, discBare.frames, width, discShown, times), across = laidAnew(cut), one = laidAnew(oneDepth);
  const splitText = splits.map(({ at, split }) => `at ${at} s, ${split.inside} texels round the wing and ${split.outside} past it, ${split.vane} of the ${split.vaneAll} well inside its vane`);
  const onWing = splits.every(({ split }) => split.outside === 0 && split.vane === split.vaneAll && split.vaneAll > 0);
  return [
    {
      id: 'shot/masks: across depths', passed: onWing && onDisc.every(({ split }) => split.inside > 0 && split.outside === 0),
      detail: `the tint at depth 1, the camera panning ${shown.pan} px over ${shown.panOver} s: cut to heron/wing at depth 2, where the wing shows, ${splitText.join('; ')} (0 past it and all the vane wanted); cut to the picture disc at depth ${STAMP_GATE_MASKS_DISC.depth}, ${discText(onDisc)} (0 past it wanted)`,
    },
    {
      id: 'shot/masks: across depths laid', passed: across.slice(1).every((laid) => laid > 0) && one.at(-1) === 0,
      detail: `at ${times.join(', ')} s, laid ${across.join(', ')} pictures anew with the tint a depth nearer (some each frame the pan moves wanted), ${one.join(', ')} with it at the heron's depth (none at the last wanted)`,
    },
  ];
}

/**
 * How far the whip's fast frame may sit from its reference, levels: the cut is laid at the frame's moment and its
 * motion gathered as the tint moves, twice the wing's pace, so its edge smears a little wider than the reference's
 * exposures cut it (measured max 53, mean 0.40; without the tint 33 and 0.31).
 */
const WHIP_TOLERANCE = { max: 64, mean: 0.6 };

/**
 * A mask across depths under the film's shutter as the camera whips across, mid-pan: the reference, each exposure cut
 * at its own views, tints where its shut twin does, within half the wing's travel over the shutter; the fast frame
 * sits within WHIP_TOLERANCE of the reference.
 */
async function checkAcrossDepthsOpen(): Promise<StampGateWashCheck[]> {
  const { shown, at } = STAMP_GATE_MASKS_WHIP, shut = { ...shown, shutter: 'shut' } as const, { width } = stampGateMaskedShot(shown).camera.stage.frame;
  const draws = [{ t: at, mode: 'reference' }, { t: at, mode: 'fast' }] as const;
  const [[reference, fast], [referenceBare, fastBare], [twin], [twinBare]] = await Promise.all([
    maskedFrames(shown, draws), maskedFrames({ ...shown, tint: 'none' }, draws), maskedFrames(shut, [at]), maskedFrames({ ...shut, tint: 'none' }, [at]),
  ].map(async (drawn) => (await drawn).frames));
  // How far the wing moves over the shutter, frame px, and the reach that allows half of it, a texel over.
  const half = paintFilmShutter(STAMP_GATE_SHOT_FPS) / 2, wingAt = (t: number) => paintSimilarityApply(stampGateMaskedView(shown, 2, t), { x: 0, y: 0 }).x;
  const travel = Math.abs(wingAt(at + half) - wingAt(at - half)), reach = Math.ceil(travel / 2) + 1;
  const held = stampGateTintAgainstTwin([reference, referenceBare], [twin, twinBare], width, reach);
  const apart = stampGateFrameDifference(fast, reference), bareApart = stampGateFrameDifference(fastBare, referenceBare);
  return [
    {
      id: 'shot/masks: across depths open', passed: held.strays === 0 && held.missed === 0 && held.twinTinted > 0,
      detail: `the tint at depth 1 cut to heron/wing at depth 2, the camera panning ${shown.pan} px over ${shown.panOver} s under the film's shutter, at ${at} s: the reference tints ${held.tinted} texels against its shut twin's ${held.twinTinted}, within ${reach} px (the wing moves ${travel.toFixed(1)} px over the shutter): ${held.strays} past them and ${held.missed} of their inside left (0 and 0 wanted)`,
    },
    {
      id: 'shot/masks: across depths open fast', passed: apart.max <= WHIP_TOLERANCE.max && apart.mean <= WHIP_TOLERANCE.mean,
      detail: `the fast frame against the reference: ${differenceText(apart)} (past ${WHIP_TOLERANCE.max} or a mean past ${WHIP_TOLERANCE.mean} fails); without the tint, ${differenceText(bareApart)}`,
    },
  ];
}

/** Masked shot case `id`'s checks. */
export async function checkStampGateShotMasksCase(id: StampGateShotMaskId): Promise<StampGateWashCheck[]> {
  const checks: Record<StampGateShotMaskId, () => Promise<StampGateWashCheck[]>> = {
    'shot/masks: alphaOf': checkAlphaOf, 'shot/masks: alphaOf painted': checkAlphaOfPainted, 'shot/masks: sources': checkSources, 'shot/masks: across depths': checkAcrossDepths,
    'shot/masks: across depths open': checkAcrossDepthsOpen,
  };
  return checks[id]();
}
