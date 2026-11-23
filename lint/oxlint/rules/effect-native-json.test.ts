import { describeRule } from "../lib/rule-spec.ts";
import { effectNativeJsonRule } from "./effect-native-json.ts";

const MODEL = "lib/footage/library/models/library-item.ts";

describeRule("effect-native-json", effectNativeJsonRule, {
  obvious: [
    {
      name: "a parse cast to the item's type",
      filename: MODEL,
      code: `import type { LibraryItemJson } from "./library-item-json.ts";\n// SAFETY: written by the library.\nexport const readItem = (text: string) => JSON.parse(text) as LibraryItemJson;`,
      errors: [{ messageId: "jsonParse" }],
    },
  ],

  adversarial: [
    {
      name: "the engine parsing a line log, with no cast to look for",
      filename: "lib/footage/recording/engine/clock-log.ts",
      code: `export const clockSamples = (text: string) => text.split("\\n").filter(Boolean).map((line) => JSON.parse(line));`,
      errors: [{ messageId: "jsonParse" }],
    },
    {
      name: "the parser passed by reference",
      filename: MODEL,
      code: `export const readLines = (lines: string[]) => lines.map(JSON.parse);`,
      errors: [{ messageId: "jsonParse" }],
    },
    {
      name: "the computed spelling",
      filename: MODEL,
      code: `export const readItem = (text: string) => JSON["parse"](text);`,
      errors: [{ messageId: "jsonParse" }],
    },
    {
      name: "the parser destructured off JSON",
      filename: "lib/footage/library/engine/library-store.ts",
      code: `const { parse } = JSON;\nexport const readItem = (text: string) => parse(text);`,
      errors: [{ messageId: "jsonParse" }],
    },
    {
      name: "a footage CLI verb parsing a flag's JSON",
      filename: "cli/commands/transcribe.ts",
      code: `export const readOptions = (text: string) => JSON.parse(text);`,
      errors: [{ messageId: "jsonParse" }],
    },
  ],

  legal: [
    {
      name: "decoding with the item's schema",
      filename: MODEL,
      code: `import { Schema } from "effect";\nimport { LibraryItemJson } from "./library-item-json.ts";\nexport const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryItemJson));`,
    },
    {
      name: "writing JSON",
      filename: MODEL,
      code: `export const itemText = (item: { id: string }) => \`\${JSON.stringify(item, null, 2)}\\n\`;`,
    },
    {
      name: "destructuring stringify",
      filename: MODEL,
      code: `const { stringify } = JSON;\nexport const itemText = (item: { id: string }) => stringify(item);`,
    },
    {
      name: "a feature not yet on Effect",
      filename: "lib/output/review/models/review-threads.ts",
      code: `export const readThreads = (text: string) => JSON.parse(text);`,
    },
  ],
});
