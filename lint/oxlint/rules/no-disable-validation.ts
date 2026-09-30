// ─── no-disable-validation ─────────────────────────────────────
//
// Makes sure: no Effect Schema construction switches its check off with
// `disableValidation`, through `Invoice.make(props, opts)` or
// `new Person(props, opts)`, so a value with a schema's type has passed it.
//
// Any value but the literal `false` reports: a shorthand, a forwarded flag and a
// ternary each leave the check off on some path. The finding is anchored on the
// constructor call, so an unrelated API's option of the same name is silent.
//
// NEGATIVE SPACE: `Struct.make(props, true)` and an options object built in
// another statement are the same bypass, and a per-file rule can't tell them
// from ordinary calls.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree } from "@oxlint/plugins";

const OPT_OUT_PROPERTY = "disableValidation";
const SCHEMA_CONSTRUCTOR_METHODS = new Set(["make"]);

/** The last segment of a callee — `make` for all of `make`, `Struct.make`, `Schema.Struct.make`. */
function calleeMethodName(callee: ESTree.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  return callee.type === "MemberExpression"
    ? staticKeyName(callee.property, callee.computed)
    : undefined;
}

// The option is only an opt-out where something reads it, and Effect Schema reads it in exactly two
// places. Anchoring on the call is what stops an unrelated API's identically named flag from
// collecting a diagnostic about schemas.
function isSchemaConstructorArgument(objectLiteral: ESTree.Node): boolean {
  const call = objectLiteral.parent;
  if (call === undefined || call === null) return false;
  if (call.type !== "CallExpression" && call.type !== "NewExpression") return false;
  if (!call.arguments.some((argument) => argument === objectLiteral)) return false;
  // `new Person(props, { … })` — the class IS the schema, so there is no method name to match.
  if (call.type === "NewExpression") return true;
  const method = calleeMethodName(call.callee);
  return method !== undefined && SCHEMA_CONSTRUCTOR_METHODS.has(method);
}

export const noDisableValidationRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      validationDisabled:
        "disableValidation turns the constructor into a cast: the value keeps the schema's type and nothing checks it against the schema. Delete the option and fix the data or the schema — and where the input genuinely may not conform, decode with Schema.decodeUnknownEither and handle the failure branch.",
      validationDisabledConditionally:
        "A runtime-valued disableValidation leaves the check off on some path, and no reader can tell which. Delete the option so every construction validates — if one caller needs to accept non-conforming input, give it its own schema that describes what it actually accepts.",
    },
  },
  create(context) {

    return {
      Property(node) {
        // oxlint fires the Property visitor for destructuring and assignment-target properties too,
        // and all four kinds carry the same `key`/`computed` pair. The ones that are not object
        // literals are dropped on the parent below, where the reason can be written down.
        if (staticKeyName(node.key, node.computed) !== OPT_OUT_PROPERTY) return;
        // A destructuring pattern binds the name; it does not turn the check off. The call that
        // passes the object is the decision, and it is reported there.
        if (node.parent.type !== "ObjectExpression") return;
        if (!isSchemaConstructorArgument(node.parent)) return;

        const { value } = node;
        if (value.type === "Literal" && value.value === false) return;
        if (value.type === "Literal" && value.value === true) {
          context.report({ node, messageId: "validationDisabled" });
          return;
        }
        context.report({ node, messageId: "validationDisabledConditionally" });
      },
    };
  },
});
