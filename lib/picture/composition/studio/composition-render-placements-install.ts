// composition-render-placements-install.ts: where the render serves the placements it made once in Node (VideoProps'
// stampPlacements), set for this page's painted shots to adopt before they compile (painting-render-placements.ts).
// Imported for its effect, in the bundle's entry.

import { getInputProps } from 'remotion';
import { setPaintingRenderPlacementsSource } from '#lib/paint/document/studio/painting-render-placements.ts';
import type { VideoProps } from '#lib/picture/video/models/composition-props.ts';

// SAFETY: a video's renders hand it VideoProps (render-session.ts's props()); a still's or a blockout's carry no stampPlacements, so it reads as unset.
const { stampPlacements } = getInputProps() as Partial<VideoProps>;
if (stampPlacements) setPaintingRenderPlacementsSource(stampPlacements);
