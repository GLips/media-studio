// ─── no-disable-validation ─────────────────────────────────────
//
// Makes sure: no Effect Schema construction switches its checks off with
// `disableChecks`, through `Invoice.make(props, opts)`, `makeOption`,
// `makeEffect` or `new Person(props, opts)`, so a value with a schema's type
// has passed it.
//
// Any value but the literal `false` reports: a shorthand, a forwarded flag and a
// ternary each leave the check off on some path. The finding is anchored on the
// constructor call, so an unrelated API's option of the same name is silent.
//
// NEGATIVE SPACE: an options object built in another statement is the same
// bypass, and a per-file rule can't follow it to the call.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { calledMemberName } from "../lib/called-member-name.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree } from "@oxlint/plugins";

const OPT_OUT_PROPERTY = "disableChecks";
const SCHEMA_CONSTRUCTOR_METHODS = new Set(["make", "makeOption", "makeEffect"]);

// The option is only an opt-out where something reads it: a schema's constructor methods and a
// class's `new`. Anchoring on the call is what stops an unrelated API's identically named flag from
// collecting a diagnostic about schemas.
function isSchemaConstructorArgument(objectLiteral: ESTree.Node): boolean {
  const call = objectLiteral.parent;
  if (call === undefined || call === null) return false;
  if (call.type !== "CallExpression" && call.type !== "NewExpression") return false;
  if (!call.arguments.some((argument) => argument === objectLiteral)) return false;
  // `new Person(props, { … })` — the class IS the schema, so there is no method name to match.
  if (call.type === "NewExpression") return true;
  const method = calledMemberName(call.callee);
  return method !== undefined && SCHEMA_CONSTRUCTOR_METHODS.has(method);
}

export const noDisableValidationRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      validationDisabled:
        "disableChecks turns the constructor into a cast: the value keeps the schema's type and nothing checks it against the schema. Delete the option and fix the data or the schema; where the input may not conform, decode it with Schema.decodeUnknownEffect or Schema.decodeUnknownResult and handle the failure.",
      validationDisabledConditionally:
        "A runtime-valued disableChecks leaves the checks off on some path, and no reader can tell which. Delete the option so every construction validates; if one caller accepts other input, give it a schema that describes what it accepts.",
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
