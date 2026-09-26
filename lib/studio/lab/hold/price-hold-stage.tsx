// price-hold-stage.tsx: the hold tab's composition. The top is the scene the check judges (a price card that slides in
// and should then sit still), with a magnified crop of the card's corner beside it so a 2px shake is plain to see; the
// strip underneath plots the card's position and opacity over the whole scene, with the stretch the check found
// steady, the length the scene promised, and a playhead.
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { HoldSteadySpan } from '#models/motion/hold-check.ts';
import { PRICE_HOLD_SECONDS, PRICE_REST, priceBoxFrames, type PriceBox, type PriceHoldParams } from '#models/lab/hold-price.ts';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { LAB_COLORS } from '../lab-format.ts';

export type PriceHoldStageProps = PriceHoldParams & { steady: HoldSteadySpan | null; pass: boolean };

const PLOT = { left: 210, right: 1800, posTop: 724, posBottom: 852, opTop: 880, opBottom: 1030 };
// The slide-in covers hundreds of pixels; a shake worth failing over is a few. The lane shows ±10px and clips the rest.
const POS_RANGE_PX = 10;
const VISIBLE_OPACITY = 0.95;
// Everything that matters to the check happens between 70% and fully solid, so the opacity lane and meter show only
// that range; with the whole 0–100% an 85% card sits almost on the 95% line.
const OPACITY_FLOOR = 0.7;

// The inset: a crop of the card's top-left corner at its resting place, magnified so a pixel is INSET_ZOOM wide. It's
// centred on the middle of the rounded corner, so both edges and the curve between them are in view.
const INSET_ZOOM = 12;
const INSET = { x: 50, y: 118, w: 480, h: 420 };
const CARD_RADIUS = 18;
const CORNER = { x: PRICE_REST.x - PRICE_REST.w / 2, y: PRICE_REST.y - PRICE_REST.h / 2 };
const ARC_MID = CARD_RADIUS * (1 - Math.SQRT1_2);
const CROP = { x: CORNER.x + ARC_MID - INSET.w / INSET_ZOOM / 2, y: CORNER.y + ARC_MID - INSET.h / INSET_ZOOM / 2 };
const METER = { x: INSET.x, y: 592, w: INSET.w, h: 18 };

const tx = (t: number) => PLOT.left + (t / PRICE_HOLD_SECONDS) * (PLOT.right - PLOT.left);
const posY = (off: number) => {
  const mid = (PLOT.posTop + PLOT.posBottom) / 2, half = (PLOT.posBottom - PLOT.posTop) / 2;
  return mid - (Math.max(-POS_RANGE_PX, Math.min(POS_RANGE_PX, off)) / POS_RANGE_PX) * half;
};
const opShare = (o: number) => (Math.max(OPACITY_FLOOR, o) - OPACITY_FLOOR) / (1 - OPACITY_FLOOR);
const opY = (o: number) => PLOT.opBottom - opShare(o) * (PLOT.opBottom - PLOT.opTop);

const hud = { fontFamily: MONO_FONT, fontSize: 26, letterSpacing: '0.08em', textTransform: 'uppercase' } as const;

