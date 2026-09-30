// What a parameter BINDS and what it is annotated with, seen through the wrappers that carry
// either one. prop-count is the only reader.
//
// Only the syntactic question lives here: which node holds the annotation. What a type MEANS needs
// a type checker, so a rule asking that belongs in the structural tier, not in a second syntactic
// approximation here.

import type { ESTree } from "@oxlint/plugins";

/**
 * The annotation on a parameter, reached through the wrappers that carry their own.
 *
 * A rule reading `parameter.typeAnnotation` directly sees nothing for `...rest: unknown[]`,
 * `input: unknown = fallback`, or a constructor's `private readonly input: unknown` — three
 * ordinary spellings, each a silent hole.
 */
export function parameterAnnotation(
  parameter: ESTree.ParamPattern,
): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") return parameterAnnotation(parameter.parameter);
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

/**
 * The pattern a parameter destructures, or undefined when the parameter binds a plain name.
 *
 * Sees through the default in `({ a, b } = { a: 1, b: 2 })`. Only that ONE wrapper, on purpose: a
 * parameter property can't destructure (TS1187), and `(...{ a, b })` destructures the arguments
 * array, whose keys (`0`, `1`, `length`) are not the caller's object.
 */
export function parameterObjectPattern(
  parameter: ESTree.ParamPattern,
): ESTree.ObjectPattern | undefined {
  if (parameter.type === "AssignmentPattern") return parameterObjectPattern(parameter.left);
  return parameter.type === "ObjectPattern" ? parameter : undefined;
}
