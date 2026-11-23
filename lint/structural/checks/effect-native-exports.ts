// ─── Effect-native exports ────────────────────────────────────────────
//
// The engine of an Effect-native feature (EFFECT_NATIVE_FEATURES in
// studio-tree.ts) exports no function that returns a promise. Its operations
// are Effects, so their failures are typed and their services provided by
// layers; a promise-world caller (a CLI verb, an older engine module) runs one
// through runStudioEffect, the one door between the two.
//
// Structural because the question is the return TYPE: a function returning
// another promise's call, with no `async` and no annotation, is invisible to
// a syntax rule.
//
// Negative space: a class's methods and an object's function-valued fields
// aren't read; a service is a Context.Service whose methods return Effects.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SignatureKind, SymbolFlags, type Type, type TypedProgram } from '../type-checker.ts';
import { effectNativeRole } from '../../policy/studio-tree.ts';
import { findingAtNode, typedSources } from '../type-shapes.ts';

const ID = 'effect-native-exports';

const PROMISE_TYPE_NAMES = new Set(['Promise', 'PromiseLike']);

/** A promise, or a union with one in it: `Promise<A> | undefined` hands a promise back on some path. */
function isPromiseType(type: Type): boolean {
  if (type.isUnionType()) return type.getTypes().some(isPromiseType);
  return PROMISE_TYPE_NAMES.has(type.getSymbol()?.name ?? '');
}

function returnsPromise(typed: TypedProgram, type: Type): boolean {
  return typed.checker.getSignaturesOfType(type, SignatureKind.Call).some((signature) => {
    const returned = typed.checker.getReturnTypeOfSignature(signature);
    return returned !== undefined && isPromiseType(returned);
  });
}

export const effectNativeExportsCheck: StructuralCheck = {
  id: ID,
  // Advisory until the footage rewrites land: the features listed still hold the promise code they replace.
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      if (effectNativeRole(context.positionOf(source.path)) !== 'engine') continue;
      const { checker } = source.typed;
      const moduleSymbol = checker.getSymbolAtLocation(source.file);
      if (moduleSymbol === undefined) continue;
      const exported = checker.getExportsOfModule(moduleSymbol);
      const targets = exported.map((symbol) => (symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol));
      const types = checker.getTypeOfSymbol(targets);
      for (const [index, symbol] of exported.entries()) {
        const type = types[index];
        if (type === undefined || !returnsPromise(source.typed, type)) continue;
        const declaration = symbol.declarations[0]?.resolve();
        if (declaration === undefined) continue;
        findings.push(findingAtNode(ID, source, declaration, symbol.name,
          `\`${symbol.name}\` returns a promise from Effect-native engine code, so its failures arrive untyped and its ` +
          'dependencies unprovided. Return an Effect, and let a promise-world caller run it through runStudioEffect'));
      }
    }
    return findings;
  },
};
