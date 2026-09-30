// ─── no-inline-font-size ────────────────────────────────────────
//
// Makes sure: no style object or JSX prop in the web app sets `fontSize`, so
// every text size comes from a named entry on the type scale and a change to
// the scale reaches every screen.
//
// The property is banned, not the value: `fontSize: 13` with 13 on the scale
// today stops following it the day the scale moves. A computed key is read when
// statically known (`{ ["fontSize"]: 13 }`); destructuring a size reads it.
//
// The primitives layer (web/src/shared/ui/) is exempt, since `size='caption'`
// has to become a real `fontSize` somewhere. NEGATIVE SPACE: so a raw size
// there reports nowhere, and nor does a `({ fontSize = 13 })` default.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { isPrimitivesLayer, isStyleSubject } from "../lib/web-design-system.ts";

const SCALE_PROPERTIES = new Set(["fontSize"]);

export const noInlineFontSizeRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      // Names the PROP form only. The scale token — `var(--text-caption)`, `theme.typography.caption`
      // — is still a value assigned to `fontSize`, so naming it here would prescribe the very edit
      // this rule then reports again. Writing the token IS the fix, but one layer down: the
      // primitives are exempt precisely so they can turn `size='caption'` into it.
      rawFontSize:
        "Raw fontSize override. Use a named size from the type scale instead — a size prop on the text primitive (`size='caption'`, `variant='heading-xs'`), or a semantic type class (`text-caption`). Setting `fontSize` to a scale token is still setting `fontSize`; the primitives layer is the one place that does it. If the size you want is not on the scale, add it to the scale rather than writing it here. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
    },
  },
  create(context, file) {
    // The primitives layer by position, so a `shared/ui-legacy/` doesn't inherit its exemption.
    if (!isStyleSubject(file) || isPrimitivesLayer(file)) return {};

    return {
      Property(node) {
        // A destructuring pattern or an assignment target reads a size; it does not set one, and
        // the subject is the decision. `const { fontSize } = theme.typography.caption` takes the
        // scale's own answer, which is the opposite of what this rule reports.
        if (node.parent.type !== "ObjectExpression") return;

        // oxlint fires this visitor for destructuring and assignment-target properties too, and all
        // four kinds carry the same `key`/`computed` pair the owner reads. The ones that are not
        // object literals are dropped on the parent above, where the reason is written down.
        const name = staticKeyName(node.key, node.computed);
        if (name !== undefined && SCALE_PROPERTIES.has(name)) {
          context.report({ node, messageId: "rawFontSize" });
        }
      },

      JSXAttribute(node) {
        // A namespaced attribute (`<svg xlink:href>`) is never a style prop.
        if (node.name.type !== "JSXIdentifier") return;
        if (SCALE_PROPERTIES.has(node.name.name)) {
          context.report({ node, messageId: "rawFontSize" });
        }
      },
    };
  },
});
