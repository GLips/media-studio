// Bar 7, 07 — 3D / DEPTH OF FIELD: the price tiers as a staircase of columns on the black stage, cream at the full
// price down to red at the deepest discount, and the red runs on out of the frame, since 10+ has no top. An anodized
// titanium ball lands a tier a beat, $2.00 down to $1.40, the focus racking with it, as the camera cranes from
// overhead to a low three-quarter view; then the ball leaves along the red and the camera whips after it into bar 8.

import * as THREE from 'three';
import { DISPLAY_FONT, FPS, H, MONO_FONT, W, clamp, lerp, motionCurves, type Point } from '../../../lib/studio/api.ts';
import { ColumnField, columnBallAt, columnTitaniumMaterial, columnCameraAt, columnDiscCells, columnNoise, type ColumnBall, type ColumnCameraMove, type ColumnCameraPose, type ColumnCell, type ColumnFieldProps, type ColumnFieldSpec, type ColumnLabel } from '../../../lib/studio/reel/column-field.tsx';
import { reelHudGrounds, type ReelHudTone } from '../../../lib/studio/reel/hud.tsx';
import type { Bar } from '../bar.ts';
import whipIntoPayLess from '../sfx/whip-into-pay-less.ts';
import { P } from '../look.ts';
import { timeline } from '../timeline.ts';

const clock = timeline.bar('tiers');
const FROM = clock.from, TO = clock.to;
/** The four landings: $2.00, $1.80, $1.60 (the bar's accent), $1.40. */
const HITS = [clock.beat(0), clock.beat(1), clock.beat(2), clock.cues.plateau];
const HERO = 2;
/** Seconds from the first landing, the field's clock. */
const fieldT = (f: number) => (f - FROM) / FPS;
const HIT_T = HITS.map(fieldT);
const rad = (d: number) => (d * Math.PI) / 180;
const cubicInOut = motionCurves.cubic.standard;

// ---------- the staircase ----------

const TIERS = [
  { qty: '1', price: '$2.00', color: P.cream, height: 5.5 },
  { qty: '2–4', price: '$1.80', color: '#fac08f', height: 4.2 },
  { qty: '5–9', price: '$1.60', color: '#f88b4f', height: 2.9 },
  { qty: '10+', price: '$1.40', color: P.red, height: 1.6 },
] as const;

type TierCell = ColumnCell & { tier?: number };
const tierX = (k: number) => 4 * k - 6;
/** The tiers' front and back rows. Overhead, the back edge falls just under the HUD's top row, which reads on the stage. */
const FRONT = 3, BACK = -2;
/** Half a column: ColumnField's columns are 0.64 pitches wide. */
const HALF = 0.32;
/** Tier k is three columns about i = 4k − 6 with a floor column between tiers; 10+ runs on to the field's edge. */
function tierOf(i: number, j: number) {
  if (j > FRONT || i < tierX(0) - 1) return undefined;
  if (i >= tierX(3) - 1) return 3;
  return j < BACK || (i + 8) % 4 === 0 ? undefined : Math.floor((i + 8) / 4);
}
/** The floor's columns: a charcoal whose tops catch the light, so the stage reads as a lit floor and still as dark. */
const FLOOR_COLOR = '#44464e';
const CELLS: TierCell[] = columnDiscCells({ radius: 26, centre: [3, -4], color: () => FLOOR_COLOR }).map((c) => {
  const tier = tierOf(c.i, c.j);
  return tier === undefined ? c : { ...c, tier, color: TIERS[tier].color };
});
const floorNoise = columnNoise({ seed: 3, min: 0.12, max: 0.9, scale: 0.3, speed: 0.5 });
// The three rows in front of the stairs stay low, so the cards hanging on the tier faces clear them.
function floorHeight(cell: TierCell, t: number) {
  const ahead = cell.j - FRONT;
  const h = floorNoise(cell, t);
  return ahead >= 1 && ahead <= 3 && cell.i >= tierX(0) - 2 ? Math.min(h, 0.1 + 0.15 * ahead) : h;
}

