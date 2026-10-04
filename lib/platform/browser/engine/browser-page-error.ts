// browser-page-error.ts: an error a render's page threw, given back its whole message. Remotion cuts a page's error
// to its stack's first line (cancelRender's), or to its description less a line a call frame (an uncaught throw's,
// which keeps some frames when the page printed more than it counted), so a message of several lines, a painting's
// list of problems, arrives as its head, or with frames on. The page's stack holds every line before its first frame.

/** A V8 stack frame's line. */
const STACK_FRAME = /^\s+at /;
/** A V8 stack's head line: the error's name, then its message. */
const STACK_HEAD = /^[\w$]*(?:Error|Exception): /;

/** `text`'s lines before its first stack frame. */
function linesBeforeFrames(text: string): string[] {
  const lines = text.split('\n'), frames = lines.findIndex((line) => STACK_FRAME.test(line));
  return frames < 0 ? lines : lines.slice(0, frames);
}

/** The message `stack` opens with: its lines before its first frame, its error's name taken off the first. */
function stackMessage(stack: string): string {
  const head = linesBeforeFrames(stack);
  // cancelRender writes a non-`Error` error's message ahead of its stack, which repeats it after the error's name.
  const named = head.findIndex((line, i) => i > 0 && STACK_HEAD.test(line));
  return (named > 0 ? head.slice(named) : head).join('\n').replace(STACK_HEAD, '');
}

/**
 * `error` with its whole message when it's a page's whose message Remotion cut (what's left of it, frames taken off,
 * opens the message its stack opens with); any other error as it is.
 */
export function wholeBrowserPageError(error: Error): Error {
  if (!error.stack) return error;
  const cut = linesBeforeFrames(error.message).join('\n').replace(STACK_HEAD, ''), whole = stackMessage(error.stack);
  if (whole.startsWith(cut) && whole !== error.message) error.message = whole;
  return error;
}
