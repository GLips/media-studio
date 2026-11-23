import { describeRule } from "../lib/rule-spec.ts";
import { requireErrorMessageRule } from "./require-error-message.ts";

const ERRORS = "lib/footage/library/engine/library-errors.ts";
const IMPORTS = `import { Data, Schema } from "effect";`;

describeRule("require-error-message", requireErrorMessageRule, {
  obvious: [
    {
      name: "a schema error with fields and no sentence",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class ItemMissing extends Schema.TaggedError<ItemMissing>()("ItemMissing", {\n  itemId: Schema.String,\n}) {}`,
      errors: [{ messageId: "missingMessage" }],
    },
  ],

  adversarial: [
    {
      name: "a Data error, whose factory takes no fields object",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class LibraryLocked extends Data.TaggedError("LibraryLocked")<{ readonly path: string }> {}`,
      errors: [{ messageId: "missingMessage" }],
    },
    {
      name: "the factory imported bare",
      filename: ERRORS,
      code: `import { TaggedError } from "effect/Schema";\nimport * as S from "effect/Schema";\nexport class ItemMissing extends TaggedError<ItemMissing>()("ItemMissing", { itemId: S.String }) {}`,
      errors: [{ messageId: "missingMessage" }],
    },
    {
      // A static getter is the class's, not an instance's: the CLI reads the instance.
      name: "a static message getter, which no instance reads",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class ItemMissing extends Schema.TaggedError<ItemMissing>()("ItemMissing", { itemId: Schema.String }) {\n  static get message() { return "missing"; }\n}`,
      errors: [{ messageId: "missingMessage" }],
    },
  ],

  legal: [
    {
      name: "a message getter built from the fields",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class ItemMissing extends Schema.TaggedError<ItemMissing>()("ItemMissing", { itemId: Schema.String }) {\n  override get message(): string { return \`no library item \${this.itemId}\`; }\n}`,
    },
    {
      name: "a message field in the schema",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class ProbeRefused extends Schema.TaggedError<ProbeRefused>()("ProbeRefused", { message: Schema.String }) {}`,
    },
    {
      name: "a class extending another error class inherits its message",
      filename: ERRORS,
      code: `import { FfmpegFailed } from "#lib/platform/ffmpeg/engine/studio-ffmpeg.ts";\nexport class ProxyFailed extends FfmpegFailed {}`,
    },
    {
      name: "a schema struct that isn't an error",
      filename: ERRORS,
      code: `${IMPORTS}\nexport class LibraryItem extends Schema.Class<LibraryItem>("LibraryItem")({ id: Schema.String }) {}`,
    },
  ],
});