/**
 * Where the ball lands on tier k, on its middle column: the first well behind its card, clear of it overhead; the
 * $1.60's far enough back that the card, jumping bigger as it lands, hides none of the squash.
 */
const LANDING_ROWS = [0, 1, 0, 2];
const landing = (k: number) => [tierX(k), LANDING_ROWS[k]] as const;

// Each landing drives the columns under it down and they ring back, the ring spreading through the tier.
const RING = { speed: 14, period: 0.14, decay: 0.09, reach: 1.6 };
function impactDip(cell: { i: number; j: number; tier?: number }, t: number) {
  let dip = 0;
  for (const [k, at] of HIT_T.entries()) {
    if (cell.tier !== k) continue;
    const [li, lj] = landing(k);
    const d = Math.hypot(cell.i - li, cell.j - lj);
    const u = t - at - d / RING.speed;
    if (u <= 0) continue;
    const amp = (k === HERO ? 0.4 : 0.25) * Math.exp(-d / RING.reach);
    dip += amp * Math.exp(-u / RING.decay) * Math.sin((2 * Math.PI * u) / RING.period);
  }
  return dip;
}
const heightOf = (cell: TierCell, t: number) => (cell.tier === undefined ? floorHeight(cell, t) : TIERS[cell.tier].height - impactDip(cell, t));

// Bronze, from a thin film: it stays in the reel's warm half and reads as metal among the tiers, where the default
// blue film reads as a light and breaks the colour script. Satin, rougher than the titanium's 0.35, so the back light
// glancing off its crown spreads into a sheen instead of blooming into a halo.
const BALL_FILM = [25, 40] as const;
const ballMaterial = (env: THREE.Texture | null) => Object.assign(columnTitaniumMaterial(env, BALL_FILM), { roughness: 0.45 });
const BALL: ColumnBall = {
  contacts: HIT_T.map((at, k) => ({ at, cell: landing(k), squash: k === HERO ? 0.3 : 0.22 })),
  // Lighter than the default, so its hops between tiers stay in the frame.
  gravity: 55,
  enter: { from: [-4, 8, -3], duration: 0.4 }, launch: [10, 15, -1], radius: 0.85, material: ballMaterial, keyShadow: true,
};

// ---------- the camera's aim ----------

// One move: a crane from straight over the stairs to a low three-quarter view from their foot, landing on the $1.60,
// then creeping on round and down into the whip. This is where the lens points; where it stands is framed below.
const CRANE = [-0.12, HIT_T[HERO]] as const;
// Timed to reach bar 8's 520 px/frame on the bar's last frame.
const WHIP = { at: 1.772, double: 0.045 };

function aimAt(t: number) {
  const k = cubicInOut((t - CRANE[0]) / (CRANE[1] - CRANE[0]));
  const on = clamp((t - CRANE[1]) / (WHIP.at - CRANE[1]));
  return { elevation: lerp(90, 21, k) - 2 * on, azimuth: lerp(0, 22, k) + 3 * on, fov: lerp(27, 38, k) };
}

// ---------- the prices ----------

const CARD = { w: 3.4, h: 1.6 };
/** How far down its tier's face a card has sunk at full stand, so the landing behind it stays in view. */
const SINK = 1.2;

// Overhead, a card lies on its tier's front rows. As the camera comes down it stands up to face the lens and sinks
// down the tier's face, standing out from the face by as much as its lean takes it back.
function cardHang(elevation: number) {
  const u = clamp((62 - elevation) / 40);
  const sink = SINK * u * u;
  return { sink, out: HALF + 0.08 + sink * Math.tan(rad(Math.min(elevation, 80))) };
}