/** The card's corner, magnified, over its fixed resting outline and a ruler as long as "still" allows. */
function PriceCornerInset({ box, within, inSteady }: { box: PriceBox | undefined | null; within: number; inSteady: boolean }) {
  const ix = (x: number) => INSET.x + (x - CROP.x) * INSET_ZOOM;
  const iy = (y: number) => INSET.y + (y - CROP.y) * INSET_ZOOM;
  const ruler = { x: INSET.x + 24, y: INSET.y + 34 };
  const frameColor = inSteady ? LAB_COLORS.pass : LAB_COLORS.dim;
  const opacity = box?.opacity ?? 0;
  return (
    <g>
      <text x={INSET.x} y={INSET.y - 18} fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>corner, zoomed {INSET_ZOOM}×</text>
      <clipPath id="price-inset-clip"><rect x={INSET.x} y={INSET.y} width={INSET.w} height={INSET.h} /></clipPath>
      <g clipPath="url(#price-inset-clip)">
        <rect x={INSET.x} y={INSET.y} width={INSET.w} height={INSET.h} fill="#060607" />
        {box && (
          <rect x={ix(box.x - box.w / 2)} y={iy(box.y - box.h / 2)} width={box.w * INSET_ZOOM} height={box.h * INSET_ZOOM}
            rx={CARD_RADIUS * INSET_ZOOM} fill={LAB_COLORS.cream} opacity={box.opacity} />
        )}
        <rect x={ix(CORNER.x)} y={iy(CORNER.y)} width={PRICE_REST.w * INSET_ZOOM} height={PRICE_REST.h * INSET_ZOOM} rx={CARD_RADIUS * INSET_ZOOM}
          fill="none" stroke={LAB_COLORS.cobalt} strokeWidth={4} strokeDasharray="12 10" />
        <text x={INSET.x + INSET.w - 16} y={INSET.y + 36} textAnchor="end" fill={LAB_COLORS.cobalt} style={{ ...hud, fontSize: 22 }}>where it comes to rest</text>
        {/* A ruler as long as the movement that still counts as still. */}
        <g stroke={LAB_COLORS.red} strokeWidth={4}>
          <line x1={ruler.x} x2={ruler.x + within * INSET_ZOOM} y1={ruler.y} y2={ruler.y} />
          <line x1={ruler.x} x2={ruler.x} y1={ruler.y - 12} y2={ruler.y + 12} />
          <line x1={ruler.x + within * INSET_ZOOM} x2={ruler.x + within * INSET_ZOOM} y1={ruler.y - 12} y2={ruler.y + 12} />
        </g>
        <text x={ruler.x} y={ruler.y + 40} fill={LAB_COLORS.red} style={{ ...hud, fontSize: 28 }}>{within}px = still</text>
      </g>
      <rect x={INSET.x} y={INSET.y} width={INSET.w} height={INSET.h} fill="none" stroke={frameColor} strokeWidth={3} />

      <text x={METER.x} y={METER.y - 12} fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 22 }}>
        solid <tspan fill={opacity >= VISIBLE_OPACITY ? LAB_COLORS.pass : LAB_COLORS.red}>{Math.round(opacity * 100)}%</tspan> · needs 95%
      </text>
      <rect x={METER.x} y={METER.y} width={METER.w} height={METER.h} fill={LAB_COLORS.line} />
      <rect x={METER.x} y={METER.y} width={METER.w * opShare(opacity)} height={METER.h} fill={opacity >= VISIBLE_OPACITY ? LAB_COLORS.pass : LAB_COLORS.red} />
      <line x1={METER.x + METER.w * opShare(VISIBLE_OPACITY)} x2={METER.x + METER.w * opShare(VISIBLE_OPACITY)} y1={METER.y - 6} y2={METER.y + METER.h + 6} stroke={LAB_COLORS.cream} strokeWidth={3} />
      <text x={METER.x} y={METER.y + METER.h + 26} fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 18 }}>70%</text>
      <text x={METER.x + METER.w} y={METER.y + METER.h + 26} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 18 }}>100%</text>
    </g>
  );
}

