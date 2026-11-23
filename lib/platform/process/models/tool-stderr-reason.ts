// tool-stderr-reason.ts: why a command-line tool failed, as one line from its stderr, for an error's message. A tool
// says why near its end, often over a few lines, and a CLI error prints a single line.

// Enough lines for "what file" and "what went wrong", which ffmpeg says on separate lines.
const REASON_LINES = 3;
const REASON_CHARS = 300;

/**
 * The last few lines of `stderr` that aren't `noise` (a tool's progress and its generic sign-offs), joined with " / "
 * and cut to their last 300 characters; empty when nothing's left. Carriage returns split lines too: progress
 * rewrites one terminal line with them.
 */
export function toolStderrReason(stderr: string, noise?: RegExp): string {
  const lines = stderr.split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line && !noise?.test(line));
  const reason = lines.slice(-REASON_LINES).join(' / ');
  return reason.length > REASON_CHARS ? `…${reason.slice(-REASON_CHARS)}` : reason;
}
