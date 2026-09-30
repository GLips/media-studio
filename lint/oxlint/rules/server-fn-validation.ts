// ─── server-fn-validation ──────────────────────────────────────
//
// Makes sure: a createServerFn handler that reads `data` calls `.validator()`
// first, so client input reaches the studio's engine only after a schema checks it.
//
// The handler's parameter list is the signal: the factory's argument is config,
// and a handler binding the whole options object reaches `data` through it.
//
// NEGATIVE SPACE: a handler moved to a named function isn't followed; the chain
// walk stops at a computed member or a cast; `createMiddleware` is not read. A
// clean run means no plain dotted chain lacks a validator, not that input is
// checked: `z.any()` satisfies it.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";

const SERVER_FN_FACTORIES = new Set(["createServerFn"]);
const HANDLER_METHOD = "handler";
const VALIDATOR_METHOD = "validator";
const PAYLOAD_PROPERTY = "data";

/** The method names called on a builder chain, plus the bare identifier it bottoms out in. */
function readBuilderChain(handlerCall: ESTree.CallExpression): {
  factory: string | null;
  methods: string[];
} {
  const methods: string[] = [];
  let cursor: ESTree.Node = handlerCall;

  while (cursor.type === "CallExpression") {
    // Annotated rather than destructured: `cursor` is reassigned from this value, and TypeScript
    // reads the inferred pair as circular.
    const callee: ESTree.Expression = cursor.callee;
    if (callee.type === "Identifier") return { factory: callee.name, methods };
    if (callee.type !== "MemberExpression" || callee.computed) break;
    if (callee.property.type !== "Identifier") break;
    methods.push(callee.property.name);
    cursor = callee.object;
  }
  return { factory: null, methods };
}

/**
 * Reading `params` off the handler node is what keeps this robust. Any matcher written against the
 * handler's literal shape needs a slot for the `): Promise<T> =>` return-type annotation every real
 * handler carries — and in a typed codebase, a matcher missing that slot matches nothing at all.
 * Under a visitor the annotation is a sibling field of `params`, so it is simply not read.
 */
function handlerConsumesClientPayload(
  handler: ESTree.ArrowFunctionExpression | ESTree.Function,
): boolean {
  const [param] = handler.params;
  if (param === undefined) return false;
  const binding = param.type === "AssignmentPattern" ? param.left : param;

  if (binding.type !== "ObjectPattern") {
    // An identifier or rest binding takes the whole options object, `data` included.
    return true;
  }
  return binding.properties.some((property) => {
    // `({ ...rest })` sweeps up `data` along with everything else.
    if (property.type === "RestElement") return true;
    if (property.computed) return false;
    const { key } = property;
    if (key.type === "Identifier") return key.name === PAYLOAD_PROPERTY;
    return key.type === "Literal" && key.value === PAYLOAD_PROPERTY;
  });
}

export const serverFnValidationRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      missingValidator:
        "createServerFn consumes handler data without .validator(). Add .validator(schema) before .handler() to validate input at the server boundary.",
    },
  },
  create(context) {

    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== HANDLER_METHOD
        ) {
          return;
        }

        const [handler] = node.arguments;
        if (
          handler === undefined ||
          (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression")
        ) {
          return;
        }
        if (!handlerConsumesClientPayload(handler)) return;

        const { factory, methods } = readBuilderChain(node);
        if (factory === null || !SERVER_FN_FACTORIES.has(factory)) return;
        if (methods.includes(VALIDATOR_METHOD)) return;

        context.report({ node, messageId: "missingValidator" });
      },
    };
  },
});
