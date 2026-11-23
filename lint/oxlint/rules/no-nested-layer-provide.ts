// ─── no-nested-layer-provide ───────────────────────────────────
//
// Makes sure: every composed layer has a name, and each `Layer.provide` edge
// is one line, so a runtime's layer graph reads as a list of named consts a
// test runtime can import, not one expression nesting provides in a pipe.
//
// Containment is by source range, not argument position: the inner call is a
// finding anywhere in the outer call's arguments, one level down, inside a
// `.pipe(…)` or inside a `Layer.merge(…)` between them. Sequential provides on
// one pipeline (`App.pipe(Layer.provide(A), Layer.provide(B))`) are flat and
// silent: they're the shape asked for.
//
// `provide` is too common a method name to match alone, so the receiver must
// be the `Layer` namespace.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree, type Range } from "@oxlint/plugins";

const LAYER_NAMESPACE = "Layer";
const PROVIDE_METHODS = new Set(["provide", "provideMerge"]);

function isLayerProvideCall(node: ESTree.CallExpression): boolean {
  const { callee } = node;
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== LAYER_NAMESPACE) return false;
  const method = staticKeyName(callee.property, callee.computed);
  return method !== undefined && PROVIDE_METHODS.has(method);
}

export const noNestedLayerProvideRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      nestedLayerProvide:
        "A Layer.provide inside another Layer.provide's arguments hides which layer receives which dependency. Bind the inner layer to a named const and pass that name, so each edge of the graph is one line.",
    },
  },
  create(context) {
    // The walk is pre-order, so containment is only answerable once every call in the file is seen.
    const provideCalls: ESTree.CallExpression[] = [];
    const argumentSpans: Range[] = [];

    return {
      CallExpression(node) {
        if (!isLayerProvideCall(node)) return;
        provideCalls.push(node);
        const first = node.arguments[0];
        const last = node.arguments.at(-1);
        // The arguments alone, never the callee, so a call can't contain itself.
        if (first !== undefined && last !== undefined) argumentSpans.push([first.range[0], last.range[1]]);
      },

      "Program:exit"() {
        for (const call of provideCalls) {
          const [start, end] = call.range;
          if (argumentSpans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd)) {
            context.report({ node: call, messageId: "nestedLayerProvide" });
          }
        }
      },
    };
  },
});
