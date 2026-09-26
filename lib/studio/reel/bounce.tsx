// bounce.tsx: the bouncing ball that opens the reference reel, drawn, and the swell it launches into. Every mark reads
// the ball's model (#models/reel/bounce.ts): the ball, its dotted path, onion-skin ghosts, impact marks, the elastic
// ground line and the callouts, so the path shown is the path flown. `FieldSwell` draws bounce-swell.ts's circle
// growing until its colour is the next shot's ground.

import { MONO_FONT } from '#models/type/faces.ts';
import { clamp, motionCurves } from '#models/motion/motion.ts';
import { DEG, REF_F, shapeOfStrain, smoothstep } from '#models/reel/bounce-shape.ts';
import { SWELL_TIME, fieldSwellAt, swellCentres, type FieldSwellOptions, type SwellPose } from '#models/reel/bounce-swell.ts';
import {
  ballEllipse, bounceModel, contactTime, contactX, groundDents, guidePath, launchSwell, markEase, rawPoseAt, shutterCentres,
  typeOnScramble, type BounceParams,
} from '#models/reel/bounce.ts';
import { useVideoFormat } from '../composition/video-format.ts';
import { pieceMotionAttrs } from '../probe/motion-tag.ts';

// ---------- the swell ----------

/**
 * A circle's colour growing over the frame. Its edge ramps as wide as the growth's smear and its centre is smeared
 * along its path (summed like the ball), which keeps a 5-frame zoom from strobing at 30 fps.
 */
function SwellDisc({ pose, centres = [pose], color, tag }: { pose: SwellPose; centres?: readonly { x: number; y: number }[]; color: string; tag: Record<string, string> }) {
  if (pose.covered) return <div {...tag} style={{ position: 'absolute', inset: 0, background: color }} />;
  const outer = pose.r + pose.soft / 2, sq = Math.sqrt(pose.aspect);
  // A smoothstep ramp across the edge: a plain linear one shows Mach bands on a flat field.
  const stops = [0, 0.25, 0.5, 0.75, 1].map((j) => {
    const alpha = Math.round(100 * (1 - smoothstep(j)));
    return `color-mix(in srgb, ${color} ${alpha}%, transparent) ${(((pose.r - pose.soft / 2 + pose.soft * j) / outer) * 100).toFixed(3)}%`;
  });
  const background = `radial-gradient(closest-side, ${stops.join(', ')})`;
  const at = centres[(centres.length - 1) / 2], cos = Math.cos(pose.angle / DEG), sin = Math.sin(pose.angle / DEG);
  // The tag stays on the frame's own disc; the smear's copies sit inside it, offset in its rotated, squashed frame.
  return (
    <div {...tag} style={{
      position: 'absolute', left: at.x - outer, top: at.y - outer, width: 2 * outer, height: 2 * outer,
      transform: `rotate(${pose.angle}deg) scale(${sq}, ${1 / sq})`, isolation: 'isolate',
      background: centres.length === 1 ? background : undefined,
    }}>
      {centres.length > 1 && centres.map((c, j) => {
        const dx = c.x - at.x, dy = c.y - at.y;
        return (
          <div key={j} style={{
            position: 'absolute', left: (cos * dx + sin * dy) / sq, top: (cos * dy - sin * dx) * sq, width: '100%', height: '100%',
            background, opacity: 1 / centres.length, mixBlendMode: 'plus-lighter',
          }} />
        );
      })}
    </div>
  );
}

/**
 * A circle (a ball, a swatch, an i's tittle) growing until its colour fills the frame, moving toward `to` as it grows:
 * a zoom-through that matches on colour, so the next shot starts on that ground. Give `k` (0..1), or `t` seconds over
 * `duration`. Nothing draws before it starts; draw the circle yourself until then.
 */
