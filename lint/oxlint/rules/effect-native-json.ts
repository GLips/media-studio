// ─── effect-native-json ────────────────────────────────────────
//
// Makes sure: an Effect-native feature (EFFECT_NATIVE_FEATURES in
// studio-tree.ts) decodes JSON with its Schema: `Schema.fromJsonString(Item)`,
// decoded with `Schema.decodeUnknownEffect`. `JSON.parse` returns `any`, and
// the `as ItemJson` that follows it claims a shape nothing checked, so an old
// or hand-edited item.json fails three calls later instead of where it's read.
//
// Models and engine both: a model decodes a line, the engine a file.
//
// NEGATIVE SPACE: specs aren't read; a fixture may build JSON by hand. Writing
// JSON (`JSON.stringify`) is silent; encoding through the schema is better and
// a review call.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { effectNativeRole } from "../../policy/studio-tree.ts";

export const effectNativeJsonRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      jsonParse:
        "JSON.parse hands back an unchecked `any`, so a malformed file fails far from where it's read. Decode it with its schema: Schema.decodeUnknownEffect(Schema.fromJsonString(Item)).",
    },
  },
  create(context, file) {
    const role = effectNativeRole(file.position);
    if (role !== "models" && role !== "engine") return {};

    return {
      // The member, not the call, so `const parse = JSON.parse` reports too.
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.object.name !== "JSON") return;
        if (staticKeyName(node.property, node.computed) === "parse") context.report({ node, messageId: "jsonParse" });
      },
    };
  },
});
