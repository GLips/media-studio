// recorder-log-lines.ts: the rule every Studio Recorder line log (input.jsonl, clock.jsonl) is read by, one line at a
// time, so the Node stream and the browser's whole-text read can't drift. Pure.
//
// The recorder appends a line per event; one killed mid-take can leave its last line torn, which is dropped as the
// lines before it stand. Any other line that isn't what the log holds refuses the log, naming the file and line.
import { Result, Schema } from 'effect';

/** A line of a take's log that isn't what the log holds, and isn't its torn last line. `line` counts from 1. */
export class RecordingLogLineUnreadable extends Schema.TaggedError<RecordingLogLineUnreadable>()('RecordingLogLineUnreadable', {
  path: Schema.String,
  line: Schema.Finite,
  holds: Schema.String,
  why: Schema.String,
}) {
  override get message(): string {
    return `${this.path} line ${this.line} isn't ${this.holds}: ${this.why}`;
  }
}

/** Which log is read: its file (or URL) and what each line holds, as a refusal names them. */
export type RecorderLogNamed = { readonly path: string; readonly holds: string };

/** A bad line held back until a later line shows it wasn't the last; none while every line so far decoded. */
export type RecorderLogHeldLine = { readonly line: number; readonly why: string } | undefined;

/**
 * One non-blank line, `line` counting from 1, decoded or not, read after `held`: what to hold now and the value it
 * yields, or the log's refusal once a held line proves not to be the last. What's held at the end is dropped.
 */
export function recorderLogLineStep<A>(log: RecorderLogNamed, held: RecorderLogHeldLine, line: number, decoded: Result.Result<A, { readonly message: string }>): Result.Result<readonly [RecorderLogHeldLine, readonly A[]], RecordingLogLineUnreadable> {
  if (held) return Result.fail(new RecordingLogLineUnreadable({ ...log, ...held }));
  return Result.isSuccess(decoded) ? Result.succeed([undefined, [decoded.success]]) : Result.succeed([{ line, why: decoded.failure.message }, []]);
}

/** A whole log's text, every line decoded by `decode`, under the torn-last-line rule. */
export function parseRecorderLogLines<A>(log: RecorderLogNamed, text: string, decode: (line: string) => Result.Result<A, { readonly message: string }>): Result.Result<A[], RecordingLogLineUnreadable> {
  let held: RecorderLogHeldLine;
  const values: A[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const stepped = recorderLogLineStep(log, held, index + 1, decode(line));
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
    [held] = stepped.success;
    values.push(...stepped.success[1]);
  }
  return Result.succeed(values);
}