/** The $1.60 card jumps a fifth bigger on its landing and settles a little proud of the others. */
const cardScale = (k: number, t: number) => (k === HERO && t >= HIT_T[HERO] ? 1.08 + 0.12 * Math.exp(-(t - HIT_T[HERO]) / 0.08) : 1);
/** How much brighter card k flashes at t: on its landing, the accent's hot enough that its type blooms. */
function flashAt(k: number, t: number) {
  const u = t - HIT_T[k];
  return u < 0 ? 0 : (k === HERO ? 4 : 0.5) * Math.exp(-u / 0.05);
}
/** A card's brightness at rest: above 1 holds its cream against the tone mapping. */
const CARD_GLOW = 1.2;
const litAt = (k: number, t: number) => k === HERO && t >= HIT_T[HERO];

// `plate` scales the plate's colour: a flash brightens the whole card, so the plate is painted down by as much and
// only the type flares.
function paintCard(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, lit: boolean, plate: number) {
  const tier = TIERS[k];
  ctx.fillStyle = lit ? new THREE.Color(P.red).multiplyScalar(plate).getStyle() : 'rgba(12, 12, 14, 0.94)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = lit ? P.cream : tier.color;
  ctx.fillRect(0, 0, w, h * 0.08);
  ctx.fillStyle = P.cream;
  ctx.globalAlpha = 0.8;
  ctx.font = `600 ${h * 0.14}px ${MONO_FONT}`;
  ctx.letterSpacing = `${h * 0.014}px`;
  ctx.fillText(`QTY ${tier.qty}`, w * 0.075, h * 0.29);
  ctx.globalAlpha = 1;
  ctx.letterSpacing = '0px';
  // After the font: setting it resets the stretch.
  ctx.font = `900 ${h * 0.77}px ${DISPLAY_FONT}`;
  ctx.fontStretch = 'condensed';
  ctx.fillText(tier.price, w * 0.07, h * 0.91);
}

/** Card k at t as placed in the scene: its bottom edge's middle, its up and facing directions, its size. */
function cardFrame(k: number, t: number) {
  const { elevation } = aimAt(t);
  const { sink, out } = cardHang(elevation);
  const scale = cardScale(k, t);
  const top = TIERS[k].height - impactDip({ i: tierX(k), j: FRONT, tier: k }, t);
  const e = rad(elevation);
  return {
    hinge: new THREE.Vector3(tierX(k), top - sink, FRONT + out), up: new THREE.Vector3(0, Math.cos(e), -Math.sin(e)),
    facing: new THREE.Vector3(0, Math.sin(e), Math.cos(e)), w: CARD.w * scale, h: CARD.h * scale, elevation, sink, out,
  };
}

const labels = (t: number): ColumnLabel[] => TIERS.map((_, k) => {
  const card = cardFrame(k, t);
  const lit = litAt(k, t);
  const intensity = CARD_GLOW + flashAt(k, t);
  return {
    cell: [tierX(k), FRONT], offset: [0, -card.sink, card.out], size: [card.w, card.h], tilt: 90 - card.elevation, turn: 0,
    intensity, paint: (ctx, w, h) => paintCard(ctx, w, h, k, lit, CARD_GLOW / intensity),
  };
});

// ---------- the camera's place ----------

/** Where the framing keeps the cards and the ball, px: inside the HUD's rows, with room for the $1.60's punch. */
const FRAMED = { x0: 90, x1: 1830, y0: 120, y1: 960 };

