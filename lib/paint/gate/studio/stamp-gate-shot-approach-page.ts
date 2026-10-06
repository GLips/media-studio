// stamp-gate-shot-approach-page.ts: the gate page's approaching kite (stamp-gate-shot-approach.ts), drawn through the
// shot's renderer (stamp-gate-shot-frames.ts): the kite flying, held at its depth, and each of it and the post left
// out, shut at two seconds either side of its passing the post; and the kite flying, held and left out, the shutter
// open, after it.

import type { StampGateShot } from '../models/stamp-gate-shot-span.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { checkStampGateShotApproach, STAMP_GATE_APPROACH, stampGateApproachShot, type StampGateApproachFrames } from '../models/stamp-gate-shot-approach.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** `shot`'s frame at scene second `at`, RGB bytes. */
const frameAt = async (shot: StampGateShot, at: number) => stampGateRgb((await stampGateShotFrames(shot, [at])).frames[0]);

/** The approach's shut frames at scene second `at`. */
async function shutFrames(at: number): Promise<StampGateApproachFrames> {
  return {
    flying: await frameAt(stampGateApproachShot({ shut: true }), at),
    held: await frameAt(stampGateApproachShot({ kite: { held: at }, shut: true }), at),
    noKite: await frameAt(stampGateApproachShot({ kite: null, shut: true }), at),
    noPost: await frameAt(stampGateApproachShot({ post: false, shut: true }), at),
  };
}

/** The approaching kite's checks. */
export async function checkStampGateShotApproachCase(): Promise<StampGateWashCheck[]> {
  const { behind, past } = STAMP_GATE_APPROACH.at;
  const open = {
    flying: await frameAt(stampGateApproachShot(), past), held: await frameAt(stampGateApproachShot({ kite: { held: past } }), past),
    noKite: await frameAt(stampGateApproachShot({ kite: null }), past),
  };
  return checkStampGateShotApproach({ behind: await shutFrames(behind), past: await shutFrames(past), open });
}