export function FieldSwell({ color, motion, from, to, lift, stretch, shutter, ...clock }: Omit<FieldSwellOptions, 'duration' | 'format'> & {
  color: string;
  /** Its name in the motion tracks, `swell` by default; the track reports `k`. */
  motion?: string | false;
} & ({ k: number; duration?: number; t?: never } | { t: number; duration?: number; k?: never })) {
  const format = useVideoFormat();
  const duration = clock.duration ?? SWELL_TIME, k = clock.k ?? clock.t! / duration;
  if (k < 0) return null;
  const opts = { format, from, to, lift, stretch, shutter, duration };
  const tag = pieceMotionAttrs(motion, 'swell', { kind: 'field-swell', values: { k: clamp(k) } });
  return <SwellDisc pose={fieldSwellAt(k, opts)} centres={swellCentres(k, opts)} color={color} tag={tag} />;
}

// ---------- the drawing ----------

/** A callout naming the craft a landing shows, read off a leader line from the contact. */
export type BounceCallout = {
  /** The landing it names: 0 for the first. */
  contact: number;
  label: string;
  /** The figure over the label: "01" for the first landing's by default. */
  number?: string;
  /** The side it reads to. */
  side?: 'right' | 'left';
};

/**
 * The reference reel's bouncing ball, drawn whole: the ball, motion-blurred; its dotted path; three onion-skin ghosts;
 * a diamond, sparks and ground ring at each landing; the elastic ground line with its ruler; and `callouts`. With
 * `launch`, it swells into a full field of `color` (see `FieldSwell`). Defaults are the reference's: #ef4c22 on
 * #0c0c0e, cream lines.
 */
