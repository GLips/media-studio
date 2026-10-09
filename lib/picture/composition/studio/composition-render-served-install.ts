// composition-render-served-install.ts: what the render serves this page, set as the bundle loads: the placements it
// made once in Node (VideoProps' stampPlacements), adopted before its painted shots compile, its solved-paint cache
// (paintCache), which their sheet solves read and fill (painting-render-placements.ts), and the sink its frames go
// to (frameSink, picture-frame-sink.ts). Imported for its effect, in the bundle's entry.

import { getInputProps } from 'remotion';
import { setPaintingRenderServed } from '#lib/paint/document/studio/painting-render-placements.ts';
import { setPictureFrameSink } from '#lib/picture/readback/studio/picture-frame-sink.ts';
import type { VideoProps } from '#lib/picture/video/models/composition-props.ts';

// SAFETY: a render hands its compositions VideoProps or a still's props, which carry a frameSink and no paint; a pass
// without a picture carries neither, so they read as unset.
const { stampPlacements, paintCache, frameSink } = getInputProps() as Partial<VideoProps>;
setPaintingRenderServed({ ...(stampPlacements && { stampPlacements }), ...(paintCache && { paintCache }) });
setPictureFrameSink(frameSink);
