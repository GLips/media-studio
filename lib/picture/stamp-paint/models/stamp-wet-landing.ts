// stamp-wet-landing.ts: how a wash's paint lands, per pixel, as the paper is (stamp-wetness.ts): on dry, set paper as
// a plain pass's does (layDeposit); on wet paper its pigment adds; between, as workable as the paper is. A wash
// brush's water stops at a hard edge on dry paper, however soft its tip, and so does a flood's outside a wash, its
// paper dry. The laws are WGSL only: the renderer is where they run.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { StampBrush } from './stamp-brush.ts';

/**
 * Whether a flood laid outside a wash carries water, and so stops at a hard edge on the dry paper (wetLandCover).
 * A dry-media brush never does; any other does if its medium's brush holds water. Flat colour has no medium but
 * floods as wet paint, a flood being a wet application; its soft-edged fill is a strokes one.
 */
export function stampFloodCarriesWater(brush: Pick<StampBrush, 'media'>, medium: PaintMedium | null): boolean {
  return brush.media !== 'dry' && (!medium || medium.wetting.brushWater > 0);
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
