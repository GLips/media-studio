// composition-props.ts: what Node hands the compositions Root.tsx registers (lib/picture/composition/studio/Root.tsx),
// and how it renders them: the contract between the renderer (lib/output/render/engine/) and the composition.

import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import type { TraceDetail } from '#lib/platform/trace/models/trace-detail.ts';

export type VideoProps = {
  /** Burn captions in. */
  captions: boolean;
  /** Measure every frame for the framing check and motion tracks (see probe.tsx). */
  probe: boolean;
  /** Previs scenes show their blockouts, even where generated footage exists (see previs.tsx). */
  blockouts: boolean;
  /** Play the project's cue list (sfx/cues.json) whether or not the video does (`sfxCueList`), to audition it. */
  auditionSfxCueList?: boolean;
  /** The frames a render traces in detail (`studio render --trace`); none when left out. */
  traceDetail?: TraceDetail;
  /** How the lens draws: fast, or the reference the fast path is measured against (lens-mode.ts). */
  lens?: LensMode;
  /**
   * Painting property values over every scene's, by the source's factory name, as `studio look --set` checked them:
   * a dial swept in context (composition-painting-values-install.ts).
   */
  paintingValues?: PaintingValuesProp;
  /** Draw the picture (the default); off for a pass that only measures frames or gathers sound (video-format.ts). */
  picture?: boolean;
  /** Where the render serves the placements it made once in Node, for each page to adopt (render-placements.ts). */
  stampPlacements?: string;
  /** Where the render serves its solved-paint cache, for each page's sheet solves (render-paint-cache.ts). */
  paintCache?: string;
  /** Where the page sends each frame it composites (render-frame-sink.ts); none for a pass that sends no picture. */
  frameSink?: string;
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