/** The pose aimed as `aim` from where `points` fill FRAMED as big as they'll go, centred in it. */
function framedPose(aim: ReturnType<typeof aimAt>, points: readonly THREE.Vector3[]): ColumnCameraPose {
  const a = rad(aim.azimuth), e = rad(aim.elevation);
  const forward = new THREE.Vector3(-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e));
  const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  const up = right.clone().cross(forward);
  const focal = H / 2 / Math.tan(rad(aim.fov) / 2);
  const [x0, x1] = [(FRAMED.x0 - W / 2) / focal, (FRAMED.x1 - W / 2) / focal];
  const [y0, y1] = [(H / 2 - FRAMED.y1) / focal, (H / 2 - FRAMED.y0) / focal];
  // A point is inside when its offset over its depth is, which is linear in the camera's place along each axis: the
  // tightest place that holds every point is closed-form.
  let [left, rightmost, bottom, top] = [Infinity, Infinity, Infinity, Infinity];
  for (const q of points) {
    const r = q.dot(right), u = q.dot(up), d = q.dot(forward);
    left = Math.min(left, r - x0 * d);
    rightmost = Math.min(rightmost, x1 * d - r);
    bottom = Math.min(bottom, u - y0 * d);
    top = Math.min(top, y1 * d - u);
  }
  const along = Math.min((left + rightmost) / (x1 - x0), (bottom + top) / (y1 - y0));
  const place = right.clone().multiplyScalar((left - rightmost + (x0 + x1) * along) / 2)
    .addScaledVector(up, (bottom - top + (y0 + y1) * along) / 2).addScaledVector(forward, along);
  const distance = points.reduce((sum, q) => sum + q.clone().sub(place).dot(forward), 0) / points.length;
  const target = place.addScaledVector(forward, distance);
  return { target: [target.x, target.y, target.z], distance, ...aim };
}

// columnBallAt reads only the stage and the ball; the camera is there because the spec's type asks for one.
const BALL_STAGE: ColumnFieldSpec<TierCell> = { cells: CELLS, height: heightOf, ball: BALL, camera: { from: framedPose(aimAt(0), [new THREE.Vector3()]), to: framedPose(aimAt(0), [new THREE.Vector3()]), crane: [0, 1] } };

/**
 * What the camera frames at t: the four cards, the back of each tier's top (so none of it rises under the HUD's top
 * row; the red runs on, out of frame) and the ball, its whole sphere, over `ball`, seconds about t.
 */
function subjectAt(t: number, ball: readonly [number, number] | null) {
  const points: THREE.Vector3[] = [];
  const across = new THREE.Vector3(1, 0, 0);
  for (const k of TIERS.keys()) {
    const card = cardFrame(k, t);
    for (const u of [-0.5, 0.5]) for (const v of [0, 1]) points.push(card.hinge.clone().addScaledVector(across, u * card.w).addScaledVector(card.up, v * card.h));
    if (k < 3) for (const side of [-1, 1]) points.push(new THREE.Vector3(tierX(k) + side * (1 + HALF), TIERS[k].height, BACK - HALF));
  }
  if (!ball) return points;
  for (let s = t + ball[0]; s <= t + ball[1] + 1e-6; s += 1 / (2 * FPS)) {
    const at = columnBallAt(BALL_STAGE, s)!;
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
      for (const sign of [-1, 1]) points.push(at.position.clone().addScaledVector(new THREE.Vector3(...axis), sign * at.radius));
    }
  }
  return points;
}

// Keyframes of the camera's place, each framing the cards and the ball's flight about it; it glides between them. The
// last has no ball: it has left along the red, and the whip goes after it.
const PLACES = ([
  [0, [0, 0.13]], [4, [-0.1, 0.1]], [8, [-0.1, 0.1]], [12, [-0.1, 0.1]], [15, [-0.1, 0.1]], [18, [-0.1, 0.1]],
  [22, [-0.1, 0.1]], [26, [-0.1, 0.1]], [30, [-0.1, 0.1]], [37, [-0.1, 0.1]], [45, [-0.1, 0.1]], [WHIP.at * FPS, null],
] as const).map(([since, ball]) => {
  const t = fieldT(FROM + since);
  return { t, pose: framedPose(aimAt(t), subjectAt(t, ball)) };
});

