// lens-mode-context.ts: the lens mode a render was asked for (VideoProps.lens), for whatever draws through the lens.

import { createContext, use } from 'react';
import type { LensMode } from '../models/lens-mode.ts';

export const LensModeContext = createContext<LensMode>('fast');

export const useLensMode = () => use(LensModeContext);
