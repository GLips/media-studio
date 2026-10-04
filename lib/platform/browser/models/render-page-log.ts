// render-page-log.ts: a line a render's page writes for the render's terminal: the progress a long frame makes (a
// painted shot's solves) and warnings that fail nothing. The page logs it to its console behind the prefix
// (studio/render-page-log.ts); the render's Node side picks it out of the browser's log, prints it on stderr, and
// counts it as the page being alive (render-browser.ts).

/** Marks a console line as one for the render's terminal; its text follows. */
export const RENDER_PAGE_LOG_PREFIX = '[studio page] ';

/** The text of console line `text` when it's a render page's line, else null. */
export const renderPageLogText = (text: string): string | null => (text.startsWith(RENDER_PAGE_LOG_PREFIX) ? text.slice(RENDER_PAGE_LOG_PREFIX.length) : null);