/** A monotone cubic through (ts, vs): no overshoot between keys, carried on straight past the ends. */
function glide(ts: readonly number[], vs: readonly number[]) {
  const n = ts.length;
  const secant = ts.slice(1).map((t, i) => (vs[i + 1] - vs[i]) / (t - ts[i]));
  const slope = ts.map((_, i) => (i === 0 ? secant[0] : i === n - 1 ? secant[n - 2] : secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) continue;
    const a = slope[i] / secant[i], b = slope[i + 1] / secant[i], s = a * a + b * b;
    if (s > 9) [slope[i], slope[i + 1]] = [(3 * a * secant[i]) / Math.sqrt(s), (3 * b * secant[i]) / Math.sqrt(s)];
  }
  return (t: number) => {
    if (t <= ts[0]) return vs[0] + slope[0] * (t - ts[0]);
    if (t >= ts[n - 1]) return vs[n - 1] + slope[n - 1] * (t - ts[n - 1]);
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h;
    return (2 * u ** 3 - 3 * u ** 2 + 1) * vs[i] + (u ** 3 - 2 * u ** 2 + u) * h * slope[i] + (-2 * u ** 3 + 3 * u ** 2) * vs[i + 1] + (u ** 3 - u ** 2) * h * slope[i + 1];
  };
}
const PLACE_TS = PLACES.map((p) => p.t);
const glideTarget = [0, 1, 2].map((n) => glide(PLACE_TS, PLACES.map((p) => p.pose.target[n])));
const glideDistance = glide(PLACE_TS, PLACES.map((p) => p.pose.distance));

function poseAt(t: number): ColumnCameraPose {
  return { target: [glideTarget[0](t), glideTarget[1](t), glideTarget[2](t)], distance: glideDistance(t), ...aimAt(t) };
}

const PUNCHES = HIT_T.map((at, k) => ({ at, amount: k === HERO ? 0.08 : 0.025 }));

// ColumnCameraMove cranes between two poses only, so each frame hands it last frame's pose and this one's: its
// exposures smear along the path.
function frameMove(t: number): ColumnCameraMove {
  const dt = 1 / FPS;
  return { from: poseAt(t - dt), to: poseAt(t), crane: [t - dt, t], ease: (u) => u, punches: PUNCHES, punchDecay: 0.06, whip: WHIP };
}

// ---------- the lens ----------

/** The point the puller holds for tier k: its card's face, leaning toward where the ball lands on it. */
const focusPoint = (k: number) => new THREE.Vector3(tierX(k), TIERS[k].height + 0.3, (2 * (FRONT + 0.5) + LANDING_ROWS[k]) / 3);

/** Focus distance for frame t: held on the ball's tier, racking to the next over its flight, there just before it lands. */
function focusAt(t: number, move: ColumnCameraMove) {
  let k = 0;
  while (k < 3 && t >= HIT_T[k + 1]) k++;
  const next = Math.min(k + 1, 3);
  const rack = k === next ? 0 : cubicInOut((t - HIT_T[k] - 0.08) / (HIT_T[next] - HIT_T[k] - 0.13));
  const point = focusPoint(k).lerp(focusPoint(next), rack);
  const cam = columnCameraAt(move, t);
  return point.sub(cam.position).dot(cam.forward);
}

// ---------- the field ----------

const fieldAt = (f: number): ColumnFieldProps<TierCell> => {
  const t = fieldT(f);
  const camera = frameMove(t);
  return {
    t, cells: CELLS, height: heightOf, camera, ball: BALL, lens: { aperture: 0.6, focus: focusAt(t, camera) },
    // At fewer exposures the wide aperture knits the far field's glints into a weave, and the whip strobes the type and
    // the ball's glint into separate copies.
    samples: 96,
    // Bright enough to hold its own between bars 6 and 8. A low warm key rakes from the front left, so the tiers' fronts
    // take their own colours; a back light sheens the field's tops out to the horizon; a cool sky lifts the floor's
    // tops off the dark.
    lights: {
      key: { azimuth: -40, elevation: 22, color: '#fff8f2', intensity: 6, softness: 2 },
      rim: { azimuth: 202, elevation: 20, color: '#ffe6cc', intensity: 3.9 },
      pool: { intensity: 1.5, color: '#fff3e6', above: 1.6, spread: 50, size: 6 },
      fill: { sky: '#9ea3b8', ground: '#3a2a22', intensity: 2.9 },
      environment: 0.26,
    },
    ground: '#141417', fog: { color: '#2a2220', near: 6, far: 40 }, column: { vary: 0.1, roughness: 0.55 },
    bloom: { strength: 0.5, radius: 0.35, threshold: 4 }, labels,
  };
};

