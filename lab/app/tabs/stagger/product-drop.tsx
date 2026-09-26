// product-drop.tsx: the stagger tab's comparison stage: one product page entering two ways. `everything` starts
// every piece at the same moment with its own big move; `hero` gives the product the one big move and lets the
// rest follow it in a quick, quiet stagger. `StaggerProductDropPair` shows both halves in one composition so they
// loop on the same clock.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { lerp, motionCurves, motionDurations, seg, stagger } from '#models/motion/motion.ts';
import { LAB_COLORS, LAB_FORMAT } from '../../ui.tsx';

export type StaggerProductDropProps = { mode: 'everything' | 'hero'; headStart: number; each: number };
export type StaggerProductDropPairProps = Omit<StaggerProductDropProps, 'mode'>;

export const STAGGER_PRODUCT_DROP_SECONDS = 4.2;

const START = 0.4;
const TILES = [
  { name: 'Cobalt', hex: '#4144f4', price: '$18' }, { name: 'Bone', hex: '#f3f0e7', price: '$16' },
  { name: 'Ochre', hex: '#d99a2b', price: '$18' }, { name: 'Teal', hex: '#1f8a86', price: '$20' },
  { name: 'Oxblood', hex: '#7a1f2b', price: '$18' }, { name: 'Lilac', hex: '#b39ddb', price: '$16' },
] as const;

// Each supporting piece's big move when everything goes at once: a different direction apiece, as a page does
// when every element was animated on its own.
const CHAOS_FROM: readonly [number, number, number][] = [
  [0, -160, 0], [-420, 0, -12], [0, 380, 8], [460, 0, 10], [-300, 300, -8], [0, -340, 14], [380, 260, -10], [0, 220, 0],
];

