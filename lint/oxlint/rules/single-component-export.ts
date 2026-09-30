// ─── single-component-export ────────────────────────────────────
//
// Shows: the files exporting more than one component, as a warning. A
// component sharing a file has no file of its own name, so a grep finds its uses
// and not its declaration.
//
// A compound component namespaced under one `Object.assign` export is the shape
// the message recommends, so it must stay exempt. What a component IS comes from
// lib/component-declarations.ts, shared with hook-count and prop-count, so the
// three read the same set.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, isComponentFile } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";
import { exportedComponents } from "../lib/component-declarations.ts";

export const singleComponentExportRule = defineSourceRule({
  meta: {
    type: "suggestion",
    messages: {
      multipleComponents:
        "This file exports {{names}}. Each is found by the name of this file rather than its own, so all but the first are invisible to a grep for where they are defined. Give each its own file, or namespace them under one export with Object.assign if they are genuinely a compound component.",
    },
  },
  create(context, file) {
    // A barrel (`lib/api.ts`, a web feature's `index.ts`) is never a `.tsx`, so its re-exports are never read.
    if (!isComponentFile(file)) return {};

    // A compound component namespaced under one export is the sanctioned shape, and it is what
    // this rule's own message recommends — so the exemption has to hold, or the rule tells people
    // to do something that fails. Recorded on the way past because the `Object.assign` call sits
    // BELOW the components it namespaces.
    let compound = false;

    return {
      CallExpression(node) {
        if (isCompoundNamespace(node.callee)) compound = true;
      },

      "Program:exit"(program) {
        if (compound) return;
        const components = exportedComponents(program, context.sourceCode);
        const extra = components[1];
        if (extra === undefined) return;

        context.report({
          // The extra component is the one a reader acts on, not the first.
          node: extra.node,
          messageId: "multipleComponents",
          data: { names: components.map((component) => component.name).join(", ") },
        });
      },
    };
  },
});

/** `Object.assign(…)`, the one shape that turns several components into a single export. */
function isCompoundNamespace(callee: ESTree.CallExpression["callee"]): boolean {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Object" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "assign"
  );
}
