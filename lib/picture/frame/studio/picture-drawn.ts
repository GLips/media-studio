// picture-drawn.ts: whether a render pass draws the picture. A pass that only measures frames (the timeline, the
// framing check) or gathers their sound draws none, so what paints on the GPU checks its props and paints nothing.

import { createContext, useContext } from 'react';

/** Whether this pass draws the picture: VideoProps.picture, which Video.tsx provides; anywhere else draws. */
export const PictureDrawnContext = createContext(true);

export const usePictureDrawn = (): boolean => useContext(PictureDrawnContext);
