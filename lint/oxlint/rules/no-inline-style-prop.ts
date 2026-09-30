// ─── no-inline-style-prop ───────────────────────────────────────
//
// Makes sure: outside the primitives layer, no web `style` prop carries an
// object literal, so every declaration sits in a primitive's token props or a
// named StyleX entry, not a hand-written `padding` in a JSX attribute.
//
// The primitives layer (web/src/shared/ui/) is exempt: it turns token props
// into real declarations. `style={someVar}` passes, since a variable usually
// names a stylesheet entry. A file that must write inline style belongs in the
// primitives layer, not behind a suppression comment.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { isTransparentWrapper } from "../lib/transparent-wrappers.ts";
import { type ESTree } from "@oxlint/plugins";
import { isPrimitivesLayer, isStyleSubject } from "../lib/web-design-system.ts";

const STYLE_PROPS = new Set(["style"]);

/**
 * Whether an expression ships an object literal, through any of the wrappers that keep one from
 * being the top node.
 *
 * The literal is the violation; a cast, a ternary, or a style ARRAY is packaging around it. The
 * array matters most: in stylesheet projects `style={[styles.row, { padding: 12 }]}` is the
 * idiomatic spelling of the very thing the rule bans.
 */
function shipsObjectLiteral(node: ESTree.Node): boolean {
  // The wrappers that change nothing about the value are `lib/transparent-wrappers.ts`'s to list,
  // not this rule's. The arms below are NOT that list: a ternary, a logical, and a style array each
  // ship something different from what they contain, which is why this rule answers for them and
  // the shared module refuses to.
  if (isTransparentWrapper(node)) return shipsObjectLiteral(node.expression);
  switch (node.type) {
    case "ObjectExpression":
      return true;
    case "ConditionalExpression":
      return shipsObjectLiteral(node.consequent) || shipsObjectLiteral(node.alternate);
    case "LogicalExpression":
      return shipsObjectLiteral(node.left) || shipsObjectLiteral(node.right);
    case "ArrayExpression":
      return node.elements.some(
        (element) => element !== null && shipsObjectLiteral(element),
      );
    default:
      return false;
  }
}

export const noInlineStylePropRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      inlineStyleObject:
        "Inline style object. Use the primitive's token props (padding='m', gap='s', color='text-secondary'), or move the declarations into a named stylesheet entry. An inline object accepts any property at any value, so it is the one surface where an off-system decision still typechecks. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
    },
  },
  create(context, file) {
    // The primitives layer by position, so a `shared/ui-legacy/` doesn't inherit its exemption.
    if (!isStyleSubject(file) || isPrimitivesLayer(file)) return {};

    return {
      JSXAttribute(node) {
        // A namespaced attribute (`<svg xlink:href>`) is never a style prop.
        if (node.name.type !== "JSXIdentifier") return;
        if (!STYLE_PROPS.has(node.name.name)) return;

        const { value } = node;
        // `style="…"` is a string, and `style` with no value is a boolean shorthand — neither
        // carries an object.
        if (value === null || value.type !== "JSXExpressionContainer") return;
        if (shipsObjectLiteral(value.expression)) {
          context.report({ node, messageId: "inlineStyleObject" });
        }
      },
    };
  },
});
