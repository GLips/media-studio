// ─── no-effect-catchcause ──────────────────────────────────────
//
// Makes sure: a handler sees only the errors its effect declares. No
// `Effect.catchCause`, `catchDefect` or `ignoreCause`: a thrown exception, a
// broken invariant or an interruption ends the fiber and reaches
// runStudioEffect, which rejects with it, stack intact. So a bug reports as one
// crash, never as a business outcome.
//
// `catchDefect` and `ignoreCause` are in the set because each is the next
// spelling written once the one before reports.
//
// NEGATIVE SPACE: cause inspection is allowed. `Effect.sandbox`, `tapCause`,
// `Cause.pretty` and a `catchCauseIf` narrowed to one known defect read the
// cause and leave it in place. An aliased import isn't followed.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";

// Keyed by `string`: every lookup is a member name read off the AST. The value side is a literal
// union, which ties each entry to a `meta.messages` key.
const CAUSE_CATCH_METHODS = new Map<string, "causeCaught" | "defectCaught" | "causeIgnored">([
  ["catchCause", "causeCaught"],
  ["catchDefect", "defectCaught"],
  ["ignoreCause", "causeIgnored"],
]);

export const noEffectCatchCauseRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      causeCaught:
        "Effect.catchCause catches defects as well as declared errors, so a bug is handled like an expected failure and the program goes on in the state that produced it. Catch the declared errors with Effect.catchTag or Effect.catch, and let defects reach runStudioEffect.",
      defectCaught:
        "Effect.catchDefect turns a bug into a handled value, so the fiber survives what should have ended it. Let the defect reach runStudioEffect; if a failure is expected, make it a declared Schema.TaggedError instead.",
      causeIgnored:
        "Effect.ignoreCause discards defects and interruptions with the declared errors, so a bug ends as a quiet success. Let defects reach runStudioEffect; if the declared errors are beside the point, Effect.ignore discards those alone.",
    },
  },
  create(context) {
    return {
      // The member reference, not the call: data-last use inside `.pipe(…)` passes the function
      // without calling it.
      MemberExpression(node) {
        const name = staticKeyName(node.property, node.computed);
        const messageId = name === undefined ? undefined : CAUSE_CATCH_METHODS.get(name);
        if (messageId !== undefined) context.report({ node, messageId });
      },

      // The same function imported by name has no member expression to match.
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const messageId = CAUSE_CATCH_METHODS.get(node.callee.name);
        if (messageId !== undefined) context.report({ node, messageId });
      },
    };
  },
});
