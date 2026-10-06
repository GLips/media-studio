// browser-page-error.ts: an error a render's page threw, given back its whole message and none of its stack frames.
// Remotion cuts a page's error to its stack's first line (cancelRender's), or to its description less a line a call
// frame (an uncaught throw's). The call frames don't count a stack's `at async …` lines, so an async throw arrives
// with the page's bundle frames on, and a message of several lines, a painting's list of problems, as its head. The
// page's stack holds every line before its first frame.

/** A V8 stack frame's line. */
const STACK_FRAME = /^\s+at /;
/** A V8 stack's head line for an `Error` class: its name, then its message. */
const STACK_HEAD = /^[\w$]*(?:Error|Exception): /;
/** A line opening with a name, as a stack's head line does for any error class (`StampSheetRefusal: …`). */
const NAMED_LINE = /^[\w$.]+: /;

/** `text`'s lines before its first stack frame. */
function linesBeforeFrames(text: string): string[] {
  const lines = text.split('\n'), frames = lines.findIndex((line) => STACK_FRAME.test(line));
  return frames < 0 ? lines : lines.slice(0, frames);
}

/**
 * The message `stack` holds that opens with `opening`: from its head line, the first that is a name and then
 * `opening`, to its first frame, the name taken off. Null when no line is. A line before the head is cancelRender's:
 * it writes the message of an error whose stack doesn't open `Error:` ahead of that stack.
 */
function stackMessage(stack: string, opening: string): string | null {
  const lines = linesBeforeFrames(stack);
  const head = lines.findIndex((line) => {
    const name = NAMED_LINE.exec(line);
    return name !== null && line.slice(name[0].length) === opening;
  });
  return head < 0 ? null : [lines[head].replace(NAMED_LINE, ''), ...lines.slice(head + 1)].join('\n');
}

/**
 * `error` with its whole message and no stack frames: a page's message as its stack holds it, opening with what
 * Remotion kept; any other error's as it is.
 */
export function wholeBrowserPageError(error: Error): Error {
  const cut = linesBeforeFrames(error.message).join('\n').replace(STACK_HEAD, '');
  error.message = (error.stack && stackMessage(error.stack, cut.split('\n')[0])) || cut;
  return error;
}
