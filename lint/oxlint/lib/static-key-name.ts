import type { ESTree } from "@oxlint/plugins";

/**
 * The name a member expression or an object-pattern property reads, however spelled.
 *
 * `process["env"]` is the dotted read respelled, the form code drifts to when only dots are fenced.
 *
 * NEGATIVE SPACE: a key not statically known (`ns[name]`, a `Symbol`) gets `undefined`, never a
 * guess from source text. So does `ns[0]`, an index; an export named `"0"` arrives as a string.
 */
export function staticKeyName(key: ESTree.Node, computed: boolean): string | undefined {
  // A non-computed key is an Identifier OR a string literal — `{ "localStorage": ls }` is a quoted
  // property, not a computed one, and reading only Identifier there misses it while the computed
  // arm below catches the equivalent `{ ["localStorage"]: ls }`.
  if (key.type === "Identifier") return computed ? undefined : key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
}
