// ─── no-stylex-border-shorthand ─────────────────────────────────
//
// Makes sure: no web `stylex.create` style sets a border shorthand (`border`,
// `borderTop`, `borderInline*`…) to anything but a plain literal. StyleX can't
// split a value it can't read at build time: `` borderTop: `1px solid ${c}` ``
// emits no CSS, and the border computes to `0px none`. The fix is the three
// longhands, each taking a token whole.
//
// Any template literal reports, since the next edit puts a token in it; a
// conditional value is read branch by branch. NEGATIVE SPACE: only `stylex.create`
// under the `stylex` namespace import is read.
// ──────────────────────────────────────────────────────────────────────

import { type ESTree } from "@oxlint/plugins";
import { defineSourceRule, webPlaceOf } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";

const BORDER_SHORTHAND = /^border(Top|Right|Bottom|Left|Inline(Start|End)?|Block(Start|End)?)?$/u;

function isStylexCreate(node: ESTree.Node): boolean {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "stylex" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "create"
  );
}

function isInsideStylexCreate(node: ESTree.Node): boolean {
  for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
    if (isStylexCreate(at)) return true;
  }
  return false;
}

/** Whether StyleX can expand this value: a literal, or a conditional object whose every branch is one. */
function isExpandableValue(value: ESTree.Node): boolean {
  if (value.type === "Literal") return true;
  if (value.type !== "ObjectExpression") return false;
  return value.properties.every((branch) => branch.type === "Property" && isExpandableValue(branch.value));
}

export const noStylexBorderShorthandRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      unreadableShorthand:
        "StyleX can't expand `{{name}}` from a value it can't read at build time, so it emits no CSS and the border never draws. Write the longhands instead: `{{name}}Width`, `{{name}}Style` and `{{name}}Color`, each of which takes a token whole.",
    },
  },
  create(context, file) {
    if (webPlaceOf(file.position) === undefined) return {};
    return {
      Property(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const name = staticKeyName(node.key, node.computed);
        if (name === undefined || !BORDER_SHORTHAND.test(name)) return;
        if (isExpandableValue(node.value) || !isInsideStylexCreate(node)) return;
        context.report({ node, messageId: "unreadableShorthand", data: { name } });
      },
    };
  },
});
