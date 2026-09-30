// ─── no-vacant-symbol-names ───────────────────────────────────
//
// Makes sure: every name another file can reach (a type, and a module- or
// namespace-level function, class or constant) says what it is for, so one grep
// for `ReviewNoteRow` finds it, not six `ReviewData`s.
//
// Declarations only, never references: an imported `DataGrid` isn't ours to
// rename. `declare module "…"` and `declare global` describe a package's or a
// host's names and are exempt; `declare namespace App` is ours and isn't.
// Object properties aren't read, since an external payload dictates `{ data }`.
// Keep `base`, `item` and `value` out of VACANT_TERMS: each is exact in its place.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";

const VACANT_TERMS = new Set([
  "data",
  "helper",
  "helpers",
  "info",
  "manager",
  "object",
  "shape",
  "stuff",
  "thing",
  "util",
  "utils",
]);

// Whole-word matching after splitting the identifier. The upstream rule this generalises uses a
// case-insensitive substring test, which flags `reshape`, `metadata`, and `database` — three
// false positives that would each read as the rule being broken rather than the name being bad.
function identifierWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[\s_]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function vacantTerm(name: string): string | null {
  return identifierWords(name).find((word) => VACANT_TERMS.has(word)) ?? null;
}

/**
 * A declaration is an "address" when something outside its own block can reach it by name. Locals
 * inside a function body are excluded: they are read in the same screenful that declares them.
 *
 * A NAMESPACE body is transparent here, because `N.data` is an address in exactly the sense the
 * header means — one search finds the declaration and each use. Reading `TSModuleBlock` as a
 * boundary makes the rule say two things about one namespace: the type arms ask this question about
 * nothing, so `namespace N { export type Data = … }` reports while the `export const data` beside
 * it does not.
 *
 * `isAmbientDescription` is asked separately, because it is the one exclusion the TYPE arms need
 * too and they ask no position question at all.
 */
function declaresAddressableName(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (current.type === "Program") return true;
    if (
      current.type === "VariableDeclaration" ||
      current.type === "ExportNamedDeclaration" ||
      current.type === "ExportDefaultDeclaration" ||
      current.type === "TSModuleBlock" ||
      current.type === "TSModuleDeclaration"
    ) {
      current = current.parent;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Whether a declaration merely DESCRIBES a name declared somewhere else.
 *
 * `declare module "@vendor/tables"` and `declare global` name a package's exports and a host's
 * globals. The project cannot rename either, so a report there names no edit anyone can make —
 * the same failure the header calls out for the every-Identifier version of this rule, reached one
 * construct over. Asked by every arm, values and types alike, because `declare module "@vendor/x"
 * { export type Data = … }` is as unrenamable as the const beside it.
 *
 * Those TWO constructs and no other, which is why `declare` alone is not the test. A `declare
 * namespace App` names something this project owns and can rename, so it keeps reporting — matched
 * on `declare` alone it would be exempt, and the justification above would cover a case it does not
 * describe. The two are told apart by what they are named BY: a module by a string literal, the
 * global scope by its own kind.
 *
 * NEGATIVE SPACE: a `.d.ts` needs none of this. defineSourceRule skips ambient files already, so
 * this reaches only the ambient blocks written INSIDE an ordinary source file.
 */
function isAmbientDescription(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (
      current.type === "TSModuleDeclaration" &&
      current.declare === true &&
      (current.kind === "global" || current.id.type === "Literal")
    ) {
      return true;
    }
    if (current.type === "Program") return false;
    current = current.parent;
  }
  return false;
}

export const noVacantSymbolNamesRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      vacantName:
        "`{{name}}` is named for what kind of thing it is, not what it is for — every type is a shape, every value is data. Name the role: which layer owns this representation and what it is used for (`UserRow`, `CreateUserInput`, `UserResponse`).",
    },
  },
  create(context) {

    const report = (identifier: ESTree.Node & { name: string }) => {
      if (vacantTerm(identifier.name) === null) return;
      if (isAmbientDescription(identifier)) return;
      context.report({
        node: identifier,
        messageId: "vacantName",
        data: { name: identifier.name },
      });
    };

    // Named by the three node types rather than by a structural `{ id }`, because a visitor
    // handler has to accept the AST's node union: a shape that only some nodes satisfy is not
    // assignable to the visitor slot, whichever three nodes actually reach it.
    const reportNamedDeclaration = (
      node:
        | ESTree.TSTypeAliasDeclaration
        | ESTree.TSInterfaceDeclaration
        | ESTree.TSEnumDeclaration,
    ) => {
      report(node.id);
    };

    // Types report wherever they are declared: there is no "local type" the way there is a local
    // variable, so these three arms ask no position question at all. The value arms below ask one,
    // and `declaresAddressableName` is written so that a namespace answers the same for both.
    return {
      TSTypeAliasDeclaration: reportNamedDeclaration,
      TSInterfaceDeclaration: reportNamedDeclaration,
      TSEnumDeclaration: reportNamedDeclaration,

      FunctionDeclaration(node) {
        if (node.id !== null && declaresAddressableName(node)) report(node.id);
      },
      ClassDeclaration(node) {
        if (node.id !== null && declaresAddressableName(node)) report(node.id);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && declaresAddressableName(node)) report(node.id);
      },
    };
  },
});
