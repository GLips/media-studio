// ─── no-type-argument-assertion ────────────────────────────────
//
// Makes sure: a call that reads external data doesn't name its own result type
// (`response.json<User>()`, `parse<Config>(text)`, `gql<Data>`, the deferred
// `client.get<User>`). The type comes from a parser, so a missing field fails at
// the parse, not at a later read of `undefined`.
//
// ASSERTING_DATA_CALL_NAMES is the rule; only a callee's last name segment is
// read, so `container.get<Svc>()` reports too. `json<unknown>()` passes and
// `json<any>()` reports. A callee behind a binding isn't followed, and `sql` is
// not in the list.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { withoutTransparentWrappers } from "../lib/transparent-wrappers.ts";
import { type ESTree } from "@oxlint/plugins";

// Matched against the callee's LAST segment, so receivers need no list. Every name reads external
// bytes: HTTP verbs, a Response's `json`, `parse`, SQL driver methods, GraphQL tags. `all` is
// absent despite `db.all<Row>()`: it would take `Promise.all<[A, B]>`, a real annotation rather
// than a claim about data. `sql` is absent because it has an owner; the header says which.
const ASSERTING_DATA_CALL_NAMES = new Set([
  "delete",
  "execute",
  "fetch",
  "get",
  "gql",
  "graphql",
  "json",
  "parse",
  "patch",
  "post",
  "put",
  "query",
  "request",
]);

// Both spellings of the member access, plus the bare call. `client["get"]<User>(url)` is the one a
// rule reading only `property.name` misses.
//
// A callee can be wrapped too: `api.get!<User>(url)` and `(api.get as Getter)<User>(url)` beat a
// matcher reading `callee` directly. `lib/transparent-wrappers.ts` owns which nodes those are, so
// wrapped callees and wrapped values never drift apart.
function calledName(expression: ESTree.Expression): string | null {
  const callee = withoutTransparentWrappers(expression);
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression") return null;
  if (callee.computed) {
    return callee.property.type === "Literal" && typeof callee.property.value === "string"
      ? callee.property.value
      : null;
  }
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

export const noTypeArgumentAssertionRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      typeArgumentAssertion:
        "`{{name}}<{{args}}>` asserts that external data is `{{type}}` with nothing checked — `as {{type}}` in a position the assertion rules cannot see. Parse the result at this boundary with a schema and take the type from the parser.",
    },
  },
  create(context) {

    const sourceCode = context.sourceCode;

    function checkTypeArguments(
      callee: ESTree.Expression,
      typeArguments: ESTree.TSTypeParameterInstantiation | null | undefined,
    ): void {
      if (typeArguments === null || typeArguments === undefined) return;
      const params = typeArguments.params;
      if (params.length === 0) return;

      const name = calledName(callee);
      if (name === null || !ASSERTING_DATA_CALL_NAMES.has(name)) return;
      // The all-`unknown` instantiation is the honest spelling, not an evasion.
      if (params.every((param) => param.type === "TSUnknownKeyword")) return;

      const args = params.map((param) => sourceCode.getText(param));
      context.report({
        // Reported on the type arguments rather than the call: the span then covers exactly the
        // text that has to go, and a call that is otherwise fine does not read as banned.
        node: typeArguments,
        messageId: "typeArgumentAssertion",
        data: { name, args: args.join(", "), type: args[0] ?? "" },
      });
    }

    return {
      CallExpression(node) {
        checkTypeArguments(node.callee, node.typeArguments);
      },

      // `gql<Data>`query …`` is the same assertion with the argument list moved off the call. A
      // rule that visits only CallExpression is silent on every tagged-template query builder
      // there is.
      TaggedTemplateExpression(node) {
        checkTypeArguments(node.tag, node.typeArguments);
      },

      // The instantiation expression — `const loadUser = client.get<User>` — defers the call by one
      // line and keeps the claim. It is a separate node from CallExpression, so it survives a rule
      // built only around calls, and it is the shape that appears once the call form is refused.
      TSInstantiationExpression(node) {
        checkTypeArguments(node.expression, node.typeArguments);
      },
    };
  },
});
