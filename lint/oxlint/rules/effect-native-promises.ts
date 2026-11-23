// ─── effect-native-promises ────────────────────────────────────
//
// Makes sure: the engine of an Effect-native feature (EFFECT_NATIVE_FEATURES
// in studio-tree.ts) builds and chains no promise. A promise from outside
// enters once, through Effect.tryPromise, whose `catch` builds a tagged error;
// Effect.promise, with no `catch`, makes a rejection an untyped defect.
// `new Promise`, `Promise.reject` and `.then`/`.catch`/`.finally` sit out of
// reach of Effect's interruption, scopes and typed failures.
//
// Effect's own modules have `catch` too (`Effect.catch`, `Stream.catch`): a
// member read off a name imported from `effect` or `@effect/*` is theirs.
//
// NEGATIVE SPACE: an `async` thunk handed to tryPromise is its `try`, and
// allowed. `Effect.promise` under another name isn't followed. Specs, models
// and studio code aren't read; the CLI verbs await runStudioEffect by design.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { staticKeyName } from "../lib/static-key-name.ts";
import { effectNativeRole } from "../../policy/studio-tree.ts";
import { type ESTree } from "@oxlint/plugins";

const PROMISE_CHAIN_METHODS = new Set(["then", "catch", "finally"]);

const isEffectModule = (specifier: string) => specifier === "effect" || specifier.startsWith("effect/") || specifier.startsWith("@effect/");
const isPromiseGlobal = (node: ESTree.Node) => node.type === "Identifier" && node.name === "Promise";

export const effectNativePromisesRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      effectPromise:
        "Effect.promise turns a rejection into a defect, so no type names the failure and no caller recovers by tag. Use Effect.tryPromise with a `catch` that builds a Schema.TaggedError.",
      promiseBuilt:
        "{{spelling}} builds a promise in Effect-native engine code, outside Effect's interruption, scopes and typed failures. Build the Effect itself: Effect.callback for a callback API, Effect.fail with a tagged error for a failure.",
      promiseChained:
        "`.{{method}}` chains a promise beside the Effects, so its failure arrives untyped and an interrupt never reaches it. Bring the promise in once through Effect.tryPromise and compose the Effect (Effect.flatMap, Effect.catchTag, Effect.ensuring).",
    },
  },
  create(context, file) {
    if (effectNativeRole(file.position) !== "engine") return {};

    /** Local names bound by an import from Effect's packages, whose members are Effect's own. */
    const effectBindings = new Set<string>();
    return {
      // Scope analysis is complete before traversal, so every import is known before its first read.
      Program() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const variable of scope.variables) {
            const declaration = variable.defs.find((definition) => definition.type === "ImportBinding")?.parent;
            if (declaration?.type === "ImportDeclaration" && isEffectModule(declaration.source.value)) effectBindings.add(variable.name);
          }
        }
      },
      MemberExpression(node) {
        const name = staticKeyName(node.property, node.computed);
        if (name === undefined) return;
        if (isPromiseGlobal(node.object)) {
          context.report({ node, messageId: "promiseBuilt", data: { spelling: `Promise.${name}` } });
          return;
        }
        const effectName = node.object.type === "Identifier" && effectBindings.has(node.object.name) ? node.object.name : undefined;
        if (effectName === "Effect" && name === "promise") {
          context.report({ node, messageId: "effectPromise" });
          return;
        }
        const ownedByEffect = effectName !== undefined;
        if (ownedByEffect || !PROMISE_CHAIN_METHODS.has(name)) return;
        // Only a call chains: `{ catch: … }` read back as `options.catch` names a handler, not a chain.
        if (node.parent.type === "CallExpression" && node.parent.callee === node) {
          context.report({ node, messageId: "promiseChained", data: { method: name } });
        }
      },
      NewExpression(node) {
        if (isPromiseGlobal(node.callee)) context.report({ node, messageId: "promiseBuilt", data: { spelling: "new Promise" } });
      },
    };
  },
});
