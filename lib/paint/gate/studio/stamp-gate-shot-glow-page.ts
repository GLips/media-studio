// stamp-gate-shot-glow-page.ts: the gate page's glowing shot (stamp-gate-shot-glow.ts), drawn through the shot's
// renderer (stamp-gate-shot-frames.ts): the lamp's glass, its faint disc and the night's warm streak each glowing
// alone, against the shot glowing nowhere and the shot without its disc; and the glass's glow pulsing in time.

import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  checkStampGateShotGlow, STAMP_GATE_GLOW_PULSE_AT, STAMP_GATE_LAMP_GLOW, STAMP_GATE_LAMP_PULSE, STAMP_GATE_STREAK_GLOW, stampGateGlowShot, type StampGateGlowFrames,
  type StampGateGlowing,
} from '../models/stamp-gate-shot-glow.ts';
import { stampGateRgb } from './stamp-gate-page-surface.ts';
import { stampGateShotFrames } from './stamp-gate-shot-frames.ts';

/** The glowing shot's one frame, RGB bytes, `glowing` as given, the disc shown unless `disc` is false. */
async function glowFrame(glowing: StampGateGlowing, disc = true): Promise<Uint8ClampedArray> {
  const { frames: [rgba] } = await stampGateShotFrames(stampGateGlowShot(glowing, { disc }), [0]);
  return stampGateRgb(rgba);
}

/** The glowing shot's checks. */
export async function checkStampGateShotGlowCase(): Promise<StampGateWashCheck[]> {
  const { dark, half, full } = STAMP_GATE_GLOW_PULSE_AT;
  const { frames: [pulseDark, pulseHalf, pulseFull] } = await stampGateShotFrames(stampGateGlowShot({ glass: STAMP_GATE_LAMP_PULSE }), [dark, half, full]);
  const frames: StampGateGlowFrames = {
    plain: await glowFrame({}),
    glass: await glowFrame({ glass: STAMP_GATE_LAMP_GLOW }),
    disc: await glowFrame({ disc: STAMP_GATE_LAMP_GLOW }),
    discAll: await glowFrame({ disc: { ...STAMP_GATE_LAMP_GLOW, threshold: 0 } }),
    noDisc: await glowFrame({}, false),
    streak: await glowFrame({ streak: STAMP_GATE_STREAK_GLOW }),
    pulseDark: stampGateRgb(pulseDark), pulseHalf: stampGateRgb(pulseHalf), pulseFull: stampGateRgb(pulseFull),
  };
  return checkStampGateShotGlow(frames);
}
