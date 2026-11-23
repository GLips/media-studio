// ─── no-service-option ─────────────────────────────────────────
//
// Makes sure: every service a program uses stays in its requirements type, so
// a layer left out of a composition is a compile error where the layers
// compose, not a `None` branch that quietly does nothing at run time.
//
// A dependency that may be absent (a progress sink, a cache) keeps its
// requirement and gets a no-op layer, so the choice sits in the layer graph
// where a reader sees it. `Effect.service` keeps the requirement and is fine.
//
// NEGATIVE SPACE: an aliased import of `serviceOption` isn't followed.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";

const OPTIONAL_SERVICE_ACCESSOR = "serviceOption";

export const noServiceOptionRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      optionalService:
        "Effect.serviceOption turns a missing service from a compile-time requirement into a run-time None, so an unwired layer becomes a feature that silently does nothing. Yield the service itself and provide it where the layers compose, with a no-op layer where it may be absent.",
    },
  },
  create(context) {
    return {
      // The member reference, not the call, so a data-last use passing the function is matched too.
      MemberExpression(node) {
        if (staticKeyName(node.property, node.computed) === OPTIONAL_SERVICE_ACCESSOR) {
          context.report({ node, messageId: "optionalService" });
        }
      },

      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === OPTIONAL_SERVICE_ACCESSOR) {
          context.report({ node, messageId: "optionalService" });
        }
      },
    };
  },
});
