// stamp-gate-shot-masks-page.ts: the gate page's masked shot (stamp-gate-shot-masks.ts), drawn through the shot's
// renderer (stamp-gate-shot-frames.ts): a path mask revealing the heron along its strokes, and alphaOf masks cutting a
// tint to the heron's wing, to all but it, to a disc moving across, a picture or a three plane, to the heron revealed
// over frames and faded, and to the disc faded, held and instanced.

import { CircleGeometry, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import type { ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateFrameDifference, stampGateFrameDifferenceText as differenceText, stampGateFramePasses } from '../models/stamp-gate-frames.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  STAMP_GATE_MASKS_AT, STAMP_GATE_MASKS_DISC, STAMP_GATE_MASKS_WING, stampGateLaidShare, stampGateMaskDiscBox, stampGateMaskDiscCentre, stampGateMaskedShot, stampGateNearDiscCentre, stampGateRevealSplit,
  stampGateTintSplit, stampGateWellInsideVane,
  type StampGateMaskedShot, type StampGateShotMaskId,
} from '../models/stamp-gate-shot-masks.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames, stampGateSolvedText } from './stamp-gate-shot-frames.ts';

/** The masked shot as `shown` says, drawn at scene seconds `times`: each frame's RGB bytes, and its costs. */
async function maskedFrames(shown: StampGateMaskedShot, times: readonly number[]) {
  const { frames, costs } = await stampGateShotFrames(stampGateMaskedShot(shown), times);
  return { frames: frames.map(stampGateRgb), costs };
}

/**
 * The path mask: revealing nothing it draws as the heron hidden, revealing all as unmasked; part revealed, it shows
 * the whole reveal well inside its band and nothing past it, card and film alike, re-solving nothing. A path mask on
 * the back cuts its paint, never its paper.
 */