export function StaggerProductDrop({ mode, headStart, each }: StaggerProductDropProps) {
  const { fps, durationInFrames } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const loopOut = seg(t, end - 0.2 - motionDurations.exit, end - 0.2, motionCurves.dissolve);
  const together = mode === 'everything';

  // Supporting pieces, nearest the hero first: the button under it, the nav above, then the tiles left to right.
  const supportCount = TILES.length + 2;
  const supportStart = (i: number) => together ? START : START + headStart + stagger(i, supportCount, { each, fps });

  const heroK = seg(t, START, START + motionDurations.enter.large, motionCurves.expressive.entrance);
  const hero = {
    opacity: seg(t, START, START + 0.3, motionCurves.dissolve),
    transform: together
      ? `translate(${lerp(-500, 0, heroK)}px, ${lerp(200, 0, heroK)}px) rotate(${lerp(-18, 0, heroK)}deg) scale(${lerp(0.5, 1, heroK)})`
      : `translateY(${lerp(90, 0, heroK)}px) scale(${lerp(0.86, 1, heroK)})`,
  };

  const support = (i: number) => {
    const a = supportStart(i);
    if (together) {
      const k = seg(t, a, a + motionDurations.enter.large, motionCurves.expressive.entrance);
      const [dx, dy, r] = CHAOS_FROM[i];
      return {
        opacity: seg(t, a, a + 0.3, motionCurves.dissolve),
        transform: `translate(${lerp(dx, 0, k)}px, ${lerp(dy, 0, k)}px) rotate(${lerp(r, 0, k)}deg) scale(${lerp(0.7, 1, k)})`,
      };
    }
    const k = seg(t, a, a + motionDurations.enter.small, motionCurves.productive.entrance);
    return { opacity: seg(t, a, a + 0.25, motionCurves.dissolve), transform: `translateY(${lerp(36, 0, k)}px)` };
  };

  const mono = { fontFamily: MONO_FONT, letterSpacing: '0.06em', color: LAB_COLORS.dim } as const;
  const gap = 28, gridLeft = 1000, gridTop = 210, tileW = (830 - gap) / 2, tileH = (780 - 2 * gap) / 3;

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, fontFamily: DISPLAY_FONT, color: LAB_COLORS.cream, overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: 1 - loopOut }}>
      <div style={{ ...support(1), position: 'absolute', left: 90, right: 90, top: 60, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${LAB_COLORS.line}` }}>
        <span style={{ fontSize: 46, fontWeight: 900, fontStretch: '75%' }}>INKWELL</span>
        <span style={{ ...mono, fontSize: 26 }}>INKS · PENS · PAPER · BAG (1)</span>
      </div>

      <div style={{ ...hero, position: 'absolute', left: 90, top: 210, width: 820, height: 780, background: LAB_COLORS.panel, borderRadius: 28, overflow: 'hidden', border: `1px solid ${LAB_COLORS.line}` }}>
        <div style={{ height: 500, background: LAB_COLORS.red, position: 'relative' }}>
          <span style={{ ...mono, color: LAB_COLORS.ink, position: 'absolute', left: 36, top: 30, fontSize: 26 }}>NEW · NO. 07</span>
        </div>
        <div style={{ padding: '30px 36px' }}>
          <div style={{ fontSize: 96, fontWeight: 900, fontStretch: '72%', lineHeight: 0.95 }}>VERMILION</div>
          <div style={{ ...mono, fontSize: 28, marginTop: 14 }}>50 ML · PIGMENT INK · $22</div>
        </div>
      </div>

      <div style={{ ...support(0), position: 'absolute', left: 580, top: 900, width: 300, height: 70, borderRadius: 35, background: LAB_COLORS.cream, color: LAB_COLORS.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800 }}>
        Add to bag
      </div>

      {TILES.map((tile, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        return (
          <div key={tile.name} style={{
            ...support(i + 2), position: 'absolute',
            left: gridLeft + col * (tileW + gap), top: gridTop + row * (tileH + gap), width: tileW, height: tileH,
            background: LAB_COLORS.panel, borderRadius: 20, overflow: 'hidden', border: `1px solid ${LAB_COLORS.line}`, display: 'flex',
          }}>
            <div style={{ width: 140, flexShrink: 0, background: tile.hex }} />
            <div style={{ padding: '26px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 40, fontWeight: 800, fontStretch: '78%', textTransform: 'uppercase', lineHeight: 1 }}>{tile.name}</div>
              <div style={{ ...mono, fontSize: 24 }}>50 ML · {tile.price}</div>
            </div>
          </div>
        );
      })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

const PAIR_GAP = 80;
const PAIR_LABEL_BAND = 120;
export const STAGGER_PRODUCT_DROP_PAIR_SIZE = { width: LAB_FORMAT.width * 2 + PAIR_GAP, height: LAB_FORMAT.height + PAIR_LABEL_BAND };

/** Both entrances side by side, each a full 1920×1080 page under its own caption. */
export function StaggerProductDropPair({ headStart, each }: StaggerProductDropPairProps) {
  const halves = [
    { mode: 'everything', caption: 'EVERYTHING AT ONCE' },
    { mode: 'hero', caption: 'ONE HERO LEADS' },
  ] as const;
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      {halves.map(({ mode, caption }, i) => (
        <div key={mode} style={{ position: 'absolute', left: i * (LAB_FORMAT.width + PAIR_GAP), top: 0, width: LAB_FORMAT.width, height: LAB_FORMAT.height + PAIR_LABEL_BAND }}>
          <div style={{ fontFamily: MONO_FONT, fontSize: 48, letterSpacing: '0.08em', color: i === 0 ? LAB_COLORS.dim : LAB_COLORS.cream, height: PAIR_LABEL_BAND, display: 'flex', alignItems: 'center', paddingLeft: 90 }}>
            {caption}
          </div>
          <div style={{ position: 'absolute', left: 0, top: PAIR_LABEL_BAND, width: LAB_FORMAT.width, height: LAB_FORMAT.height, borderRadius: 24, overflow: 'hidden', border: `2px solid ${LAB_COLORS.line}` }}>
            <StaggerProductDrop mode={mode} headStart={headStart} each={each} />
          </div>
        </div>
      ))}
    </AbsoluteFill>
  );
}
