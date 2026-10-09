// composition-render-placements-install.ts: what the render serves this page's painted shots, set as the bundle loads:
// the placements it made once in Node (VideoProps' stampPlacements), adopted before they compile, and its solved-paint
// cache (paintCache), which their sheet solves read and fill (painting-render-placements.ts). Imported for its effect,
// in the bundle's entry.

import { getInputProps } from 'remotion';
import { setPaintingRenderServed } from '#lib/paint/document/studio/painting-render-placements.ts';
import type { VideoProps } from '#lib/picture/video/models/composition-props.ts';

// SAFETY: a video's renders hand it VideoProps (render-session.ts's props()); a still's or a blockout's carry neither, so they read as unset.
const { stampPlacements, paintCache } = getInputProps() as Partial<VideoProps>;
setPaintingRenderServed({ ...(stampPlacements && { stampPlacements }), ...(paintCache && { paintCache }) });