// ---------- the HUD ----------

const TIER_BOXES = TIERS.map((tier, k) => new THREE.Box3(
  new THREE.Vector3(tierX(k) - 1 - HALF, 0, k === 3 ? -40 : BACK - HALF),
  new THREE.Vector3(k === 3 ? 40 : tierX(k) + 1 + HALF, tier.height, FRONT + HALF),
));

/**
 * The HUD's tone over frame point `p` on the field's frame, from what the ray through it meets first: a card, the
 * ball, a tier or the stage. The key rakes from the front left, so a tier's right and back faces are in shadow and read
 * as the stage; its lit faces take dark inks, the red tier's the accent's.
 */
function tiersToneAt(f: number): (p: Point) => ReelHudTone {
  const spec = fieldAt(f);
  const t = spec.t;
  const cam = columnCameraAt(spec.camera, t);
  const focal = H / 2 / Math.tan(rad(cam.fov) / 2);
  const cards = [...TIERS.keys()].map((k) => {
    const card = cardFrame(k, t);
    const centre = card.hinge.clone().addScaledVector(card.up, card.h / 2);
    return { card, centre, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(card.facing, centre), lit: litAt(k, t) };
  });
  const ball = columnBallAt(spec, t);
  return ({ x, y }) => {
    const ray = new THREE.Ray(cam.position, cam.forward.clone().addScaledVector(cam.right, (x - W / 2) / focal).addScaledVector(cam.up, (H / 2 - y) / focal).normalize());
    let best = { at: Infinity, tone: 'light' as ReelHudTone };
    const offer = (point: THREE.Vector3 | null, tone: ReelHudTone) => {
      const at = point ? point.distanceTo(cam.position) : Infinity;
      if (at < best.at) best = { at, tone };
    };
    for (const [k, { card, centre, plane, lit }] of cards.entries()) {
      const hit = ray.intersectPlane(plane, new THREE.Vector3());
      const local = hit?.clone().sub(centre);
      if (local && Math.abs(local.x) <= card.w / 2 && Math.abs(local.dot(card.up)) <= card.h / 2) offer(hit, lit ? 'on-accent' : 'light');
      const box = TIER_BOXES[k];
      const face = ray.intersectBox(box, new THREE.Vector3());
      const shaded = face && (face.x > box.max.x - 1e-3 || face.z < box.min.z + 1e-3);
      offer(face, shaded ? 'light' : k === 3 ? 'on-accent' : 'dark');
    }
    if (ball) offer(ray.intersectSphere(new THREE.Sphere(ball.position, ball.radius), new THREE.Vector3()), 'light');
    return best.tone;
  };
}

export const tiersBar: Bar = {
  id: 'tiers',
  note: 'An anodized titanium ball hops down four tiers of columns, cream at $2.00 to red at $1.40, a tier a beat, the focus racking with it, as the camera cranes from overhead to a low three-quarter view, then whips right along the red after it.',
  clock,
  render: (f) => <ColumnField {...fieldAt(f)} />,
  // The tone most of a part's box shows: no plates, as the stage's lit faces and shadows are broad and flat.
  hudRead: (_slot, f, box) => ({ tone: reelHudGrounds(box, tiersToneAt(f))[0].ground }),
  kicks: [HITS[HERO]],
  // The whip passes on the cut, its fastest frame; its run-up is the camera's, its tail bar 8's page landing.
  sounds: [{ id: 'whip-out', at: TO, sound: whipIntoPayLess }],
};
