// page-trace-context.ts: how drawing code reaches its page's trace (lib/platform/trace/studio/page-trace.ts): the
// render page's one recorder in a render, Video.tsx providing it, and one that records nothing anywhere else. Its value
// never changes in a page, so a shot that depends on it never loads anew for it.
import { createContext, useContext } from 'react';
import { NO_PAGE_TRACE, type PageTrace } from '#lib/platform/trace/studio/page-trace.ts';

export const PageTraceContext = createContext<PageTrace>(NO_PAGE_TRACE);

/** The page's trace: the render page's recorder in a render, one that records nothing in the Studio's preview. */
export const usePageTrace = () => useContext(PageTraceContext);
