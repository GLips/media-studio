// ─── style/no-stylex-border-shorthand ─────────────────────────────────
//
// Makes sure: No `stylex.create` style sets a border shorthand (`border`,
// `borderTop`…`borderLeft`, `borderInline*`, `borderBlock*`) to anything but a
// plain literal. StyleX expands a shorthand into longhands at build time, and it
// can't split a value it can't read: `borderTop: \`1px solid ${colors.line}\``
// emits no CSS at all, and the border silently computes to `0px none`.
//
// The fix is the three longhands, which take a token as a whole value:
// `borderTopWidth`, `borderTopStyle`, `borderTopColor`.
//
// A literal shorthand (`border: 'none'`, `borderTop: '1px solid red'`) is legal:
// StyleX expands it. Any template literal reports, with or without an expression
// in it, since the next edit puts a token in it. A conditional value
// (`{ default: …, ':hover': … }`) is read branch by branch.
//
// NEGATIVE SPACE: only `stylex.create` under the `stylex` namespace import is
// read, the one spelling this app uses. `borderWidth`, `borderColor` and
// `borderStyle` are not read: each takes one component, so a var fills it whole.
// ──────────────────────────────────────────────────────────────────────

import { type ESTree } from "@oxlint/plugins";
import { defineTreeRule } from "../lib/define-tree-rule.ts";
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

export const noStylexBorderShorthandRule = defineTreeRule({
  meta: {
    type: "problem",
    messages: {
      unreadableShorthand:
        "StyleX can't expand `{{name}}` from a value it can't read at build time, so it emits no CSS and the border never draws. Write the longhands instead: `{{name}}Width`, `{{name}}Style` and `{{name}}Color`, each of which takes a token whole.",
    },
  },
  create(context) {
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
