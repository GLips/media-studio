// grade-kit-stage.tsx: the Kit pieces stage for FilmGrain and Vignette: a showreel title card with and without them,
// or split down the middle to compare.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { FilmGrain, Vignette } from '../../film/grade.tsx';
import { LAB_COLORS, LAB_FORMAT } from '../lab-format.ts';
import { KIT_STAGE_HUD_TYPE } from './kit-stage-clock.tsx';

export type GradeKitCompare = 'split' | 'with' | 'without';

export type GradeKitProps = { grain: number; grainScale: number; vignette: number; inner: number; compare: GradeKitCompare };

export const GRADE_KIT_DEFAULTS: GradeKitProps = { grain: 0.1, grainScale: 0.9, vignette: 0.45, inner: 0.5, compare: 'split' };

const GRADE_KIT_SECONDS = 5;

export const gradeKitSeconds = () => GRADE_KIT_SECONDS;

/** A showreel title card: heavy Archivo on the showcase red, with a soft gradient where banding would show. */
function GradeKitSampleShot() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = 1 + 0.04 * (frame / fps / GRADE_KIT_SECONDS);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 90% at 40% 45%, #f2653d 0%, ${LAB_COLORS.red} 45%, #a82f10 100%)` }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', transform: `scale(${push})` }}>
        <div style={{ ...KIT_STAGE_HUD_TYPE, fontSize: 30, color: LAB_COLORS.ink, marginBottom: 24 }}>MOTION SHOWCASE · 2026</div>
        <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 900, fontStretch: '72%', fontSize: 300, lineHeight: 0.86, color: LAB_COLORS.cream, textTransform: 'uppercase', letterSpacing: '-0.01em', textAlign: 'center', whiteSpace: 'nowrap' }}>Made<br />to move</div>
      </div>
    </AbsoluteFill>
  );
}

export function GradeKitStage(p: GradeKitProps) {
  const graded = (
    <>
      <GradeKitSampleShot />
      <FilmGrain amount={p.grain} scale={p.grainScale} />
      <Vignette amount={p.vignette} inner={p.inner} />
    </>
  );
  if (p.compare === 'with') return <AbsoluteFill>{graded}</AbsoluteFill>;
  if (p.compare === 'without') return <AbsoluteFill><GradeKitSampleShot /></AbsoluteFill>;
  return (
    <AbsoluteFill>
      <GradeKitSampleShot />
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${LAB_FORMAT.width / 2}px)` }}>{graded}</AbsoluteFill>
      <div style={{ position: 'absolute', left: LAB_FORMAT.width / 2 - 2, top: 0, width: 4, height: '100%', background: LAB_COLORS.cream, opacity: 0.8 }} />
      <div style={{ ...KIT_STAGE_HUD_TYPE, position: 'absolute', left: 60, top: 50, color: LAB_COLORS.cream }}>Without</div>
      <div style={{ ...KIT_STAGE_HUD_TYPE, position: 'absolute', right: 60, top: 50, color: LAB_COLORS.cream }}>With grain + vignette</div>
    </AbsoluteFill>
  );
}
