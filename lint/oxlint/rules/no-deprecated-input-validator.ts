// ─── no-deprecated-input-validator ──────────────────────────
//
// Makes sure: server functions and middleware use one spelling, `.validator()`,
// not TanStack Start's deprecated `.inputValidator()`, so a search for
// `.validator(` finds every checked chain.
//
// The method name alone doesn't identify the builder: the receiver must mention
// createServerFn or createMiddleware, or an unrelated `.inputValidator()` gets a
// report it can't act on. A finding here is not evidence a handler is validated;
// that is server-fn-validation's question. The deprecation is in
// @tanstack/start-plugin-core/src/start-compiler/handleCreateServerFn.ts.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import type { ESTree, Range } from "@oxlint/plugins";
import { createRangeIndex } from "../lib/range-index.ts";

const DEPRECATED_METHOD = "inputValidator";
const BUILDER_FACTORIES = new Set(["createServerFn", "createMiddleware"]);
const FACTORY_MENTION = "builder-factory";

/** The method name, whether spelled `x.inputValidator()` or `x["inputValidator"]()`. */
function calledMethodName(callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression") return null;
  if (!callee.computed) {
    return callee.property.type === "Identifier" ? callee.property.name : null;
  }
  return callee.property.type === "Literal" && typeof callee.property.value === "string"
    ? callee.property.value
    : null;
}

export const noDeprecatedInputValidatorRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      deprecatedInputValidator:
        ".inputValidator() is deprecated in TanStack Start. Use .validator() instead.",
    },
  },
  create(context) {

    // The builder is whatever the method is called ON, and the factory can sit arbitrarily deep
    // inside it — `createServerFn().middleware([auth]).inputValidator(…)`. A visitor reaches the
    // receiver only AFTER the call it belongs to, so the containment question is answerable at
    // Program:exit and nowhere earlier.
    const factoryMentions = createRangeIndex();
    const deprecatedCalls: { node: ESTree.CallExpression; receiver: Range }[] = [];

    return {
      // The mention, not the call: `start.createServerFn()` and a re-wrapped factory both name it.
      Identifier(node) {
        if (BUILDER_FACTORIES.has(node.name)) factoryMentions.record(FACTORY_MENTION, node.range);
      },
      CallExpression(node) {
        if (calledMethodName(node.callee) !== DEPRECATED_METHOD) return;
        const receiver = (node.callee as ESTree.MemberExpression).object;
        deprecatedCalls.push({ node, receiver: receiver.range });
      },
      "Program:exit"() {
        for (const { node, receiver } of deprecatedCalls) {
          if (factoryMentions.containedIn(FACTORY_MENTION, receiver)) {
            context.report({ node, messageId: "deprecatedInputValidator" });
          }
        }
      },
    };
  },
});
