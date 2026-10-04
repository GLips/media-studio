// render-browser-failure.ts: an error that failed as a render's browser did, not as its frames do: its page stuck or
// crashed, its GPU process hung, lost or fallen back to software. Drawn again in a fresh browser, the frames may pass,
// so a chunked render (render-chunks.ts) draws them once more. Errors cross from a page to Node as text, so the mark
// is text: whoever words such an error marks it here, and the retry reads only the mark.

/** Ends the message of an error that failed as its browser did. */
export const RENDER_BROWSER_FAILURE_MARK = ' [a browser failure: a fresh browser may draw it]';

/** `text`, an error's message, marked as a browser's failure. */
export const renderBrowserFailureText = (text: string): string => `${text}${RENDER_BROWSER_FAILURE_MARK}`;

/** Puppeteer's words for a page or its target gone, which nothing here writes. */
const BROWSER_GONE = /Page crashed!|Target closed|Session closed/;

/** Whether an error's `message` says it failed as its browser did. */
export const isRenderBrowserFailure = (message: string): boolean => message.includes(RENDER_BROWSER_FAILURE_MARK) || BROWSER_GONE.test(message);
