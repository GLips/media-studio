// studio-effect-runtime.ts: where Effect code meets the studio's promise world, a CLI verb or an older engine
// module awaiting an Effect program. One runner, so every program gets the same Node services and its progress
// logs read the same on stderr.
//
// A failure rejects with the program's own error (a Schema.TaggedError whose message is its sentence), which
// cli/studio.ts prints as one line; a defect rejects with the thrown value, its stack intact.
import { NodeServices } from '@effect/platform-node';
import { Cause, Console, Effect, Exit, Formatter, Layer, Logger, Schema } from 'effect';

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
export async function runStudioEffect<A, E, R, LE>(
  program: Effect.Effect<A, E, R | NodeServices.NodeServices>,
  layer: Layer.Layer<R, LE, NodeServices.NodeServices>,
): Promise<A> {
  const services = layer.pipe(Layer.provideMerge(studioNodeLayer));
  const exit = await Effect.runPromiseExit(Effect.provide(program, services));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

const StudioJsonOutput = Schema.fromJsonString(Schema.Json, { space: 2 });

/** `value` as indented JSON on stdout, a verb's payload. */
export const printStudioJson = (value: Schema.Json) => Schema.encodeEffect(StudioJsonOutput)(value).pipe(Effect.flatMap(Console.log));
