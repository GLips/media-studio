import { describeRule } from "../lib/rule-spec.ts";
import { effectNativeFailuresRule } from "./effect-native-failures.ts";

const ENGINE = "lib/footage/library/engine/library-store.ts";

describeRule("effect-native-failures", effectNativeFailuresRule, {
  obvious: [
    {
      name: "a native error thrown for an expected failure",
      filename: ENGINE,
      code: `export const findItem = (items: Map<string, string>, id: string) => {\n  const item = items.get(id);\n  if (item === undefined) throw new Error(\`no library item \${id}\`);\n  return item;\n};`,
      errors: [{ messageId: "thrown" }, { messageId: "nativeError" }],
    },
    {
      name: "a try/catch ladder",
      filename: ENGINE,
      code: `import { readItem } from "./item-file.ts";\nexport const loadItem = (path: string) => {\n  try {\n    return readItem(path);\n  } catch {\n    return undefined;\n  }\n};`,
      errors: [{ messageId: "tryCatch" }],
    },
  ],

  adversarial: [
    {
      // Throwing inside a generator reads as Effect code and is still a defect.
      name: "a tagged error thrown inside Effect.gen rather than yielded",
      filename: ENGINE,
      code: `import { Effect } from "effect";\nimport { ItemMissing } from "./library-errors.ts";\nexport const findItem = (id: string) => Effect.gen(function* () {\n  throw new ItemMissing({ itemId: id });\n});`,
      errors: [{ messageId: "thrown" }],
    },
    {
      name: "an Error subclass, the hand-rolled tag",
      filename: ENGINE,
      code: `export class LibraryLocked extends Error {\n  readonly _tag = "LibraryLocked";\n}`,
      errors: [{ messageId: "nativeError" }],
    },
    {
      name: "a native error built without new, for Effect.fail",
      filename: "lib/footage/recording/engine/recording-reader.ts",
      code: `import { Effect } from "effect";\nexport const refuse = (path: string) => Effect.fail(TypeError(\`not a recording: \${path}\`));`,
      errors: [{ messageId: "nativeError" }],
    },
  ],

  legal: [
    {
      name: "a tagged error yielded from the generator",
      filename: ENGINE,
      code: `import { Effect } from "effect";\nimport { ItemMissing } from "./library-errors.ts";\nexport const findItem = (items: Map<string, string>, id: string) => Effect.gen(function* () {\n  const item = items.get(id);\n  if (item === undefined) return yield* new ItemMissing({ itemId: id });\n  return item;\n});`,
    },
    {
      name: "a promise brought in through tryPromise",
      filename: ENGINE,
      code: `import { Effect } from "effect";\nimport { TranscriptionFailed } from "./footage-transcriber.ts";\nimport { transcribeFootage } from "./transcribe-footage.ts";\nexport const transcribe = (path: string) => Effect.tryPromise({\n  try: () => transcribeFootage(path),\n  catch: (error) => new TranscriptionFailed({ path, reason: String(error) }),\n});`,
    },
    {
      name: "a feature not yet on Effect",
      filename: "lib/footage/capture/engine/capture-shots.ts",
      code: `export const refuse = () => { throw new Error("no shots"); };`,
    },
    {
      name: "the feature's models, which this rule doesn't read",
      filename: "lib/footage/library/models/library-flags.ts",
      code: `export const parseFlag = (text: string) => { if (text === "") throw new Error("empty flag"); return text; };`,
    },
  ],
});
