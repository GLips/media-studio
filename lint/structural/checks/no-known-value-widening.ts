// ─── No known-value widening ──────────────────────────────────────────
//
// A literal keeps the type TypeScript read from it: no annotation on a
// variable, a class property or a return replaces its own keys with `unknown`,
// `any`, `object` or an open dictionary. So `handlers.stpo` is an error and
// `satisfies` checks the values without the loss. `Record<string, Handler>`
// reports though its value is precise: the loss is in the keys. A closed domain
// (`Record<'start' | 'stop', Handler>`) deletes nothing and is legal.
//
// An empty `{}` or `[]` is legal: an accumulator gets the type it grows into,
// the one case where the annotation adds information.
//
// Negative space: the value must be written at the annotation. `const h: Bag =
// base` and any call (`const x: unknown = parse(text)`, a boundary) are silent;
// no-widen-then-assert follows a binding where an assertion makes it pointless.

import type { Finding, StructuralCheck } from '../check-context.ts';
import { SyntaxKind, type Node } from '../type-checker.ts';
import {
  enclosingFunctionLike, findingAtNode, NON_PRIMITIVE_TYPE_FLAGS, openKeyDomainValueTypes, typeCheckableNodesOfKind,
  typedSources, typeResolvesToFlags, UNTYPED_TYPE_FLAGS, type TypedSource,
} from '../type-shapes.ts';

const ID = 'no-known-value-widening';

/** Values whose type is visible in the source, so an annotation over one can only subtract. */
const SELF_EVIDENT_VALUE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ArrayLiteralExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.ClassExpression,
  SyntaxKind.FalseKeyword,
  SyntaxKind.FunctionExpression,
  SyntaxKind.NewExpression,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.NumericLiteral,
  SyntaxKind.ObjectLiteralExpression,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.TemplateExpression,
  SyntaxKind.TrueKeyword,
]);

/** Where an annotation sits directly above a written value; a concise arrow's body is a return with no statement. */
const WIDENING_SITE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.VariableDeclaration,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.ReturnStatement,
  SyntaxKind.ArrowFunction,
]);

type AnnotatedValue = { site: Node; value: Node; annotation: Node };

export const noKnownValueWideningCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const source of typedSources(context)) {
      const pairs = typeCheckableNodesOfKind(source.file, WIDENING_SITE_KINDS)
        .map(annotatedValueAt)
        .filter((pair): pair is AnnotatedValue => pair !== undefined && isSelfEvidentValue(pair.value));
      if (pairs.length === 0) continue;
      // Batched on the annotations, never the values: the value is judged by syntax, which is what "written here" means.
      const types = source.typed.checker.getTypeAtLocation(pairs.map((pair) => pair.annotation));
      for (const [index, pair] of pairs.entries()) {
        const type = types[index];
        if (!type) continue;
        const dictionary = openKeyDomainValueTypes(source.typed, type) !== undefined;
        if (!dictionary && !typeResolvesToFlags(source.typed, type, UNTYPED_TYPE_FLAGS | NON_PRIMITIVE_TYPE_FLAGS)) continue;
        const annotation = pair.annotation.getText(source.file);
        // Two messages: `satisfies unknown` compiles and checks nothing, so it's only offered for the dictionary.
        const message = dictionary
          ? `this annotation discards the literal's own keys. Use \`satisfies ${annotation}\` to check the values ` +
            'without opening the key domain, or drop the annotation'
          : `this annotation replaces everything TypeScript knew about the value with \`${annotation}\`, which states ` +
            'no contract. Drop it, or name the type the literal already has';
        findings.push(findingAtNode(ID, source, pair.value, siteKey(source, pair), message));
      }
    }
    return findings;
  },
};

/** The declaration's name and its annotation (`handlers: Record<string, Handler>`), or `return X` for a return. */
function siteKey(source: TypedSource, { site, annotation }: AnnotatedValue): string {
  const name = (site as Node & { name?: Node }).name;
  const spelled = annotation.getText(source.file).replace(/\s+/g, ' ');
  return name && site.kind !== SyntaxKind.ArrowFunction ? `${name.getText(source.file)}: ${spelled}` : `return ${spelled}`;
}

function annotatedValueAt(site: Node): AnnotatedValue | undefined {
  const node = site as Node & { type?: Node; initializer?: Node; expression?: Node; body?: Node };
  if (site.kind === SyntaxKind.ReturnStatement) {
    // The annotation belongs to the enclosing function, not the statement.
    const returnType = (enclosingFunctionLike(site) as (Node & { type?: Node }) | undefined)?.type;
    return returnType && node.expression ? { site, value: withoutParentheses(node.expression), annotation: returnType } : undefined;
  }
  if (site.kind === SyntaxKind.ArrowFunction) {
    if (!node.body || node.body.kind === SyntaxKind.Block || !node.type) return undefined;
    return { site, value: withoutParentheses(node.body), annotation: node.type };
  }
  return node.type && node.initializer ? { site, value: withoutParentheses(node.initializer), annotation: node.type } : undefined;
}

/** `(): Bag => ({ a: 1 })` must parenthesise its object, so reading the outer node would miss every concise return. */
function withoutParentheses(value: Node): Node {
  let inner = value;
  while (inner.kind === SyntaxKind.ParenthesizedExpression) {
    const wrapped = (inner as Node & { expression?: Node }).expression;
    if (!wrapped) break;
    inner = wrapped;
  }
  return inner;
}

function isSelfEvidentValue(value: Node): boolean {
  if (!SELF_EVIDENT_VALUE_KINDS.has(value.kind)) return false;
  const literal = value as Node & { properties?: readonly Node[]; elements?: readonly Node[] };
  if (value.kind === SyntaxKind.ObjectLiteralExpression) return (literal.properties?.length ?? 0) > 0;
  if (value.kind === SyntaxKind.ArrayLiteralExpression) return (literal.elements?.length ?? 0) > 0;
  return true;
}
