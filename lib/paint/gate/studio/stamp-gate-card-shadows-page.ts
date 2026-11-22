// stamp-gate-card-shadows-page.ts: the gate page's cards catching the light (stamp-gate-card-shadows.ts), drawn
// through the shot's renderer: lit and flat at rest, midway and at the end, and lit with the nest's rim off at rest.

import { checkStampGateCardShadows, STAMP_GATE_CARD_SHADOWS_AT, stampGateCardShadowsShot } from '../models/stamp-gate-card-shadows.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** The three checked frames of the cards painted as `painted` says, RGB bytes. */
async function framesOf(painted: Parameters<typeof stampGateCardShadowsShot>[0]) {
  const { rest, mid, end } = STAMP_GATE_CARD_SHADOWS_AT, { frames } = await stampGateShotFrames(stampGateCardShadowsShot(painted), [rest, mid, end]);
  return [stampGateRgb(frames[0]), stampGateRgb(frames[1]), stampGateRgb(frames[2])] as const;
}

/** The lit cards' checks. */
export async function checkStampGateCardShadowsCase(): Promise<StampGateWashCheck[]> {
  const lit = await framesOf({}), flat = await framesOf({ lit: false }), [nestRimOff] = await framesOf({ nestRim: false });
  return checkStampGateCardShadows({ lit, flat, nestRimOff });
}
