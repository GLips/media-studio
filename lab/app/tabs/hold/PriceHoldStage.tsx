// PriceHoldStage.tsx: the hold tab's composition. The top two-thirds is the scene the check judges (a price card that
// slides in and should then sit still); the strip underneath plots the card's position and opacity over the whole
// scene, with the stretch the check found steady and the length the scene promised, and a playhead.
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '../../../../lib/studio/fonts.ts';
import { FPS } from '../../../../lib/studio/frame.ts';
import { LAB_COLORS } from '../../ui.tsx';
import { PRICE_HOLD_FRAMES, PRICE_HOLD_SECONDS, PRICE_REST, priceBoxAt, type PriceHoldParams, type SecondsSpan } from './price-hold.ts';

export type PriceHoldStageProps = PriceHoldParams & { steady: SecondsSpan | null; pass: boolean };

const PLOT = { left: 210, right: 1800, posTop: 740, posBottom: 900, opTop: 945, opBottom: 1025 };
// The slide-in covers hundreds of pixels; a shake worth failing over is a few. The lane shows ±10px and clips the rest.
const POS_RANGE_PX = 10;
const VISIBLE_OPACITY = 0.95;

const tx = (t: number) => PLOT.left + (t / PRICE_HOLD_SECONDS) * (PLOT.right - PLOT.left);
const posY = (off: number) => {
  const mid = (PLOT.posTop + PLOT.posBottom) / 2, half = (PLOT.posBottom - PLOT.posTop) / 2;
  return mid - (Math.max(-POS_RANGE_PX, Math.min(POS_RANGE_PX, off)) / POS_RANGE_PX) * half;
};
const opY = (o: number) => PLOT.opBottom - o * (PLOT.opBottom - PLOT.opTop);

const hud = { fontFamily: MONO_FONT, fontSize: 26, letterSpacing: '0.08em', textTransform: 'uppercase' } as const;

