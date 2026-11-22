// letter-drop.tsx: DropWord, a word whose letters drop onto the baseline one after another, each squashing about its
// own foot on landing and springing back up, as the bouncing ball does (models/letter-drop.ts).

import { useStudioFontsReady } from '#lib/picture/type/studio/fonts.ts';
import { DISPLAY_FONT } from '#lib/picture/type/models/faces.ts';
import { clamp } from '#lib/picture/motion/models/motion.ts';
import { strainCssMatrix } from '#lib/picture/motion/models/strain.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { pieceMotionAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { leftOf, type Align, type Setting } from '../models/type.ts';
import { letterDropAt, letterDropDuration, type LetterDropOptions } from '../models/letter-drop.ts';
import { faceStyle, layer, measureWord } from './type-measure.ts';

/**
 * Letters dropping onto a baseline one after another, `each` apart: each falls `drop` caps stretched along its speed,
 * squashes `squash`:1 about its foot, hops `rebound` of its fall and settles. Still from (letters − 1) × each plus one
 * letter's drop on. Defaults: caps 300 px (28% of frame height), Archivo Black.
 */
export function DropWord({
  t, text, x: givenX, y, cap = 300, color = '#15090c', align = 'center', weight = 900, stretch = 100, spacing = -0.01,
  each = 0.06, drop = 1.6, fall = 0.32, contact = 0.12, landingStretch = 1.4, squash = 1.9, rebound = 0.08, motion,
}: {
  /** Seconds since the first letter starts to fall. */
  t: number;
  text: string;
  /** Where `align` puts the word, and its baseline. The default centres the caps in the frame. */
  x?: number;
  y?: number;
  cap?: number;
  color?: string;
  align?: Align;
  weight?: number;
  /** Archivo's width axis, in percent. */
  stretch?: number;
  spacing?: number;
  /** Seconds between one letter's start and the next's (a space takes no turn). */
  each?: number;
  /** How far a letter falls, in caps. */
  drop?: number;
  /** Seconds a letter falls for, and each landing's squash lasts. */
  fall?: number;
  contact?: number;
  /** A letter's aspect at touch-down, and at its deepest squash. */
  landingStretch?: number;
  squash?: number;
  /** The hop's height as a share of the fall; 0 lands once. */
  rebound?: number;
  motion?: string | false;
}) {
  const ready = useStudioFontsReady();
  const { width, height } = useVideoFormat(), x = givenX ?? width / 2;
  if (!ready || t < 0) return null;
  const setting: Setting = { family: DISPLAY_FONT, cap, weight, stretch, spacing };
  const set = measureWord(text, setting), face = faceStyle(setting, set.size);
  const base = y ?? height / 2 + cap / 2, left = leftOf(x, set.width, align);
  const options: LetterDropOptions = { height: drop * cap, fall, contact, landingStretch, squash, rebound };
  const one = letterDropDuration(options), count = set.chars.filter((c) => c.char.trim()).length;
  let turns = 0;
  const letters = set.chars.flatMap((c, i) => {
    if (!c.char.trim()) return [];
    const turn = turns++, since = t - turn * each;
    if (since < 0) return [];
    const pose = letterDropAt(since, options), foot = { x: left + c.x + c.w / 2, y: base - pose.lift };
    return [{ i, turn, since, char: c.char, x: left + c.x, foot, strain: pose.strain }];
  });
  const settled = Math.max(0, count - 1) * each + one;
  return (
    <svg width={width} height={height} style={layer}>
      <g {...pieceMotionAttrs(motion, text, { kind: 'drop-word', values: { k: clamp(t / settled) } })} fill={color}>
        {letters.map((c) => (
          <text
            key={c.i}
            {...(motion === false ? {} : pieceMotionAttrs(undefined, `${c.turn} ${c.char}`, {
              kind: 'letter', values: { k: clamp(c.since / one) }, stagger: { group: 'letters', index: c.turn, count },
            }))}
            x={c.x}
            y={c.foot.y}
            transform={strainCssMatrix(c.strain, c.foot)}
            style={face}
          >
            {c.char}
          </text>
        ))}
      </g>
    </svg>
  );
}
