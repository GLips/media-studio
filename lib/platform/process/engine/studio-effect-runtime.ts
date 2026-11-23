// studio-effect-runtime.ts: where Effect code meets the studio's promise world, a CLI verb or an older engine
// module awaiting an Effect program. One runner, so every program gets the same Node services and its progress
// logs read the same on stderr.
//
// A failure rejects with the program's own error (a Schema.TaggedError whose message is its sentence), which
// cli/studio.ts prints as one line; a defect rejects with the thrown value, its stack intact.
//
// A signal that ends the process (studio-signal-exit.ts) interrupts every program running, so its scopes close
// before the exit: its children are killed and its temp folders removed.
import { NodeServices } from '@effect/platform-node';
import { Cause, Console, Effect, Exit, Fiber, Formatter, Layer, Logger, Schema } from 'effect';
import { onStudioSignalExit } from './studio-signal-exit.ts';

const isLogText = (part: unknown): part is string => typeof part === 'string';

/** Progress logs (Effect.log) as plain lines on stderr, a string as written: the CLI's stdout is its payload. */
const studioProgressLogger = Logger.make(({ message }) => {
  // Effect.log's arguments arrive as one array.
  const parts: readonly unknown[] = Array.isArray(message) ? message : [message];
  process.stderr.write(`${parts.map((part) => (isLogText(part) ? part : Formatter.format(part))).join(' ')}\n`);
});

const studioProgressLoggerLayer = Logger.layer([studioProgressLogger]);

/** Node's file system, path, child processes and terminal, and the progress logger, beneath every program. */
export const studioNodeLayer = Layer.mergeAll(NodeServices.layer, studioProgressLoggerLayer);

/**
 * Runs `program` with `layer` built over the studio's Node services, which the program may use directly too;
 * resolves with its value, or rejects with its first failure as thrown, so a caller's `catch` reads the tagged
 * error itself. A program that needs only Node's services passes `Layer.empty`.
 */
export function runStudioEffect<A, E, R, LE>(
  program: Effect.Effect<A, E, R | NodeServices.NodeServices>,
  layer: Layer.Layer<R, LE, NodeServices.NodeServices>,
): Promise<A> {
  const services = layer.pipe(Layer.provideMerge(studioNodeLayer));
  const fiber = Effect.runFork(Effect.provide(program, services));
  let signalled = false;
  const forgetSignal = onStudioSignalExit(() => {
    signalled = true;
    return Effect.runPromise(Fiber.interrupt(fiber));
  });
  return new Promise((resolve, reject) => {
    fiber.addObserver((exit) => {
      forgetSignal();
      // Never settles once a signal interrupted it: the process is exiting with the signal's code, and a caller's
      // catch would print the interruption as the command's failure first.
      if (signalled) return;
      if (Exit.isSuccess(exit)) resolve(exit.value);
      else reject(Cause.squash(exit.cause));
    });
  });
}

const StudioJsonOutput = Schema.fromJsonString(Schema.Json, { space: 2 });

/** `value` as indented JSON on stdout, a verb's payload. */
export const printStudioJson = (value: Schema.Json) => Schema.encodeEffect(StudioJsonOutput)(value).pipe(Effect.flatMap(Console.log));