export function PriceHoldStage(props: PriceHoldStageProps) {
  const frame = useCurrentFrame();
  const { steady, pass, need } = props;
  const boxes = useMemo(() => Array.from({ length: PRICE_HOLD_FRAMES }, (_, f) => priceBoxAt(f, props)), [props]);
  const box = boxes[frame];
  const t = frame / FPS;
  const inSteady = steady !== null && t >= steady.from && t < steady.to;
  const verdictColor = pass ? LAB_COLORS.pass : LAB_COLORS.red;

  const path = (value: (b: NonNullable<typeof box>) => number) =>
    boxes.map((b, f) => (b ? `${boxes[f - 1] ? 'L' : 'M'}${tx(f / FPS).toFixed(1)},${value(b).toFixed(1)}` : '')).join('');
  // The promised length, laid from where the steady stretch starts: it fits inside the band when the hold is kept.
  const needFrom = steady?.from ?? 0, needTo = Math.min(PRICE_HOLD_SECONDS, needFrom + need);

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${LAB_COLORS.line} 1.5px, transparent 1.5px)`, backgroundSize: '48px 48px', opacity: 0.6 }} />

      {box && (
        <div style={{ position: 'absolute', left: box.x - box.w / 2, top: box.y - box.h / 2, width: box.w, height: box.h, opacity: box.opacity }}>
          <div style={{ position: 'absolute', inset: 0, background: LAB_COLORS.cream, color: LAB_COLORS.ink, borderRadius: 18, padding: '34px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <span style={{ ...hud, fontSize: 24, color: LAB_COLORS.cobalt, fontWeight: 700 }}>Pro plan — billed yearly</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
              <span style={{ fontFamily: DISPLAY_FONT, fontSize: 168, fontWeight: 900, fontStretch: '78%', lineHeight: 0.85, letterSpacing: '-0.02em' }}>$24</span>
              <span style={{ fontFamily: DISPLAY_FONT, fontSize: 44, fontWeight: 600, color: '#5a5550' }}>/ month</span>
            </div>
          </div>
          {/* What the probe measures: the tagged element's box, labelled with its motion name. */}
          <div style={{ position: 'absolute', inset: -14, border: `2px dashed ${inSteady ? LAB_COLORS.pass : LAB_COLORS.dim}`, borderRadius: 26 }} />
          <span style={{ ...hud, position: 'absolute', top: -52, left: -14, color: inSteady ? LAB_COLORS.pass : LAB_COLORS.dim }}>
            price · {inSteady ? 'steady' : 'not steady'}
          </span>
        </div>
      )}

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <line x1={0} x2={1920} y1={664} y2={664} stroke={LAB_COLORS.line} strokeWidth={2} />
        {steady && (
          <g>
            <rect x={tx(steady.from)} y={PLOT.posTop - 10} width={tx(steady.to) - tx(steady.from)} height={PLOT.opBottom - PLOT.posTop + 20} fill={LAB_COLORS.pass} opacity={0.14} />
            <text x={tx(steady.from) + 10} y={PLOT.posTop + 26} fill={LAB_COLORS.pass} style={{ ...hud, fontSize: 26 }}>
              steady {(steady.to - steady.from).toFixed(2)}s
            </text>
          </g>
        )}
        <g>
          <line x1={tx(needFrom)} x2={tx(needTo)} y1={718} y2={718} stroke={verdictColor} strokeWidth={6} />
          <line x1={tx(needFrom)} x2={tx(needFrom)} y1={708} y2={728} stroke={verdictColor} strokeWidth={3} />
          <line x1={tx(needTo)} x2={tx(needTo)} y1={708} y2={728} stroke={verdictColor} strokeWidth={3} />
          <text x={tx(needFrom)} y={702} fill={verdictColor} style={{ ...hud, fontSize: 24 }}>promised {need}s</text>
        </g>

        <line x1={PLOT.left} x2={PLOT.right} y1={posY(0)} y2={posY(0)} stroke={LAB_COLORS.line} strokeWidth={2} />
        <text x={PLOT.left - 16} y={posY(0) + 6} textAnchor="end" fill={LAB_COLORS.dim} style={hud}>rest</text>
        <text x={PLOT.left - 16} y={posY(POS_RANGE_PX) + 14} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>+{POS_RANGE_PX}px</text>
        <text x={PLOT.left - 16} y={posY(-POS_RANGE_PX)} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>−{POS_RANGE_PX}px</text>
        <path d={path((b) => posY(b.y - PRICE_REST.y))} fill="none" stroke={LAB_COLORS.cobalt} strokeWidth={3} />
        <path d={path((b) => posY(b.x - PRICE_REST.x))} fill="none" stroke={LAB_COLORS.cream} strokeWidth={3} />

        <line x1={PLOT.left} x2={PLOT.right} y1={opY(VISIBLE_OPACITY)} y2={opY(VISIBLE_OPACITY)} stroke={LAB_COLORS.dim} strokeWidth={2} strokeDasharray="8 8" />
        <text x={PLOT.left - 16} y={opY(VISIBLE_OPACITY) + 6} textAnchor="end" fill={LAB_COLORS.dim} style={hud}>95%</text>
        <text x={PLOT.left - 16} y={PLOT.opBottom} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>opacity</text>
        <path d={path((b) => opY(b.opacity))} fill="none" stroke={LAB_COLORS.red} strokeWidth={3} />

        <text x={PLOT.right} y={1066} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>
          <tspan fill={LAB_COLORS.cream}>━ left-right</tspan>   <tspan fill={LAB_COLORS.cobalt}>━ up-down</tspan>   <tspan fill={LAB_COLORS.red}>━ opacity</tspan>
        </text>
        <text x={PLOT.left} y={1066} fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>0s</text>

        <line x1={tx(t)} x2={tx(t)} y1={PLOT.posTop - 14} y2={PLOT.opBottom + 8} stroke={LAB_COLORS.cream} strokeWidth={2} opacity={0.7} />
      </svg>
    </AbsoluteFill>
  );
}
