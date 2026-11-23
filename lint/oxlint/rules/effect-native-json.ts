// ─── effect-native-json ────────────────────────────────────────
//
// Makes sure: an Effect-native feature (EFFECT_NATIVE_FEATURES in
// studio-tree.ts) decodes JSON with its Schema: `Schema.fromJsonString(Item)`,
// decoded with `Schema.decodeUnknownEffect`. `JSON.parse` returns `any`, and
// the `as ItemJson` that follows it claims a shape nothing checked, so an old
// or hand-edited item.json fails three calls later instead of where it's read.
//
// Models and engine both: a model decodes a line, the engine a file; and the
// feature's CLI verbs, which print what an Effect hands back.
//
// NEGATIVE SPACE: specs aren't read; a fixture may build JSON by hand. Writing
// JSON (`JSON.stringify`) is silent; encoding through the schema is better and
// a review call. `JSON` passed on under another name (`const J = JSON`) or
// reached through `globalThis` isn't followed.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { effectNativePlace } from "../../policy/studio-tree.ts";
import { type ESTree } from "@oxlint/plugins";

const isJsonGlobal = (node: ESTree.Node | null | undefined) => node?.type === "Identifier" && node.name === "JSON";

export const effectNativeJsonRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      jsonParse:
        "JSON.parse hands back an unchecked `any`, so a malformed file fails far from where it's read. Decode it with its schema: Schema.decodeUnknownEffect(Schema.fromJsonString(Item)).",
    },
  },
  create(context, file) {
    const place = effectNativePlace(file.path, file.position);
    if (place !== "models" && place !== "engine" && place !== "verb") return {};

    return {
      // The member, not the call, so `const parse = JSON.parse` reports too.
      MemberExpression(node) {
        if (!isJsonGlobal(node.object)) return;
        if (staticKeyName(node.property, node.computed) === "parse") context.report({ node, messageId: "jsonParse" });
      },
      // `const { parse } = JSON` takes the same function with no member expression to see.
      ObjectPattern(node) {
        const { parent } = node;
        const fromJson = (parent.type === "VariableDeclarator" && isJsonGlobal(parent.init)) ||
          (parent.type === "AssignmentExpression" && isJsonGlobal(parent.right));
        if (!fromJson) return;
        for (const property of node.properties) {
          if (property.type === "Property" && staticKeyName(property.key, property.computed) === "parse") context.report({ node: property, messageId: "jsonParse" });
        }
      },
    };
  },
});
