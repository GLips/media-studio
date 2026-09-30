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

// Matched against the LAST segment of the callee, so the receiver never has to be enumerated. Every
// name here reads external bytes: the HTTP verbs (axios, ky, ofetch and every wrapper of them),
// `json` for a Response body, `parse` for text formats, the SQL driver methods, and the GraphQL
// tags. `all` is absent on purpose despite `db.all<Row>()`: it would take `Promise.all<[A, B]>`
// with it, and that type argument is a real annotation rather than a claim about data. `sql` is
// absent for a different reason — it has an owner, and the header says which.
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
// rule reading only `property.name` misses, and it is a single keystroke from the plain form.
//
// A callee can be wrapped too: `api.get!<User>(url)` and `(api.get as Getter)<User>(url)` are the
// same call with a node wedged between it and its callee, and either one beats a matcher reading
// `callee` directly. `lib/transparent-wrappers.ts` owns which nodes those are — a wrapped callee
// and a wrapped value are one question, and this rule holding its own list of the answer is how
// the two drift. Its NEGATIVE SPACE note carries the `ParenthesizedExpression` reasoning; the
// parenthesized call in the spec below reports through the plain path either way.
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
