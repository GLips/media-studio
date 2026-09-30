// framing-marks.ts: what the probe (lib/picture/measurement/studio/probe.tsx) reports of each frame for the framing
// check: every highlight, tag and caption box, and the take fits scenes strained. Judged in
// lib/output/picture-checks/models/framing-check.ts.

import type { Rect } from '#lib/picture/frame/models/geometry.ts';

/** Two neighbouring pins that play the take or footage between them at `speed` times its own pace. */
export type TakeFitStrain = { source: 'take' | 'footage'; from: string; to: string; speed: number };

export type FramingMark = {
  kind: 'subject' | 'tag' | 'caption';
  name?: string;
  rect: Rect;
  /** The part of `rect` its clipping ancestors (a split panel, a phone screen) leave showing. */
  shown: Rect;
  strength: number;
  /** Its own opacity times every ancestor's, the scene's crossfade included. */
  opacity: number;
  /** The scene it belongs to, and that scene's clock; none for the caption. */
  scene?: string;
  sceneT?: number;
};
/** A strained take fit some scene painted on the frame made, with the scenes it could be from. */
export type FramingTakeFitStrain = TakeFitStrain & { scenes: string[] };
export type FramingReport = { frame: number; marks: FramingMark[]; takeFitStrains: FramingTakeFitStrain[] };

/** The artifact the probe emits for each frame. */
export const framingArtifactName = (frame: number) => `framing-${frame}.json`;
