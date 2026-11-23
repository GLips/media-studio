// ─── no-manual-tag-comparison ──────────────────────────────────
//
// Makes sure: a variant added to a tagged union is a compile error at every
// site that branches on it. `Match.valueTags`, `Match.tagsExhaustive` and a
// tagged enum's `$match` refuse to compile until it has a branch; a chain of
// `x._tag === "A"`, or a `switch (x._tag)`, sends it down the last branch.
//
// The fixes: several variants, `Match.valueTags(x, { A: …, B: … })`; one
// variant, `Predicate.isTagged(x, "A")`; one error, `Effect.catchTag("A", …)`.
//
// NEGATIVE SPACE: `a._tag === b._tag` (same variant?), a tag as a table key
// (`handlers[x._tag]`, exhaustive at its declaration) and a tag passed to a
// named set (`RETRYABLE.has(x._tag)`) are silent. An inline list
// (`["A", "B"].includes(x._tag)`) reports: the chain respelled. A renamed
// destructure (`const { _tag: kind } = x`) isn't followed.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree } from "@oxlint/plugins";

const TAG_KEY = "_tag";
const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);

/** `x._tag`, `x?._tag`, `x["_tag"]`, or a bare `_tag` destructured under its own name. */
function readsTag(node: ESTree.Node): boolean {
  const target = node.type === "ChainExpression" ? node.expression : node;
  if (target.type === "Identifier") return target.name === TAG_KEY;
  return target.type === "MemberExpression" && staticKeyName(target.property, target.computed) === TAG_KEY;
}

/** `[…]`, or `new Set([…])` built in place: a list with no name to extend it at. */
function isInlineList(node: ESTree.Node): boolean {
  if (node.type === "ArrayExpression") return true;
  if (node.type !== "NewExpression") return false;
  const [first] = node.arguments;
  return node.callee.type === "Identifier" && node.callee.name === "Set" && first?.type === "ArrayExpression";
}

export const noManualTagComparisonRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      manualComparison:
        "Comparing `_tag` by hand compiles unchanged when the union grows a variant, which then falls through to whichever branch is last. Dispatch with Match.valueTags or Match.tagsExhaustive, narrow one variant with Predicate.isTagged, and recover one error with Effect.catchTag.",
      inlineTagList:
        "Testing `_tag` against an inline list is a comparison chain by another spelling: a new variant compiles unchanged. Decide every variant with Match.valueTags or a Record<Tag, boolean>, or name the set once as a constant.",
      manualSwitch:
        "A `switch` on `_tag` compiles unchanged when the union grows a variant. Use Match.valueTags(value, { … }) or a tagged enum's $match, so the new variant is a compile error here.",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!EQUALITY_OPERATORS.has(node.operator)) return;
        // Exactly one side: two tag reads compare variants with each other, not against a name.
        if (readsTag(node.left) !== readsTag(node.right)) context.report({ node, messageId: "manualComparison" });
      },

      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression") return;
        const method = staticKeyName(callee.property, callee.computed);
        if (method !== "includes" && method !== "has") return;
        const [argument] = node.arguments;
        if (argument === undefined || !readsTag(argument)) return;
        if (isInlineList(callee.object)) context.report({ node, messageId: "inlineTagList" });
      },

      SwitchStatement(node) {
        if (readsTag(node.discriminant)) context.report({ node, messageId: "manualSwitch" });
      },
    };
  },
});
