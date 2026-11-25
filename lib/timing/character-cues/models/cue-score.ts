// cue-score.ts: a character directed by one flat score. Each row lands at a storyboard moment and sets things about the
// character there: a pose, an expression, sliders, a move, its place and squash, the camera, its look and palette.
// The score compiles into one track per control (cue-tracks.ts); sampling them at a scene time gives a plain-data
// frame, a pure function of that time alone, so frames draw in any order and in parallel tabs.

import type { LookCatalog, LookPaletteOf } from '#lib/paint/looks/models/look-catalog.ts';
import type { CueBlend } from './cue-blend.ts';
import type { AnyCueCharacter, CueCharacterState } from './cue-character.ts';
import type { CuePatch, CueState } from './cue-state.ts';
import type { CueTime } from './cue-time.ts';

export type CueVector = readonly [number, number, number];

/** How a move ends: `'hold'` keeps its last values; `{ return }` blends back to what it started from. */
export type CueMoveEnd = 'hold' | { readonly return: CueBlend };

type Moves<C> = C extends { moves: infer M } ? M : never;
type MarkerOf<M> = M extends { markers: infer K } ? keyof K & string : never;

/**
 * A move played from a cue. `align` names one of its markers to land on the cue's time (the snap's `hit` on the beat);
 * without it the move starts there. `rate` plays it faster (2) or slower (0.5). `until` ends an open move.
 */
export type CueMoveCall<C, Cue extends string> = {
  [M in keyof Moves<C> & string]: {
    readonly name: M;
    readonly align?: MarkerOf<Moves<C>[M]>;
    readonly rate?: number;
    readonly end?: CueMoveEnd;
    readonly until?: CueTime<Cue>;
  };
}[keyof Moves<C> & string];

/** A look, with its palette or its default; or a new palette for the look already showing, named with it. */
export type CuePaintCommand<L extends LookCatalog> =
  | { readonly look?: never; readonly palette?: never }
  | { [K in keyof L & string]: { readonly look: K; readonly palette?: LookPaletteOf<L, K> } }[keyof L & string]
  | { readonly look?: never; readonly palette: { [K in keyof L & string]: { readonly look: K; readonly name: LookPaletteOf<L, K> } }[keyof L & string] };

/**
 * One row of a score: when (`at`), how its controls travel there (`by`, a cut unless given), and what it sets. Looks
 * and palettes always cut; a move's controls start at once and `by` blends its entrance.
 */
export type CueRow<C extends AnyCueCharacter, L extends LookCatalog, Camera extends CueState, Cue extends string> = {
  readonly at: CueTime<Cue>;
  readonly by?: CueBlend;
  readonly pose?: keyof C['poses'] & string;
  readonly expression?: keyof C['expressions'] & string;
  readonly set?: { readonly [K in keyof C['sliders']]?: number };
  readonly move?: CueMoveCall<C, Cue>;
  /** Where the whole character stands, in scene units. */
  readonly position?: CueVector;
  /** Whole-body squash at constant volume about its feet: under 1 squashes, over 1 stretches. */
  readonly squash?: number;
  readonly camera?: CuePatch<Camera>;
} & CuePaintCommand<L>;

/** What a score directs: a character, the looks it can be drawn in, and the camera's controls, if the shot has any. */
export type CueCast<C extends AnyCueCharacter, L extends LookCatalog, Camera extends CueState> = {
  readonly character: C;
  readonly looks: L;
  readonly camera: Camera;
};

/** One frame of a performance, all plain data. */
export type CueFrame<C extends AnyCueCharacter, L extends LookCatalog, Camera extends CueState> = {
  /** The scene time sampled. */
  readonly t: number;
  /** The character's controls, sampled at `drawingTime`. */
  readonly character: CueCharacterState<C>;
  /** Whole-body squash, sampled at `drawingTime` with the character. */
  readonly squash: number;
  /** Where it stands, and the camera: both live at `t`, so a held look's camera never steps. */
  readonly position: CueVector;
  readonly camera: Camera;
  readonly look: keyof L & string;
  readonly palette: string;
  /** Which drawing of the current look this is, from 0 at its cut: a seed for boil. */
  readonly drawing: number;
  /** When this drawing was taken: `t` for a live look, the drawing's start for a held one. */
  readonly drawingTime: number;
};