async function checkPath(): Promise<StampGateWashCheck[]> {
  const { none, part, whole } = STAMP_GATE_MASKS_AT, { width } = stampGateMaskedShot({ heron: 'revealed', tint: 'none' }).camera.stage.frame;
  const revealed = await maskedFrames({ heron: 'revealed', tint: 'none' }, [none, part, whole]), [atNone, atPart, atWhole] = revealed.frames;
  const [[hidden], [unmasked], [cut], [faded]] = await Promise.all(([
    { heron: 'hidden', tint: 'none' }, { heron: 'unmasked', tint: 'none' }, { heron: 'none', tint: 'none', pond: 'cut' }, { heron: 'none', tint: 'none', pond: 'faded' },
  ] as const).map(async (shown) => (await maskedFrames(shown, [none])).frames));
  const asHidden = stampGateFrameDifference(atNone, hidden), asUnmasked = stampGateFrameDifference(atWhole, unmasked), ground = stampGateFrameDifference(cut, faded);
  const split = stampGateRevealSplit(atPart, atNone, atWhole, width), solves = revealed.costs.slice(1).flatMap(stampGateSolvedText), warnings = revealed.costs.flatMap((each) => each.warnings);
  return [
    {
      id: 'shot/masks: path ends', passed: stampGateFramePasses(asHidden) && stampGateFramePasses(asUnmasked),
      detail: `revealing nothing, the heron is drawn as hidden (${differenceText(asHidden)}); revealing past its strokes' length, as unmasked (${differenceText(asUnmasked)})`,
    },
    {
      id: 'shot/masks: path band', passed: split.shown > 0 && split.inside === 0 && split.outside === 0 && !solves.length && !warnings.length,
      detail: `part revealed, it changed ${split.shown} texels from nothing revealed; ${split.inside} well inside its band differ from the whole reveal, ${split.outside} past it from none (0 wanted); its reveals solved ${solves.join(', ') || 'nothing'}${warnings.length ? `; warned: ${warnings.join('; ')}` : ''}`,
    },
    {
      id: 'shot/masks: path on the back', passed: stampGateFramePasses(ground),
      detail: `the pond's water cut by a mask revealing nothing is drawn as the water hidden, its paper showing (${differenceText(ground)})`,
    },
  ];
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

/** How each frame `cut` (the tint cut to the disc) differs from `bare`, `width` px wide, round the disc as a camera panned `pan` shows it. */
const discSplits = (cut: readonly ArrayLike<number>[], bare: readonly ArrayLike<number>[], width: number, pan: number) =>
  DISC_TIMES.map((at, i) => ({ at, split: stampGateTintSplit(cut[i], bare[i], width, stampGateMaskDiscBox(at, pan)) }));
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
  const [threeBare, threeCut] = await Promise.all([
    maskedFrames({ heron: 'none', disc: THREE_DISC, tint: 'none', pan: PAN }, times), maskedFrames({ heron: 'none', disc: THREE_DISC, tint: 'disc', pan: PAN }, times),
  ].map(async (drawn) => (await drawn).frames));
  const onWing = stampGateTintSplit(wing, bare, width, STAMP_GATE_MASKS_WING), offWing = stampGateTintSplit(notWing, bare, width, STAMP_GATE_MASKS_WING);
  const onDisc = discSplits(discCut, discBare, width, 0), onThree = discSplits(threeCut, threeBare, width, PAN);
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
 * A painted plane reading another: the tint cut to the revealing heron's wing draws each frame of one renderer as
 * drawn alone, laying nothing anew once both hold. Cut to the heron faded to half, or dissolving halfway to water
 * elsewhere, it reads half the coverage, cutting its opacity: a glaze's light is concave in opacity, laying over half.
 */
async function checkAlphaOfPainted(): Promise<StampGateWashCheck[]> {
  const shown = { heron: 'revealed', tint: 'wing' } as const, { width } = stampGateMaskedShot(shown).camera.stage.frame;
  const kept = await maskedFrames(shown, KEPT_TIMES), alone = await Promise.all(KEPT_TIMES.map(async (at) => (await maskedFrames(shown, [at])).frames[0]));
  const differences = kept.frames.map((frame, i) => stampGateFrameDifference(frame, alone[i])), misses = kept.costs.map(({ counts }) => counts.get('picture misses') ?? 0);
  const tinted = await Promise.all((['unmasked', 'half', 'dissolving'] as const).map(async (heron) => {
    const [[bare], [cut], [uncut]] = await Promise.all((['none', 'heron', 'uncut'] as const).map(async (tint) => (await maskedFrames({ heron, tint }, [0])).frames));
    return stampGateLaidShare(cut, uncut, bare, width, stampGateWellInsideVane);
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
  return stampGateLaidShare(cut, uncut, bare, width, stampGateNearDiscCentre(0, radius));
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
  const drawnShare = stampGateLaidShare(half, whole, empty, width, stampGateNearDiscCentre(0, wellInside)), asEmpty = stampGateFrameDifference(hidden, empty);
  const [wholeTint, halfTint, spotTint, halfSpotTint] = await Promise.all([
    discTintShare({ disc: 'picture' }, width, wellInside), discTintShare({ disc: 'picture', discVisibility: 0.5 }, width, wellInside),
    discTintShare({ disc: 'spot' }, width, spotInside), discTintShare({ disc: 'spot', discVisibility: 0.5 }, width, spotInside),
  ]);
  const held = await Promise.all((['picture', THREE_DISC] as const).map(async (disc) => {
    const { frames } = await maskedFrames({ heron: 'none', disc, discHold: HOLD, tint: 'disc' }, HELD_TIMES);
    return [stampGateFrameDifference(frames[0], frames[1]), stampGateFrameDifference(frames[1], frames[2])];
  }));
  const [spotBare, spotCut] = await Promise.all((['none', 'disc'] as const).map(async (tint) => (await maskedFrames({ heron: 'none', disc: 'spot', tint }, DISC_TIMES)).frames));
  const onSpot = discSplits(spotCut, spotBare, width, 0), tintShare = halfTint / wholeTint, spotShare = halfSpotTint / spotTint;
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

/** Masked shot case `id`'s checks. */
export async function checkStampGateShotMasksCase(id: StampGateShotMaskId): Promise<StampGateWashCheck[]> {
  const checks: Record<StampGateShotMaskId, () => Promise<StampGateWashCheck[]>> = {
    'shot/masks: path': checkPath, 'shot/masks: alphaOf': checkAlphaOf, 'shot/masks: alphaOf painted': checkAlphaOfPainted, 'shot/masks: sources': checkSources,
  };
  return checks[id]();
}
