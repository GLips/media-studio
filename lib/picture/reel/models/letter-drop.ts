// letter-drop.ts: one letter of a DropWord as a pure function of time: it falls onto the baseline stretched along its
// speed, squashes about its own foot, springs up into a small hop and lands again lighter, then rests. Its foot is
// the strain's pivot throughout, so the letter never slides off its place on the line.

import {
  STRAIN_ROUND, scaleStrain, strainAlong, strainAlongVelocity, strainOfContact, strainOfLift, type Strain,
} from '#lib/picture/motion/models/strain.ts';

export type LetterDropOptions = {
  /** Pixels above the baseline its foot starts from. */
  height: number;
  /** Seconds it falls for. */
  fall: number;
  /** Seconds each landing's squash lasts, touch to round. */
  contact: number;
  /** Its aspect at touch-down, stretched along its fall (1.4 is the bouncing ball's at the same speed). */
  landingStretch: number;
  /** Its aspect at the first landing's deepest: wider than tall by this. */
  squash: number;
  /** The hop's height as a share of the fall's; 0 lands once and rests. */
  rebound: number;
};

/** Where a letter's foot is `lift` px above the baseline, and the strain it wears about that foot. */
export type LetterDropPose = { lift: number; strain: Strain };

/** Seconds from a letter starting to fall to its resting round on the baseline. */
export function letterDropDuration({ fall, contact, rebound }: LetterDropOptions): number {
  return rebound > 0 ? fall + 2 * contact + 2 * fall * Math.sqrt(rebound) : fall + contact;
}

/** The letter `since` seconds after it starts to fall (y down: a positive velocity falls). */
export function letterDropAt(since: number, o: LetterDropOptions): LetterDropPose {
  const g = (2 * o.height) / o.fall ** 2, v0 = g * o.fall, perSpeed = (o.landingStretch - 1) / v0;
  const flat = strainAlong(o.squash, 0), along = (vy: number) => strainAlongVelocity({ x: 0, y: vy }, perSpeed);
  if (since < o.fall) return { lift: o.height - 0.5 * g * Math.max(0, since) ** 2, strain: along(g * Math.max(0, since)) };
  const landed = since - o.fall;
  if (landed < o.contact) return { lift: 0, strain: strainOfContact((2 * landed) / o.contact - 1, flat, along(v0)) };
  if (!(o.rebound > 0)) return { lift: 0, strain: STRAIN_ROUND };
  // The hop leaves at the speed that reaches `rebound` of the fall's height, and lands as hard as it left.
  const v1 = v0 * Math.sqrt(o.rebound), hop = (2 * v1) / g, τ = landed - o.contact;
  if (τ < hop) return { lift: v1 * τ - 0.5 * g * τ * τ, strain: strainOfLift(along(g * τ - v1), τ) };
  const again = τ - hop;
  if (again < o.contact) return { lift: 0, strain: strainOfContact((2 * again) / o.contact - 1, scaleStrain(flat, v1 / v0), along(v1)) };
  return { lift: 0, strain: STRAIN_ROUND };
}
