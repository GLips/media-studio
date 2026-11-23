// ─── require-error-message ─────────────────────────────────────
//
// Makes sure: every tagged error says what went wrong in its own sentence.
// runStudioEffect rejects with a program's failure and cli/studio.ts prints its
// `message` as the one line Graham reads; a `Schema.TaggedError` or
// `Data.TaggedError` with no message of its own prints an empty line.
//
// A class declares one with `override get message()`, built from its fields,
// or with a `message` field in its schema. Matched by the factory's member
// name, so a bare import reports too.
//
// NEGATIVE SPACE: a `message` passed in the constructor's props, with no field
// declaring it, isn't a declaration: the sentence would be decided at every
// call site. A class extending another error class inherits its message and
// isn't read.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { calledMemberName } from "../lib/called-member-name.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { type ESTree } from "@oxlint/plugins";

const TAGGED_ERROR_FACTORIES = new Set(["TaggedError", "TaggedErrorClass"]);
const MESSAGE_KEY = "message";

function isTaggedErrorFactoryCall(node: ESTree.Node): boolean {
  if (node.type !== "CallExpression") return false;
  const name = calledMemberName(node.callee);
  return name !== undefined && TAGGED_ERROR_FACTORIES.has(name);
}

/**
 * The call that builds the superclass's fields: `Data.TaggedError("A")`, or the curried
 * `Schema.TaggedError<A>()("A", { … })`, whose outer call holds them. Undefined when the class
 * extends anything else.
 */
function taggedErrorSuperclassCall(node: ESTree.Node | null): ESTree.CallExpression | undefined {
  if (node === null || node.type !== "CallExpression") return undefined;
  if (isTaggedErrorFactoryCall(node)) return node;
  return isTaggedErrorFactoryCall(node.callee) ? node : undefined;
}

/** A `message` key in the fields object a schema error is built with. */
function fieldsDeclareMessage(call: ESTree.CallExpression): boolean {
  return call.arguments.some(
    (argument) =>
      argument.type === "ObjectExpression" &&
      argument.properties.some(
        (property) => property.type === "Property" && staticKeyName(property.key, property.computed) === MESSAGE_KEY,
      ),
  );
}

function isMessageMember(member: ESTree.ClassBody["body"][number]): boolean {
  if (member.type === "MethodDefinition") {
    return member.kind === "get" && !member.static && staticKeyName(member.key, member.computed) === MESSAGE_KEY;
  }
  return member.type === "PropertyDefinition" && !member.static && staticKeyName(member.key, member.computed) === MESSAGE_KEY;
}

export const requireErrorMessageRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      missingMessage:
        "This tagged error has no message of its own, so the CLI prints an empty line when it fails a command. Add `override get message()` that says what went wrong from its fields, or a `message` field in its schema.",
    },
  },
  create(context) {
    function check(node: ESTree.Class): void {
      const superclass = taggedErrorSuperclassCall(node.superClass);
      if (superclass === undefined) return;
      if (fieldsDeclareMessage(superclass) || node.body.body.some(isMessageMember)) return;
      context.report({ node: node.id ?? node, messageId: "missingMessage" });
    }
    return { ClassDeclaration: check, ClassExpression: check };
  },
});
