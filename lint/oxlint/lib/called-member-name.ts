import { type ESTree } from "@oxlint/plugins";
import { staticKeyName } from "./static-key-name.ts";

/**
 * The last segment of a callee: `catch` for `catch(…)`, `Effect.catch(…)` and `Effect["catch"](…)`.
 * The Effect rules match a member by name, so a namespace alias (`import * as Eff`) reads the same.
 *
 * NEGATIVE SPACE: an aliased named import (`import { catchCause as recover }`) is not followed;
 * this tier has no scope resolution for it.
 */
export function calledMemberName(callee: ESTree.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  return callee.type === "MemberExpression"
    ? staticKeyName(callee.property, callee.computed)
    : undefined;
}
