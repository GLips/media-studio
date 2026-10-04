import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wholeBrowserPageError } from './browser-page-error.ts';

const PROBLEMS = 'painting mug has 2 problems:\n  clay-block.diameterPx: must be above 0\n  clay-block.charge.water: must be 0..1';
const PAGE_STACK = `Error: ${PROBLEMS}\n    at evaluateAt (http://localhost:3000/bundle.js:10:5)\n    at painting (http://localhost:3000/bundle.js:20:7)`;

/** An error as Remotion hands one back: `message` what it kept, `stack` the page's. */
function remotionError(message: string, stack: string): Error {
  const error = new Error(message);
  error.stack = stack;
  return error;
}

test("a page's error cut to its head by Remotion gets its whole message back from the page's stack", () => {
  // cancelRender's: the stack's first line. An uncaught throw's: the description less a line a call frame, too few
  // lines or too many.
  for (const cut of ['Error: painting mug has 2 problems:', 'painting mug has 2 problems:\n  clay-block.diameterPx: must be above 0', PAGE_STACK.replace('Error: ', '')]) {
    assert.equal(wholeBrowserPageError(remotionError(cut, PAGE_STACK)).message, PROBLEMS);
  }
  // A Node error, and a page's TypeError cancelRender wrote its message ahead of, keep theirs.
  assert.equal(wholeBrowserPageError(new Error('rendered 3 of 4 stills')).message, 'rendered 3 of 4 stills');
  const typed = 'x is not a function\nTypeError: x is not a function\n    at f (http://localhost:3000/bundle.js:1:1)';
  assert.equal(wholeBrowserPageError(remotionError('x is not a function', typed)).message, 'x is not a function');
});
