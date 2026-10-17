// storyboard-timeline.ts: a project's storyboard resolved to its Timeline for code that needs a scene's clock outside
// its binding in video.tsx, such as a painted shot's span or a model's beat frames, built once at module scope. It
// resolves exactly as defineVideo does, from the same voice and music, and throws as it does on any diagnostic, so a
// helper can't run on other frames than the video.

import { resolveStoryboard, storyboardDiagnosticsMessage, type ResolveStoryboardInputs } from './resolve-storyboard.ts';
import type { Storyboard, TimelineOfStoryboard } from './storyboard.ts';

/**
 * Storyboard `S`'s Timeline: `storyboardTimeline(storyboard, { music }).clock('turntable')`. Pass what video.tsx passes
 * defineVideo: audio/manifest.ts's `voice` for a voiced storyboard, music/index.ts's `music` for a `{ music }` grid.
 */
export function storyboardTimeline<const S extends Storyboard>(storyboard: S, inputs: Omit<ResolveStoryboardInputs, 'voiceRead'> = {}): TimelineOfStoryboard<S> {
  // Without the manifest every line would be estimated, and the helper would draw on other frames than the video.
  if (storyboard.voice !== undefined && inputs.voice === undefined) throw new Error(`${storyboard.title}'s storyboard is voiced: pass audio/manifest.ts's voice, as video.tsx does`);
  const { timeline, diagnostics } = resolveStoryboard(storyboard, inputs);
  if (!timeline || diagnostics.length) throw new Error(storyboardDiagnosticsMessage(`the storyboard of ${storyboard.title}`, diagnostics));
  return timeline;
}
