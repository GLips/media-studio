// render-page-log.ts: lines a render's page writes for its Node side, the one wire Remotion carries back: the page logs
// each to its console behind a prefix (studio/render-page-log.ts), and Node picks it out of the browser's log by that
// prefix. A page line is for the render's terminal: the progress a long frame makes (a painted shot's solves) and
// warnings that fail nothing. A pulse says only that the page is making progress. Node prints each line, and counts
// lines and pulses as the page alive (render-watch.ts). A profiling render's entries go behind a prefix of their own.

/** Marks a console line as one for the render's terminal; its text follows. */
export const RENDER_PAGE_LOG_PREFIX = '[studio page] ';

/** Marks a console line as a pulse: progress no line reports (a quick solve), so Node needn't take a quiet page as stuck. */
export const RENDER_PAGE_PULSE_PREFIX = '[studio pulse]';

/** The text of console line `text` when it's a line logged behind `prefix`, else null. */
export const renderHostLineText = (prefix: string, text: string): string | null => (text.startsWith(prefix) ? text.slice(prefix.length) : null);

/** The text of console line `text` when it's a render page's line for the terminal, else null. */
export const renderPageLogText = (text: string): string | null => renderHostLineText(RENDER_PAGE_LOG_PREFIX, text);

/** Whether console line `text` says its page is making progress: a line for the terminal, or a pulse. */
export const renderPageAlive = (text: string): boolean => text.startsWith(RENDER_PAGE_LOG_PREFIX) || text.startsWith(RENDER_PAGE_PULSE_PREFIX);
