// composition-props.ts: what Node hands the compositions Root.tsx registers (lib/picture/composition/studio/Root.tsx),
// and how it renders them: the contract between the renderer (lib/output/render/engine/) and the composition.

import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';

export type VideoProps = {
  /** Burn captions in. */
  captions: boolean;
  /** Measure every frame for the framing check and motion tracks (see probe.tsx). */
  probe: boolean;
  /** Previs scenes show their blockouts, even where generated footage exists (see previs.tsx). */
  blockouts: boolean;
  /** Play the project's cue list (sfx/cues.json) whether or not the video does (`sfxCueList`), to audition it. */
  auditionSfxCueList?: boolean;
  /** Time the work drawing code offers and log it, for `studio profile` (see frame-profiler.tsx). */
  profile?: boolean;
  /** How the lens draws: fast, or the reference the fast path is measured against (lens-mode.ts). */
  lens?: LensMode;
  /**
   * Painting property values over every scene's, by the source's factory name, as `studio look --set` checked them:
   * a dial swept in context (painting-value-overrides-install.ts).
   */
  paintingValues?: PaintingValuesProp;
};

/** Property values by painting source, then by property: JSON across the page's boundary. */
export type PaintingValuesProp = Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;

/** One previs scene's blockout alone (BlockoutSolo), for `studio gen video`, run for the chosen model's `seconds`. */
export type BlockoutSoloProps = { scene: string; seconds: number };

export type ReplayProps = VideoProps & { order: number[] };

/**
 * How Node renders a composition rather than what it draws, carried in its defaultProps because selectComposition
 * hands those back; the components ignore it. lib/output/render/engine/render-session.ts's workersFor reads it.
 */
export type CompositionRenderSettings = { renderWorkers?: number };
