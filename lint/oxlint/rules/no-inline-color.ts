// ─── no-inline-color ────────────────────────────────────────────
//
// Makes sure: no style-object value and no color prop (`c`, `bg`, `color`) in
// the web app carries a hex, `rgb()` or `hsl()` literal. Every color comes from
// the token table (web/src/shared/ui/theme.stylex.ts, the one module exempt),
// which holds both schemes.
//
// Don't add bare keywords (`red`, `dimmed`): token names are spelled that way.
// Keep COLOR_PROPS small, or `href="#anchor"` reports.
//
// NEGATIVE SPACE: only those two positions and only a static string are read.
// A hex in a palette array, a returned literal or a `.css` file, and a ternary's
// arms, report nowhere.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";
import { isStyleSubject } from "../lib/web-design-system.ts";
import { withoutTransparentWrappers } from "../lib/transparent-wrappers.ts";

const COLOR_PROPS = new Set(["c", "bg", "color"]);

/**
 * The `\b` keeps a run of more than eight hex digits (`"#abcdef123"`, a sha or an anchor) from
 * reading as a colour; no notation has one that long.
 */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\([^)]*[0-9]/;

/**
 * The compile-time string an expression evaluates to, or null when there isn't one.
 *
 * A backtick is a spelling of a string literal, not a different kind of value, so
 * `` color: `#0a0c10` `` has to resolve the same way `color: "#0a0c10"` does. A template with
 * interpolations is assembled at run time and unreadable here.
 */
function staticStringValue(wrapped: ESTree.Node): string | null {
  // A cast, a `satisfies` and a `!` change nothing about the string that ships, and
  // `lib/transparent-wrappers.ts` is the one list of them. Without this, `c={"#0a0c10" as Color}`
  // turns the rule off with one keyword, while no-inline-style-prop, which reads the same
  // module, still sees it. A parenthesis needs no arm: oxlint emits no node for one, which that
  // module's own negative space says.
  const node = withoutTransparentWrappers(wrapped);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

export const noInlineColorRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      rawColor:
        "Raw color value. Use a color token instead — `var(--app-text-secondary)`, `theme.colors.textSecondary`, or a closed color prop on the primitive (`c='dimmed'`). Tokens carry both schemes, so light and dark stay in sync and there is no dark variant to forget. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
    },
  },
  create(context, file) {
    if (!isStyleSubject(file)) return {};

    return {
      // Style-object values: `{ color: "#fff" }`, `{ backgroundColor: "rgb(0,0,0)" }`. Inline
      // `style={{}}`, StyleSheet.create objects, and theme-adjacent literals are all this one
      // shape. The KEY is deliberately not consulted — a raw color is off-system whatever it is
      // assigned to, which is also why a computed key needs no special case here.
      Property(node) {
        const value = staticStringValue(node.value);
        if (value !== null && COLOR_LITERAL.test(value)) {
          context.report({ node, messageId: "rawColor" });
        }
      },

      // Color props on components: `<Text c="#fff">`.
      JSXAttribute(node) {
        // A namespaced attribute (`<svg xlink:href>`) is never a color prop.
        if (node.name.type !== "JSXIdentifier") return;
        if (!COLOR_PROPS.has(node.name.name)) return;

        const { value } = node;
        if (value === null) return;
        // `c="#fff"` is a bare string; `c={"#fff"}` and `` c={`#fff`} `` wrap the same value in an
        // expression container, and all three ship the same color.
        const inner = value.type === "JSXExpressionContainer" ? value.expression : value;
        const text = staticStringValue(inner);
        if (text !== null && COLOR_LITERAL.test(text)) {
          context.report({ node, messageId: "rawColor" });
        }
      },
    };
  },
});
