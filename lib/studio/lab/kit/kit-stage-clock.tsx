// kit-stage-clock.tsx: what every Kit pieces stage shares: the empty lead before a piece starts, the hold after it
// finishes, and the HUD line across its top.
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { MONO_FONT } from '#models/type/faces.ts';
import { LAB_COLORS } from '../lab-format.ts';

/** Seconds of empty stage before a piece starts, so its first frame is seen. */
export const KIT_STAGE_LEAD = 0.5;
/** Seconds a finished piece holds before the loop restarts. */
export const KIT_STAGE_HOLD = 1.6;

/** The HUD's type, in frame pixels. */
export const KIT_STAGE_HUD_TYPE = { fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', textTransform: 'uppercase' } as const;

/** Seconds since the piece started: negative through the lead. */
export const useKitStageSeconds = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps - KIT_STAGE_LEAD;
};

/** A stage's readout across its top: what's playing on the left, how far along on the right. */
export function KitStageHud({ left, right }: { left: string; right?: string }) {
  return (
    <div style={{ ...KIT_STAGE_HUD_TYPE, position: 'absolute', left: 120, right: 120, top: 56, display: 'flex', justifyContent: 'space-between', color: LAB_COLORS.dim }}>
      <span>{left}</span>
      {right && <span>{right}</span>}
    </div>
  );
}