export function PriceHoldStage(props: PriceHoldStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { steady, pass, need, within } = props;
  const boxes = useMemo(() => priceBoxFrames(props, fps), [props, fps]);
  const box = boxes[frame];
  const t = frame / fps;
  const inSteady = steady !== null && t >= steady.from && t < steady.to;
  const verdictColor = pass ? LAB_COLORS.pass : LAB_COLORS.red;

  const path = (value: (b: PriceBox) => number) =>
    boxes.map((b, f) => (b ? `${boxes[f - 1] ? 'L' : 'M'}${tx(f / fps).toFixed(1)},${value(b).toFixed(1)}` : '')).join('');
  // The promised length, laid from where the steady stretch starts: it fits inside the band when the hold is kept.
  const needFrom = steady?.from ?? 0, needTo = Math.min(PRICE_HOLD_SECONDS, needFrom + need);

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${LAB_COLORS.line} 1.5px, transparent 1.5px)`, backgroundSize: '48px 48px', opacity: 0.6 }} />

      {box && (
        <div style={{ position: 'absolute', left: box.x - box.w / 2, top: box.y - box.h / 2, width: box.w, height: box.h, opacity: box.opacity }}>
          <div style={{ position: 'absolute', inset: 0, background: LAB_COLORS.cream, color: LAB_COLORS.ink, borderRadius: CARD_RADIUS, padding: '34px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <span style={{ ...hud, fontSize: 24, color: LAB_COLORS.cobalt, fontWeight: 700 }}>Pro plan — billed yearly</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
              <span style={{ fontFamily: DISPLAY_FONT, fontSize: 168, fontWeight: 900, fontStretch: '78%', lineHeight: 0.85, letterSpacing: '-0.02em' }}>$24</span>
              <span style={{ fontFamily: DISPLAY_FONT, fontSize: 44, fontWeight: 600, color: '#5a5550' }}>/ month</span>
            </div>
          </div>
          {/* What the check measures: the tagged element's box, labelled with its name. */}
          <div style={{ position: 'absolute', inset: -14, border: `2px dashed ${inSteady ? LAB_COLORS.pass : LAB_COLORS.dim}`, borderRadius: 26 }} />
          <span style={{ ...hud, position: 'absolute', top: -52, left: -14, color: inSteady ? LAB_COLORS.pass : LAB_COLORS.dim }}>
            price · {inSteady ? 'steady' : 'not steady'}
          </span>
        </div>
      )}

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <PriceCornerInset box={box} within={within} inSteady={inSteady} />

        <line x1={0} x2={1920} y1={648} y2={648} stroke={LAB_COLORS.line} strokeWidth={2} />
        {steady && (
          <g>
            <rect x={tx(steady.from)} y={PLOT.posTop - 10} width={tx(steady.to) - tx(steady.from)} height={PLOT.opBottom - PLOT.posTop + 20} fill={LAB_COLORS.pass} opacity={0.14} />
            <text x={tx(steady.from) + 10} y={PLOT.posTop + 26} fill={LAB_COLORS.pass} style={{ ...hud, fontSize: 26 }}>
              steady {(steady.to - steady.from).toFixed(2)}s
            </text>
          </g>
        )}
        <g>
          <line x1={tx(needFrom)} x2={tx(needTo)} y1={700} y2={700} stroke={verdictColor} strokeWidth={6} />
          <line x1={tx(needFrom)} x2={tx(needFrom)} y1={690} y2={710} stroke={verdictColor} strokeWidth={3} />
          <line x1={tx(needTo)} x2={tx(needTo)} y1={690} y2={710} stroke={verdictColor} strokeWidth={3} />
          <text x={tx(needFrom)} y={684} fill={verdictColor} style={{ ...hud, fontSize: 24 }}>promised {need}s</text>
        </g>

        <line x1={PLOT.left} x2={PLOT.right} y1={posY(0)} y2={posY(0)} stroke={LAB_COLORS.line} strokeWidth={2} />
        <text x={PLOT.left - 16} y={posY(0) + 8} textAnchor="end" fill={LAB_COLORS.dim} style={hud}>rest</text>
        <text x={PLOT.left - 16} y={posY(POS_RANGE_PX) + 16} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 22 }}>+{POS_RANGE_PX}px</text>
        <text x={PLOT.left - 16} y={posY(-POS_RANGE_PX)} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 22 }}>−{POS_RANGE_PX}px</text>
        <path d={path((b) => posY(b.y - PRICE_REST.y))} fill="none" stroke={LAB_COLORS.cobalt} strokeWidth={3} />
        <path d={path((b) => posY(b.x - PRICE_REST.x))} fill="none" stroke={LAB_COLORS.cream} strokeWidth={3} />

        <line x1={PLOT.left} x2={PLOT.right} y1={opY(1)} y2={opY(1)} stroke={LAB_COLORS.line} strokeWidth={2} />
        <line x1={PLOT.left} x2={PLOT.right} y1={opY(VISIBLE_OPACITY)} y2={opY(VISIBLE_OPACITY)} stroke={LAB_COLORS.dim} strokeWidth={2} strokeDasharray="8 8" />
        <text x={PLOT.left - 16} y={opY(VISIBLE_OPACITY) + 8} textAnchor="end" fill={LAB_COLORS.dim} style={hud}>95%</text>
        <text x={PLOT.left - 16} y={PLOT.opBottom} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 22 }}>≤70%</text>
        <path d={path((b) => opY(b.opacity))} fill="none" stroke={LAB_COLORS.red} strokeWidth={3} />

        <text x={PLOT.right} y={1068} textAnchor="end" fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>
          <tspan fill={LAB_COLORS.cream}>━ left-right</tspan>   <tspan fill={LAB_COLORS.cobalt}>━ up-down</tspan>   <tspan fill={LAB_COLORS.red}>━ how solid</tspan>
        </text>
        <text x={PLOT.left} y={1068} fill={LAB_COLORS.dim} style={{ ...hud, fontSize: 24 }}>0s</text>

        <line x1={tx(t)} x2={tx(t)} y1={PLOT.posTop - 14} y2={PLOT.opBottom + 8} stroke={LAB_COLORS.cream} strokeWidth={2} opacity={0.7} />
      </svg>
    </AbsoluteFill>
  );
}
