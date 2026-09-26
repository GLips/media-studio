// odometer-kit-stage.tsx: the Kit pieces stage for Odometer: a captioned number rolling from one value to another on
// the showcase ground, with how far along the roll is.
import { AbsoluteFill } from 'remotion';
import { lerp, motionCurves, seg } from '#models/motion/motion.ts';
import { MONO_FONT } from '#models/type/faces.ts';
import { Odometer, type OdometerMode } from '../../kit/kit.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, KitStageHud, useKitStageSeconds } from './kit-stage-clock.tsx';

export type OdometerKitFormat = 'plain' | 'dollars' | 'percent';
export type OdometerKitCurve = 'calm' | 'fast';

export type OdometerKitProps = {
  from: number; to: number; decimals: number; format: OdometerKitFormat; mode: OdometerMode; spin: number;
  duration: number; curve: OdometerKitCurve; punch: number; blur: number; fade: number;
};

export const ODOMETER_KIT_DEFAULTS: OdometerKitProps = {
  from: 0, to: 1299, decimals: 0, format: 'dollars', mode: 'direct', spin: 2, duration: 1.8, curve: 'calm', punch: 0, blur: 1, fade: 0.28,
};

export const odometerKitSeconds = (p: OdometerKitProps) => KIT_STAGE_LEAD + p.duration + 0.5 + KIT_STAGE_HOLD;

// No bouncy curve on offer: the Odometer's value is data, and a price that overshoots says a wrong number.
const ODOMETER_KIT_CURVES = { calm: motionCurves.cubic.entrance, fast: motionCurves.expo.entrance } as const;

const ODOMETER_KIT_CAPTIONS: Record<OdometerKitFormat, string> = { plain: 'ORDERS TODAY', dollars: 'REVENUE THIS MONTH', percent: 'SCORE' };

const ODOMETER_KIT_MODE_WORDS: Record<OdometerMode, string> = { mechanical: 'geared', direct: 'straight there', slot: 'slot machine' };

const odometerKitAffixes = (format: OdometerKitFormat): { prefix?: string; suffix?: string } =>
  ({ plain: {}, dollars: { prefix: '$' }, percent: { suffix: '%' } })[format];

export function OdometerKitStage(p: OdometerKitProps) {
  const t = useKitStageSeconds();
  const value = (at: number) => lerp(p.from, p.to, seg(at, 0, p.duration, ODOMETER_KIT_CURVES[p.curve]));
  const { prefix = '', suffix = '' } = odometerKitAffixes(p.format);
  const shown = `${prefix}${p.to.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })}${suffix}`;
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitStageHud left={`Rolling number · ${ODOMETER_KIT_MODE_WORDS[p.mode]}`}
        right={t >= p.duration ? `landed on ${shown}` : `rolling · ${Math.round(Math.max(0, t / p.duration) * 100)}% of the time`} />
      <div style={{ position: 'absolute', left: 160, right: 160, top: 330, textAlign: 'center', fontFamily: MONO_FONT, fontSize: 30, letterSpacing: '0.1em', color: LAB_COLORS.red }}>
        {ODOMETER_KIT_CAPTIONS[p.format]}
      </div>
      <Odometer t={t} value={value} x={960} y={640} size={250} align="center" color={LAB_COLORS.cream} decimals={p.decimals} prefix={prefix} suffix={suffix}
        mode={p.mode} spin={p.spin} punch={p.punch} blur={p.blur} fade={p.fade} />
    </AbsoluteFill>
  );
}