export function BounceBall(props: BounceParams & {
  /** Seconds on the piece's clock. */
  t: number;
  color?: string;
  /** The ground behind it; null draws none, to lay the ball over another shot. */
  background?: string | null;
  /** Lines, marks and labels. */
  ink?: string;
  /** The callouts' figures: the ball's colour by default. */
  accent?: string;
  callouts?: readonly BounceCallout[];
  /** The ground line's ends. Default: centred on the frame, 1200 px or enough to hold the landings. */
  line?: { from: number; to: number };
  /** When the line starts drawing from its centre out: a beat before the first landing by default. */
  inAt?: number;
  guide?: boolean;
  /** Onion-skin ghosts, one a frame back each (the reference's 1/30 s at 30 fps): 3. 0 for none. */
  ghosts?: number;
  /** The diamond, sparks and ground ring at each landing. */
  marks?: boolean;
  /** The ball's shutter as a share of a frame: 0.5 is film's 180°. 0 draws it sharp. The swell's edge is its own. */
  shutter?: number;
  /** Seeds the callouts' decoding glyphs. */
  seed?: string | number;
  /** The ball's name in the motion tracks, `ball` by default; it reports the landing it's on and its aspect. */
  motion?: string | false;
}) {
  const { t, color = '#ef4c22', background = '#0c0c0e', ink = '#f3f0e7', callouts = [], guide = true, ghosts = 3, marks = true, shutter = 0.5, seed = 'bounce', motion } = props;
  const accent = props.accent ?? color;
  const format = useVideoFormat(), { fps, width, height } = format;
  const m = bounceModel(props, format), D = 2 * m.r, pose = rawPoseAt(m, t), L = m.launch;
  // One track from drop to field: the landing it's on, its width over height, and the swell's progress.
  const ballTag = (aspect: number, swell: number) =>
    pieceMotionAttrs(motion, 'ball', { kind: 'bounce', values: { contact: pose.contact, aspect: Number(aspect.toFixed(3)), swell } });

  if (pose.phase === 'field') return <SwellDisc pose={fieldSwellAt(1, launchSwell(m).options)} color={color} tag={ballTag(1, 1)} />;

  // Everything but the ground line fades as the ball launches.
  const chrome = L ? 1 - clamp((t - L.at - 2 * REF_F) / (6 * REF_F)) : 1;
  const inAt = props.inAt ?? m.ts[0] - m.spb;
  const guideAt = m.drop ? m.drop.start : inAt + 0.1;
  // The marks' and callouts' clock, a hair ahead: a beat and a frame are the same instant reached by different float
  // sums, and a mark that starts on a frame mustn't miss it by 1e-17 s.
  const tm = t + 1e-6;
  const shown = (i: number) => i >= 0 && i < m.n && tm >= contactTime(m, i);

  // The ground line and its ruler, on a 40 px lattice centred on the frame.
  const reach = Math.max(600, Math.ceil((Math.max(...m.ts.map((_, i) => Math.abs(contactX(m, i) - width / 2))) + 280) / 40) * 40);
  const span = props.line ?? { from: width / 2 - reach, to: width / 2 + reach };
  const mid = (span.from + span.to) / 2, drawn = ((span.to - span.from) / 2) * motionCurves.expo.entrance((t - inAt) / 0.43);
  const dents = groundDents(m, t), sigma2 = 2 * (0.89 * D) ** 2;
  const lineY = (x: number) => m.groundY + dents.reduce((y, d) => y + d.depth * Math.exp(-((x - d.x) ** 2) / sigma2), 0);
  const lineXs: number[] = [];
  if (drawn > 0.5) { for (let x = mid - drawn; x < mid + drawn; x += 6) lineXs.push(x); lineXs.push(mid + drawn); }
  const ticks: { x: number; major: boolean }[] = [];
  for (let x = width / 2 + Math.ceil((mid - drawn - width / 2) / 40) * 40; x <= mid + drawn; x += 40) ticks.push({ x, major: Math.abs((x - width / 2) % 200) < 1e-6 });

  // The ball, its centre sampled across the shutter and summed (plus-lighter in an isolated group sums coverage exactly).
  const drawBall = pose.phase !== 'waiting' && pose.phase !== 'swell';
  const centres = drawBall ? shutterCentres(m, t, shutter / fps) : [];

  const ghostPoses = Array.from({ length: ghosts }, (_, j) => {
    const at = t - (j + 1) / fps;
    if (m.drop && at < m.drop.start) return null;
    const g = rawPoseAt(m, at);
    // A ghost that has barely left the ball (the crouch pressing on) would only ring its edge.
    const apart = clamp((Math.hypot(g.x - pose.x, g.y - pose.y) + Math.abs(ballEllipse(g).rx - ballEllipse(pose).rx)) / 12);
    return { g, alpha: 0.15 * 0.75 ** j * apart * chrome };
  });

  const sideOf = (c: BounceCallout) => (c.side === 'left' ? -1 : 1);
  const calloutEnd = (i: number) => (L && i === m.n - 1 ? L.at + 7 * REF_F : contactTime(m, i + 1) - REF_F);
  const calloutState = (c: BounceCallout) => {
    const since = tm - contactTime(m, c.contact), end = calloutEnd(c.contact);
    // In from half a reference frame before the landing, out over the five before it ends.
    const alpha = clamp((since + 0.5 * REF_F) / (1.5 * REF_F)) * (1 - clamp((t - (end - 5 * REF_F)) / (5 * REF_F)));
    const s = sideOf(c), dot = { x: contactX(m, c.contact) + s * 16, y: m.groundY + 18 };
    const elbow = { x: dot.x + s * 39.6, y: dot.y + 39.6 }, tip = { x: elbow.x + s * 31, y: elbow.y };
    return { since, alpha, s, dot, elbow, tip };
  };
  const liveCallouts = callouts.filter((c) => shown(c.contact) && t < calloutEnd(c.contact));

  const swell = L ? launchSwell(m) : null;
  const swellK = swell ? (t - swell.at) / swell.options.duration : -1;
  const launched = swell && swellK >= 0 ? { k: swellK, pose: fieldSwellAt(swellK, swell.options), centres: swellCentres(swellK, swell.options) } : null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {background && <div style={{ position: 'absolute', inset: 0, background }} />}
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {ticks.map(({ x, major }) => (
          <line key={x} x1={x} x2={x} y1={m.groundY + 8} y2={m.groundY + (major ? 20 : 16)} stroke={ink} strokeWidth={1.5} opacity={0.24} />
        ))}
        {lineXs.length > 1 && (
          <path d={lineXs.map((x, j) => `${j ? 'L' : 'M'}${x.toFixed(1)} ${lineY(x).toFixed(2)}`).join('')} fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round" opacity={0.86} />
        )}
        {guide && t >= guideAt && (
          <path d={guidePath(m)} fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round" strokeDasharray="0 8" opacity={0.34 * clamp((t - guideAt) / (4 * REF_F)) * chrome} />
        )}
        {marks && m.ts.map((ti, i) => {
          if (!shown(i)) return null;
          const since = tm - ti, x = contactX(m, i), rest = m.groundY - m.r, hub = m.groundY - 0.1 * D;
          // The ring spreads over 11 reference frames from +2; the sparks fly out over 4 from +1, their backs catching up.
          const ring = (since - 2 * REF_F) / (11 * REF_F), spark = (since - REF_F) / (4 * REF_F);
          const a = D * (0.446 + 0.893 * markEase(ring));
          const rIn = D * (0.705 + 0.268 * markEase(spark)), rOut = D * (0.866 + 0.143 * markEase(spark));
          return (
            <g key={i}>
              {ring >= 0 && ring < 1 && <ellipse cx={x} cy={m.groundY} rx={a} ry={0.3 * a} fill="none" stroke={ink} strokeWidth={2} opacity={0.66 * (1 - ring)} />}
              <path d={`M${x} ${rest - 8}L${x + 8} ${rest}L${x} ${rest + 8}L${x - 8} ${rest}Z`} fill={ink} opacity={0.93 * chrome} />
              {spark >= 0 && spark < 1 && [-72, -36, 0, 36, 72].map((deg) => {
                const dx = Math.sin(deg / DEG), dy = -Math.cos(deg / DEG);
                return <line key={deg} x1={x + dx * rIn} y1={hub + dy * rIn} x2={x + dx * rOut} y2={hub + dy * rOut} stroke={ink} strokeWidth={2} strokeLinecap="round" opacity={0.85 * (1 - 0.8 * spark)} />;
              })}
            </g>
          );
        })}
        {ghostPoses.map((gp, j) => gp && gp.alpha > 0.005 && (
          <ellipse key={j} {...ballEllipse(gp.g)} fill="none" stroke={ink} strokeWidth={1.5} opacity={gp.alpha} />
        ))}
        {liveCallouts.map((c) => {
          const { since, alpha, dot, elbow, tip } = calloutState(c);
          // The diagonal draws in 3 reference frames, then the run across in 5.
          const drawn = 56 * clamp(since / (3 * REF_F)) + 31 * motionCurves.cubic.entrance((since - 3 * REF_F) / (5 * REF_F));
          return (
            <g key={c.contact} opacity={alpha}>
              <polyline points={`${dot.x},${dot.y} ${elbow.x},${elbow.y} ${tip.x},${tip.y}`} fill="none" stroke={ink} strokeWidth={1.2} opacity={0.66} strokeDasharray={`${drawn} 100`} />
              {since >= REF_F && <circle cx={dot.x} cy={dot.y} r={2.6} fill={ink} />}
            </g>
          );
        })}
        {drawBall && (
          <g {...ballTag(shapeOfStrain(pose.s).aspect, 0)} style={{ isolation: 'isolate' }}>
            {centres.map((at, j) => (
              <ellipse key={j} {...ballEllipse(pose, at)} fill={color} opacity={1 / centres.length} style={centres.length > 1 ? { mixBlendMode: 'plus-lighter' } : undefined} />
            ))}
          </g>
        )}
      </svg>
      {liveCallouts.map((c) => {
        const { since, alpha, s, tip } = calloutState(c), size = 15;
        const number = c.number ?? String(c.contact + 1).padStart(2, '0');
        const place = s > 0 ? { left: tip.x + 10 } : { right: width - (tip.x - 10) };
        const type = { position: 'absolute', ...place, font: `500 ${size}px/1 ${MONO_FONT}`, letterSpacing: '0.1em', whiteSpace: 'pre', textAlign: s > 0 ? 'left' : 'right' } as const;
        return (
          <div key={c.contact} style={{ position: 'absolute', inset: 0, opacity: alpha }}>
            <div style={{ ...type, top: tip.y - 20 - size / 2, color: accent }}>{number}</div>
            <div style={{ ...type, top: tip.y - size / 2, color: ink, opacity: 0.9 }}>{typeOnScramble(c.label, since, `${seed}|${c.contact}`, { fps })}</div>
          </div>
        );
      })}
      {launched && <SwellDisc pose={launched.pose} centres={launched.centres} color={color} tag={ballTag(launched.pose.aspect, clamp(launched.k))} />}
    </div>
  );
}
