// stamp-gate-paper-diorama-page.ts: the gate page's paper diorama (stamp-gate-paper-diorama.ts): its pop-up built by
// paintedThreePopUp in the diorama's look, drawn through the shot's renderer with its painted prints.

import { paintedThreePopUp } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
import { STAMP_GATE_PAPER_DIORAMA_LIGHT, STAMP_GATE_PAPER_DIORAMA_POP_UP, stampGatePaperDioramaShot } from '../models/stamp-gate-paper-diorama.ts';
import { stampGateRgbBase64 } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** The paper diorama's baseline, its one frame: RGB bytes row by row, in base64. */
export async function paintStampGatePaperDiorama(): Promise<string> {
  const { leak, lights } = STAMP_GATE_PAPER_DIORAMA_LIGHT;
  const { frames: [rgba] } = await stampGateShotFrames(stampGatePaperDioramaShot(paintedThreePopUp(STAMP_GATE_PAPER_DIORAMA_POP_UP, { leak, lights })), [0]);
  return stampGateRgbBase64(rgba);
}
