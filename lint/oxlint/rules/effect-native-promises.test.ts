import { describeRule } from "../lib/rule-spec.ts";
import { effectNativePromisesRule } from "./effect-native-promises.ts";

const ENGINE = "lib/footage/library-media/engine/library-frame-decoder.ts";

describeRule("effect-native-promises", effectNativePromisesRule, {
  obvious: [
    {
      name: "a promise brought in with no catch",
      filename: ENGINE,
      code: `import { Effect } from "effect";\nimport { readFrameAt } from "./frame-reader.ts";\nexport const frameAt = (seconds: number) => Effect.promise(() => readFrameAt(seconds));`,
      errors: [{ messageId: "effectPromise" }],
    },
    {
      name: "a callback API wrapped in a hand-built promise",
      filename: ENGINE,
      code: `import type { Server } from "node:http";\nexport const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, () => resolve(1)));`,
      errors: [{ messageId: "promiseBuilt" }],
    },
  ],

  adversarial: [
    {
      name: "a queue chained with then and finally",
      filename: ENGINE,
      code: `export const enqueue = (queue: Promise<void>, read: () => Promise<void>, done: () => void) => queue.then(read).finally(done);`,
      errors: [{ messageId: "promiseChained" }, { messageId: "promiseChained" }],
    },
    {
      name: "a failure as a rejected promise",
      filename: "lib/footage/library/engine/library-levelled.ts",
      code: `export const refuse = (reason: string) => Promise.reject(reason);`,
      errors: [{ messageId: "promiseBuilt" }],
    },
    {
      name: "a rejection swallowed by .catch on a call's result",
      filename: "lib/footage/library/engine/library-levelled.ts",
      code: `import { measureAudibleLoudness } from "#lib/picture/audio/engine/loudness.ts";\nexport const loudness = (path: string) => measureAudibleLoudness(path).catch(() => undefined);`,
      errors: [{ messageId: "promiseChained" }],
    },
  ],

  legal: [
    {
      name: "Effect's and Stream's own catch, imported from effect",
      filename: ENGINE,
      code: `import { Effect, Stream } from "effect";\nexport const recover = <A>(effect: Effect.Effect<A, Error>, stream: Stream.Stream<A, Error>) => [effect.pipe(Effect.catch(() => Effect.void)), Stream.catch(stream, () => Stream.empty)];`,
    },
    {
      name: "a promise brought in through tryPromise with an async try",
      filename: ENGINE,
      code: `import { Effect } from "effect";\nimport { DecodeFailed } from "./library-media-errors.ts";\nimport { decode } from "./decode.ts";\nexport const decodeFrame = (path: string) => Effect.tryPromise({\n  try: async () => await decode(path),\n  catch: (error) => new DecodeFailed({ path, reason: String(error) }),\n});`,
    },
    {
      name: "a promise type in a signature, which builds nothing",
      filename: ENGINE,
      code: `export type FrameReader = (seconds: number) => Promise<Uint8Array>;`,
    },
    {
      name: "the feature's studio code, which this rule doesn't read",
      filename: "lib/footage/library/studio/use-library-input-log.ts",
      code: `export const load = (url: string) => fetch(url).then((response) => response.text());`,
    },
  ],
});
