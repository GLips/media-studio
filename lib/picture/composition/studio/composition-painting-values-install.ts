// composition-painting-values-install.ts: the render's painting values (`studio look --set`, VideoProps'
// paintingValues), set for painting() as the bundle loads. Imported for its effect, first in the bundle's entry: a
// scene may evaluate a painting as its module loads, and one evaluated before this runs keeps its own values.

import { getInputProps } from 'remotion';
import { setPaintingValueOverrides } from '#lib/paint/document/models/painting-source.ts';
import type { VideoProps } from '#lib/picture/video/models/composition-props.ts';

// SAFETY: a video's renders hand it VideoProps (render-session.ts's props()); a still's or a blockout's carry no paintingValues, so it reads as unset.
const { paintingValues } = getInputProps() as Partial<VideoProps>;
if (paintingValues) setPaintingValueOverrides(paintingValues);
