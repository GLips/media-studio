// stamp-card-relief.ts: how an own sheet's card catches its picture's light, as cut paper does: a short soft shadow
// cast away from the light, a dark cut line all round its edge and a pale lip where the edge faces the light. All of
// it is laid in stage px from the card's coverage as laid (stamp-card-relief-pass.ts); pigment is never relit.
//
// Numbers from the papercraft recipe: a card lifted d above what's behind casts offset 1.1·d, blur 1.6·d (σ ≈ 0.8 ×
// the offset), rgba(58,30,10) at 0.42; a lip of #fff3d8 at 50 %.

import type { PaintLight } from './stamp-form.ts';
import type { StampSheetCompositeStep } from './stamp-sheet-program.ts';

/**
 * How a card catches the light: whether it casts a `shadow`, whether its edge shows a `rim` (cut line and lip), and
 * `lift`, px above what's behind, which sets how far its shadow falls and how soft it is.
 */
export type StampCardLook = { readonly shadow: boolean; readonly rim: boolean; readonly lift: number };

/** A card's lift when its sheet names none, px: a sheet of card lying on another. */
export const STAMP_CARD_LIFT = 0.7;

/** A card shaded as every own sheet is unless it says otherwise. */
export const STAMP_CARD_LOOK: StampCardLook = { shadow: true, rim: true, lift: STAMP_CARD_LIFT };

/** A card catching no light: the root's sheet, or an own sheet that opts out. */
export const STAMP_CARD_FLAT: StampCardLook = { shadow: false, rim: false, lift: 0 };

/** The shadow's tint, gamma-encoded: a warm umber, so it darkens toward the world's leak, never toward black. */
export const STAMP_CARD_SHADOW_TINT = '#3a1e0a';
/** How far a shadow's core darkens toward its tint: what's behind is multiplied by mix(1, tint, strength · density). */
export const STAMP_CARD_SHADOW_STRENGTH = 0.42;
/** The cut line's colour, gamma-encoded, how much of it lies at its core, and its width inside the edge, stage px. */
export const STAMP_CARD_CUT_LINE = { color: '#3a1e0a', amount: 0.6, width: 2 } as const;
/** The lip's colour, gamma-encoded, how much of it lies on an edge facing the light square on, and its width, stage px. */
export const STAMP_CARD_LIP = { color: '#fff3d8', amount: 0.5, width: 1.4 } as const;
/** How far inside its edge a rim reads a card's coverage, stage px: past the line's width and its antialiasing. */
export const STAMP_CARD_RIM_REACH = 3;

/**
 * The elevation a shadow's offset is taken at, at least: a light grazing the picture plane, or behind it, would throw
 * a card's shadow ever further. Below it, shadows stop lengthening.
 */
const STAMP_CARD_LOWEST_ELEVATION = 0.15;

/**
 * A card's shadow under `light` lifted `lift`: `offset`, stage px, away from the light (lift·cot(elevation)); its
 * blur's `sigma` and `taps` each side; and `reach`, how far past the card it can darken. Null for a card lying flat.
 */
export type StampCardShadow = { readonly offset: { readonly x: number; readonly y: number }; readonly sigma: number; readonly taps: number; readonly reach: number };

/** `lift`'s shadow under `light` (StampCardShadow); null for none. */
export function stampCardShadow(light: PaintLight, lift: number): StampCardShadow | null {
  if (lift <= 0) return null;
  const elevation = Math.max(STAMP_CARD_LOWEST_ELEVATION, Math.min(Math.PI / 2, light.elevation));
  const length = lift / Math.tan(elevation), away = light.direction + Math.PI;
  // A light from the front still lifts a card off its ground: the blur stays, only the offset goes.
  const sigma = 0.8 * Math.max(length, lift), taps = Math.ceil(3 * sigma);
  return { offset: { x: length * Math.cos(away), y: length * Math.sin(away) }, sigma, taps, reach: Math.ceil(length) + taps };
}

/**
 * The picture plane's direction toward `light`, scaled by how far it lies across the picture rather than in front of
 * it: an edge facing it takes the lip by its dot with this.
 */
export function stampCardLipToward(light: PaintLight): { readonly x: number; readonly y: number } {
  const across = Math.cos(Math.max(0, Math.min(Math.PI / 2, light.elevation)));
  return { x: across * Math.cos(light.direction), y: across * Math.sin(light.direction) };
}

/**
 * A step as a card's relief reads it: a card (or a rig's pieces in its place) catching light as its sheet's `look` says, a
 * sheet's `rim` (laid once its films are), or a step that's neither (a film).
 */
export type StampCardReliefStepIn =
  | { readonly kind: 'card'; readonly sheet: number; readonly look: StampCardLook }
  | { readonly kind: 'pieces'; readonly look: StampCardLook }
  | { readonly kind: 'rim'; readonly sheet: number }
  | { readonly kind: 'other' };

/**
 * What the light does at a step. `cast`: draw the card's coverage into `level`, cast its shadow if its look says, and
 * mark it over `occludes`, earlier levels whose rims wait, so theirs don't show through it; its own `rim` is
 * laid later, now (pieces, laid whole) or never. `rim`: lay the rim of the card in `level`. Null: neither.
 */
export type StampCardReliefStep =
  | { readonly kind: 'cast'; readonly level: number; readonly look: StampCardLook; readonly occludes: readonly number[]; readonly rim: 'later' | 'now' | 'none' }
  | { readonly kind: 'rim'; readonly level: number }
  | null;

const rimWhen = { card: 'later', pieces: 'now' } as const;

/**
 * Each card's relief over a composite's `steps`, back to front (null for a step laying nothing). Each card holds a coverage
 * level from its card to its rim, the lowest free; a card laid between lies over those waiting, so a parent's rim,
 * laid after its last film, never paints over a child card laid before that film.
 */
export function stampCardReliefSteps(steps: readonly (StampCardReliefStepIn | null)[]): StampCardReliefStep[] {
  const waiting = new Map<number, number>(), held = new Set<number>();
  const free = () => {
    let level = 0;
    while (held.has(level)) level++;
    return level;
  };
  return steps.map((step): StampCardReliefStep => {
    if (!step || step.kind === 'other') return null;
    if (step.kind === 'rim') {
      const level = waiting.get(step.sheet);
      if (level === undefined) return null;
      waiting.delete(step.sheet);
      held.delete(level);
      return { kind: 'rim', level };
    }
    const level = free(), occludes = [...waiting.values()];
    const rim = !step.look.rim ? 'none' : rimWhen[step.kind];
    if (rim === 'later' && step.kind === 'card') {
      waiting.set(step.sheet, level);
      held.add(level);
    }
    return { kind: 'cast', level, look: step.look, occludes, rim };
  });
}

/**
 * Where an own sheet's rim step goes among a composite's `steps`: after the last of its films, or its card when it
 * lays none. Each sheet `rimmed` gets one.
 */
export function stampSheetStepsRimmed(steps: readonly StampSheetCompositeStep[], rimmed: (sheet: number) => boolean): StampSheetCompositeStep[] {
  const last = new Map<number, number>();
  steps.forEach((step, index) => {
    if (rimmed(step.sheet) && (step.kind === 'film' || !last.has(step.sheet))) last.set(step.sheet, index);
  });
  const after = new Map([...last].map(([sheet, index]) => [index, sheet]));
  return steps.flatMap((step, index) => (after.has(index) ? [step, { kind: 'rim', sheet: after.get(index)! }] : [step]));
}
