// type-slant.tsx: SlantWord, light type entering big and turned and levelling as it slants, its i's tittles drawn
// round on top so a scene can zoom through one. Its pose and transform are models/reel/type.ts's.

import { Fragment, useId, type ReactNode } from 'react';
import { applyAffine, type AffineMatrix, type Point } from '#models/camera/camera.ts';
import { useStudioFontsReady } from '../fonts.ts';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { H, W } from '#models/frame/frame.ts';
import { REEL_SHUTTER, shutterOpensAt, smearSigma } from '#models/motion/shutter.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import {
  labelAt, leftOf, SLANT_LABEL_IN, slantMatrix, slantWordPose, stemAt, TITTLE_ACROSS, TITTLE_HEIGHT, type Align, type Setting, type Tittle,
} from '#models/reel/type.ts';
import { faceStyle, layer, measureWord } from './type-measure.ts';
import { IndexLabel } from './type.tsx';

/**
 * Light type entering big and turned, levelling as it slants: the reference's "is". Scale settles on out-expo, turn on
 * a sine, slant last, over the second half of `slantDuration`. An i's tittle is a round dot riding the slant. Still
 * from the longest duration on. Defaults: caps 420 px (39% of frame height), Archivo 200.
 */
export function SlantWord({
  t, text, x = W / 2, y, cap = 420, color = '#464bf5', align = 'center', weight = 200, stretch = 100, spacing = 0,
  scale = 1.5, duration = 0.3, turn = -18, turnDuration = 0.12, slant = 15.5, slantFrom = 13, slantDuration = 0.17,
  label, labelColor = color, tittle, shutter = REEL_SHUTTER, motion,
}: {
  /** Seconds since it enters. */
  t: number;
  text: string;
  /** Where `align` puts the word, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  weight?: number;
  stretch?: number;
  spacing?: number;
  /** Its size on entering, settling to 1 over `duration`. */
  scale?: number;
  duration?: number;
  /** Degrees it enters turned (negative is anticlockwise), level after `turnDuration`. */
  turn?: number;
  turnDuration?: number;
  /** Degrees it leans forward at rest, and on entering. */
  slant?: number;
  slantFrom?: number;
  slantDuration?: number;
  /** An index label, e.g. "(03)", in at 0.08 s over the word's resting top left. */
  label?: string;
  labelColor?: string;
  /**
   * Draws in place of each i's tittle, given where the word has it: return a node to replace the dot, e.g.
   * `(dot) => t >= at && <FieldSwell from={dot} … />` to zoom through it into the next ground, or nothing to keep it.
   */
  tittle?: (dot: Tittle) => ReactNode;
  shutter?: number;
  motion?: string | false;
}) {
  const id = useId();
  const ready = useStudioFontsReady();
  if (!ready || t < 0) return null;
  const setting: Setting = { family: DISPLAY_FONT, cap, weight, stretch, spacing };
  // Set dotless, so each tittle can be drawn round on top of the slant and be a zoom's anchor.
  const shown = text.replaceAll('i', 'ı');
  const set = measureWord(shown, setting);
  const base = y ?? H / 2 + cap / 2;
  const left = leftOf(x, set.width, align);
  const origin = { x: left + set.width / 2, y: base - cap / 2 };
  const poseAt = (tt: number) => slantWordPose(tt, { scale, duration, turn, turnDuration, slant, slantFrom, slantDuration });
  const pose = poseAt(t), m = slantMatrix(origin, pose);
  // A zoom and a turn smear every way: the farthest-travelling corner sets one even blur, halved as the edges mostly
  // move along themselves. The shutter opens no earlier than the entrance.
  const open = shutterOpensAt(t, shutter, 0);
  const [m0, m1] = [slantMatrix(origin, poseAt(open)), slantMatrix(origin, poseAt(open + shutter))];
  const corners: Point[] = [{ x: left, y: base - cap }, { x: left + set.width, y: base - cap }, { x: left, y: base }, { x: left + set.width, y: base }];
  const travel = shutter > 0 ? Math.max(...corners.map((c) => {
    const p = applyAffine(m0, c), q = applyAffine(m1, c);
    return Math.hypot(q.x - p.x, q.y - p.y);
  })) : 0;
  const sigma = smearSigma(travel) / 2;
  const radius = (TITTLE_ACROSS / 2) * stemAt(weight) * set.size;
  const dotsAt = (mm: AffineMatrix, s: number) => set.chars.flatMap((c, i) => (text[i] === 'i'
    ? [{ ...applyAffine(mm, { x: left + c.x + (c.w - spacing * set.size) / 2, y: base - TITTLE_HEIGHT * set.size }), r: radius * s }]
    : []));
  const dots = dotsAt(m, pose.scale).map((d) => ({ ...d, swap: tittle?.(d) }));
  const swapped = (node: ReactNode) => node != null && node !== false;
  // The label sits by the word at rest, not riding its entrance: over the ink's top, by the slanted word's foot.
  const still = slantMatrix(origin, { scale: 1, turn: 0, slant });
  const inkTop = Math.min(base - cap, ...dotsAt(still, 1).map((d) => d.y - d.r));
  const foot = applyAffine(still, { x: left, y: base }).x + SLANT_LABEL_IN * set.size;
  return (
    <>
      <svg width={W} height={H} style={layer}>
        {sigma > 0.25 && (
          <filter id={`${id}-smear`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={sigma} />
          </filter>
        )}
        <g {...pieceMotionAttrs(motion, text, { kind: 'slant-word', values: pose })} filter={sigma > 0.25 ? `url(#${id}-smear)` : undefined} fill={color}>
          <text x={left} y={base} transform={`matrix(${m.join(' ')})`} style={{ ...faceStyle(setting, set.size), letterSpacing: `${spacing}em`, whiteSpace: 'pre' }}>
            {shown}
          </text>
          {dots.map((d, i) => !swapped(d.swap) && <circle key={i} cx={d.x} cy={d.y} r={d.r} />)}
        </g>
        {label && <IndexLabel text={label} {...labelAt({ x: foot, y: inkTop })} t={t - 0.08} color={labelColor} />}
      </svg>
      {dots.map((d, i) => swapped(d.swap) && <Fragment key={i}>{d.swap}</Fragment>)}
    </>
  );
}
