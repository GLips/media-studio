// ─── No opaque record ─────────────────────────────────────────────────
//
// No type is an open dictionary with an `unknown`, `any` or `object` value:
// `Record<string, unknown>`, an index signature, a mapped type over an open key
// domain, or an alias to one. So a misspelled key is a compile error rather
// than `undefined` at run time, and a field rename reports at each read. Which
// open domain (string, number, PropertyKey) isn't read; a closed one
// (`Record<keyof T, unknown>`, a dirty-field tracker) names a shape and is legal.
//
// A bag reached through a name declared in the governed tree reports at that
// declaration only. One declared anywhere else (lib.d.ts, a .d.ts, a package)
// reports at each use, the only place it can: asking "is it in the program"
// instead would let an ambient `declare type Bag = …` silence every use.
//
// Negative space: `Record<'draft' | 'paid', unknown>` is silent; its keys are
// checked, though its reads still need casts. An array isn't a bag.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SyntaxKind, type Node, type Type, type TypedProgram } from '../type-checker.ts';
import { constructKey, findingAtNode, isOpaqueDictionary, typeCheckableNodesOfKind, typedSources } from '../type-shapes.ts';

const ID = 'no-opaque-record';

const MESSAGE =
  'an open dictionary with an unknown, any or object value is an untyped bag: every read needs a cast and no key is ' +
  'checked. Declare the fields as a named type, use Map<string, T> for keys known only at run time, or parse ' +
  'external input with a schema that returns a typed shape';

/**
 * Where a bag is written. The subject is the type carrying the signature, not the IndexSignature node, which is what
 * makes `Partial<Record<string, unknown>>` one finding at its outermost spelling. An interface is a statement no
 * type-position walk reaches, so it's listed by itself.
 */
const BAG_SITE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.TypeReference,
  SyntaxKind.TypeLiteral,
  SyntaxKind.MappedType,
  SyntaxKind.InterfaceDeclaration,
]);

export const noOpaqueRecordCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const sites = typeCheckableNodesOfKind(source.file, BAG_SITE_KINDS);
      if (sites.length === 0) continue;
      const types = typesOfSites(source.typed, sites);
      const reported: Node[] = [];
      for (const [index, node] of sites.entries()) {
        const type = types[index];
        if (!type || !isOpaqueDictionary(source.typed, type)) continue;
        // Outermost wins: document order puts the enclosing node first, so a site inside one reported is the same bag.
        if (reported.some((seen) => seen.pos <= node.pos && node.end <= seen.end)) continue;
        if (node.kind === SyntaxKind.TypeReference && source.typed.declaredInTree(node)) continue;
        reported.push(node);
        const name = (node as Node & { name?: Node }).name;
        const key = node.kind === SyntaxKind.InterfaceDeclaration && name ? `interface ${constructKey(source, name)}` : constructKey(source, node);
        findings.push(findingAtNode(ID, source, node, key, MESSAGE));
      }
    }
    return findings;
  },
};

/**
 * The type each site denotes, in order. An interface's type isn't the type "at" its declaration node, so it's read
 * through its symbol, one request each; everything else goes in one batch.
 */
function typesOfSites(typed: TypedProgram, sites: readonly Node[]): (Type | undefined)[] {
  const inline = sites.filter((node) => node.kind !== SyntaxKind.InterfaceDeclaration);
  const inlineTypes = inline.length > 0 ? typed.checker.getTypeAtLocation(inline) : [];
  let next = 0;
  return sites.map((node) => {
    if (node.kind !== SyntaxKind.InterfaceDeclaration) return inlineTypes[next++];
    const name = (node as Node & { name?: Node }).name;
    const symbol = name ? typed.checker.getSymbolAtLocation(name) : undefined;
    return symbol ? typed.checker.getDeclaredTypeOfSymbol(symbol) : undefined;
  });
}
