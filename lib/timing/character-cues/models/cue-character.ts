// cue-character.ts: what a character declares it can be told to do. A score's cues are typed from this, so a pose,
// slider or move the character doesn't have fails the typecheck before anything renders. A character only has the
// controls it was built with: an imported robot without brow shapes has no brow slider, and none is pretended.

import type { CueNumberPath, CuePatch, CuePath, CueState } from './cue-state.ts';

/** A named number control: `path` in the state, and the range a cue may set it within. */
export type CueSlider<S> = { readonly path: CueNumberPath<S>; readonly min: number; readonly max: number };

/**
 * A ready-made performance. `writes` claims the controls it drives (leaves or subtrees); `sample` gives their values
 * `seconds` into the move from `entry`, the whole state as it stood when the move began. `markers` name moments in
 * it (the snap's `hit`) a cue can align on. Without `seconds` it plays until a cue takes its controls or ends it.
 */
export type CueMove<S extends CueState> = {
  readonly writes: readonly CuePath<S>[];
  readonly markers?: { readonly [name: string]: number };
  readonly seconds?: number;
  readonly sample: (seconds: number, entry: S) => CuePatch<S>;
};

export type CueCharacterDeclaration<S extends CueState> = {
  readonly poses: { readonly [name: string]: CuePatch<S> };
  readonly expressions: { readonly [name: string]: CuePatch<S> };
  readonly sliders: { readonly [name: string]: CueSlider<S> };
  readonly moves: { readonly [name: string]: CueMove<S> };
};

/** A character: its state's starting value, and what it declares. */
export type CueCharacter<S extends CueState = CueState, D extends CueCharacterDeclaration<S> = CueCharacterDeclaration<S>> = D & { readonly initial: S };

/**
 * Declares a character from its starting state and what it can be told: `poses` and `expressions` are named patches
 * over the state, `sliders` name single number controls, `moves` are performances (CueMove).
 */
export const defineCueCharacter = <S extends CueState, const D extends CueCharacterDeclaration<S>>(initial: S, declaration: D): CueCharacter<S, D> =>
  ({ ...declaration, initial });

/**
 * Any character, whatever its state: what a score's cast is constrained by. A move's `sample` takes `never` here
 * because a character's own sample takes its own state, which only its own compile hands it.
 */
export type AnyCueCharacter = {
  readonly initial: CueState;
  readonly poses: { readonly [name: string]: CuePatch<CueState> };
  readonly expressions: { readonly [name: string]: CuePatch<CueState> };
  readonly sliders: { readonly [name: string]: { readonly path: string; readonly min: number; readonly max: number } };
  readonly moves: {
    readonly [name: string]: {
      readonly writes: readonly string[];
      readonly markers?: { readonly [name: string]: number };
      readonly seconds?: number;
      readonly sample: (seconds: number, entry: never) => CuePatch<CueState>;
    };
  };
};

/** The state type a character holds. */
export type CueCharacterState<C> = C extends { initial: infer S extends CueState } ? S : never;
