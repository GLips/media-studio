// stamp-wet-landing.ts: how a wash's paint lands, per pixel, as the paper is (stamp-wetness.ts): on dry, set paper as
// a plain pass's does (layDeposit); on wet paper its pigment adds; between, as workable as the paper is. A wash
// brush's water stops at a hard edge on dry paper, however soft its tip, and so does a flood's outside a wash, its
// paper dry. The laws are WGSL only: the renderer is where they run.

import { paintMediumCan, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { CompiledStampAction } from './stamp-paint-action.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe-compile.ts';
import type { StampPaintMedia } from './stamp-wetness.ts';

/**
 * Which law lays a deposit (`wash`, the compositor's landDeposit, into the paper's wetness: firm, as workable as the
 * paper is; `dry`, layDeposit: its stamps' pressure, the tooth, a burnish), decided per deposit, `history` whether its
 * passage keeps the paper's wetness. Water and a lift act on it; paint lands in it only from a wet brush in a
 * 'wet-history' medium.
 */
export type StampDepositionLaw = 'wash' | 'dry';
export function stampDepositionLaw(
  deposit: { action: Pick<CompiledStampAction, 'kind'>; brush: Pick<StampBrush, 'media'> }, medium: PaintMedium | null, history: boolean,
): StampDepositionLaw {
  // A lift takes up what the paper holds through its wetness, even out of a wash: an eraser over crayon.
  if (deposit.action.kind === 'lift') return 'wash';
  if (!history) return 'dry';
  if (deposit.action.kind !== 'paint') return 'wash';
  // A dry brush skips the tooth wherever it's laid, a crayon in a wash too.
  return deposit.brush.media !== 'dry' && paintMediumCan(medium, 'wet-history') ? 'wash' : 'dry';
}

/** What the wash law lays a deposit by: its group's `medium`, and the `water` its brush carries. */
export type StampWashLaw = { medium: PaintMedium; water: number };

/**
 * What the wash law lays `deposit` (as written: a boil's epoch or live marks keep its brush and action) by, known
 * before any painting second is: null where it's laid dry (stampDepositionLaw), or where there's no medium.
 */
export function stampDepositWashLaw(deposit: CompiledStampDeposit, medium: PaintMedium | null, history: boolean, media: Pick<StampPaintMedia, 'waterOf'>): StampWashLaw | null {
  if (!medium || stampDepositionLaw(deposit, medium, history) !== 'wash') return null;
  return { medium, water: media.waterOf(deposit) };
}

/**
 * Where a wash brush's water stops on dry paper, as a share of the stroke's body: about where its tip lays a third of
 * it, so a soft tip's thin fringe goes and its shoulder fills to the body, never past it.
 */
export const STAMP_WET_WATER_EDGE = [0.15, 0.45] as const;

/** The landing's laws, each as its comment says; the renderer hardens a wash's coverage, the compositor lands its paint. */
export const STAMP_WET_LAND_WGSL = /* wgsl */ `
// The coverage a brush carrying \`water\` lands at where its stroke covers \`cover\` of its \`body\` nearby, on paper
// \`wetness\` wet: hardened to its water's edge as far as the paper is drier than the brush, at the body's density. A
// brush with no water (a lift, crayon) keeps its tip.
fn wetLandCover(cover: f32, body: f32, water: f32, wetness: f32) -> f32 {
  let level = max(body, cover);
  let hard = level * smoothstep(${STAMP_WET_WATER_EDGE[0].toFixed(3)}, ${STAMP_WET_WATER_EDGE[1].toFixed(3)}, cover / max(level, 1e-4));
  let drier = clamp(water - wetness, 0.0, 1.0) / max(water, 1e-3);
  return mix(cover, hard, drier);
}
// Four pigment amounts after \`incoming\` (a full stroke's) lands at \`cover\` over paint covering \`under\` of the pixel:
// as the dry law lands it where the paper isn't \`workable\` (toward \`incoming\`, less what the paint there picks up),
// adding where it is.
fn wetLand(was: vec4f, incoming: vec4f, cover: f32, under: f32, pickup: f32, workable: f32) -> vec4f {
  let dry = was + cover * (1.0 - pickup * under) * (incoming - was);
  let wet = was + cover * incoming;
  return mix(dry, wet, clamp(workable, 0.0, 1.0));
}
// A pixel's open share after a landing, mixed by amount: the paint it \`kept\`, \`open\` of it unset, and what it
// \`gained\`, all of it fresh. As 1 less the set share, so all-open paint stays exactly open in a half float.
fn wetLandOpen(open: f32, kept: f32, gained: f32) -> f32 {
  let total = kept + gained;
  return select(open, clamp(1.0 - (1.0 - open) * kept / total, 0.0, 1.0), total > 0.0);
}`;
