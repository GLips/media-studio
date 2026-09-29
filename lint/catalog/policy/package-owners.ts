// ─── policy/package-owners — which module owns which SDK ─────────────────────
//
// The data behind `boundary/sdk-containment`. It lives here rather than inside
// that rule for the same reason the import table does: it is a fact about the
// application's shape, and a rule body is a place no reader can enumerate.
//
// This is NOT part of the import table, and folding it in is the one merge that
// did not pay. Its policy is keyed by exact package and exact module, not by
// area — and reaching an ordering where the table could express it forces
// `domain → package` to claim the domain may import any package, a cell stating
// something untrue so that machinery could work. One table, several readers; the
// rule merge was the part worth refusing.
//
// A domain importing a raw SDK genuinely breaks two policies and gets two
// diagnostics, which is deliberate. The one requirement is that both stay jointly
// actionable: the ownership message NAMES ITS OWNERS and does not prescribe an
// import, because "import the wrapper from infrastructure instead" is a fix that
// `import-policy`'s runtime purity ALSO forbids, and a pair of diagnostics that
// each forbid the other's fix is an edit loop. Read together, the two resolve to
// "the dependency has to be supplied from above", which is the right answer.
//
// A row names a package by its CANONICAL name and never by pattern. Matching a
// subpath is the reader's job — `stripe/webhooks` is `stripe` — so there is no
// anchor to get wrong, where a regex alternation of package names has one per
// entry and reads `stripe-mock` as `stripe` the first time somebody forgets it.
//
// ── Adapt ────────────────────────────────────────────────────────────────────
//
// One row per CANONICAL package name. Not a regex, and not a group: an entry
// covering three packages against two possible owners makes "the declared owner
// no longer imports this package" a question with no definition, and the rule
// then cannot tell a live containment from a dead one.
//
// A package belongs here when a SECOND import site would have to repeat a
// decision: a credential to supply, a connection to open, a per-environment value
// to pick, or behaviour that differs by platform or runtime. Any one is enough,
// and the criterion is the decision rather than the vendor — a platform or
// stdlib-shaped package counts.
//
// What does NOT belong is a library with no credential, no IO and no
// per-environment config: date maths, schema validation, immutable helpers.
// Wrapping those buys an indirection and nothing else, and a list that grows past
// the packages meeting the criterion teaches people the rule is arbitrary.
//
// NEGATIVE SPACE: a package with no row here is UNCONSTRAINED, and nothing
// detects that state. Whether a package reaches a network, a keychain or a
// filesystem is a judgement; the nearest mechanical proxy would flag React while
// still missing the first bad import. Adding an SDK means adding the row.
//
// NEGATIVE SPACE: an ORM is deliberately absent. `drizzle-orm` is imported by
// every repo module and by the schema, which is the LAYER-RESTRICTED pattern —
// `boundary/db-isolation` fences the DB client and schema by layer, and a wrapper
// around a query builder would only forward calls. Containment and layer
// restriction are different answers, and putting a layer-restricted package on
// this list bans it from the layer it belongs in.
//
// ─────────────────────────────────────────────────────────────────────────────

export type PackageOwnership = {
  /** The package, exactly as package.json spells it. Subpaths are the reader's job. */
  package: string;
  /**
   * For an alias whose one name covers code on both sides of a fence: the specifiers the row governs, in place of
   * matching `package` by name. `package` then only names the row in messages.
   */
  matches?: RegExp;
  /**
   * The modules allowed to import it, source-root-relative and with the real
   * extension. A LIST because two modules can jointly own one capability, and an
   * explicit list is what makes "does any owner still import this?" answerable.
   *
   * EMPTY is the spelling for a TOTAL BAN, and it is a different statement from a
   * path that names nothing. A path is a module somebody can create, so the
   * licence is lying there waiting for whoever creates it; `[]` names no module in
   * any tree and there is nothing to create. Use it only where the package is
   * something this tree must never reach at all, rather than something one module
   * should concentrate — see the `@remotion/renderer` row.
   */
  owners: string[];
  /** Which decisions the wrapper already made, and what a second caller would get wrong. */
  why: string;
};

/**
 * The packages the studio's web app contains. One row per SDK as it arrives, and
 * a row naming a package that is no longer a dependency gets deleted.
 *
 * Owner paths are relative to the importing file's own tree's source root
 * (`web/src`). A row with NO owner governs the tree unconditionally, which is
 * what makes it a total ban rather than a containment.
 *
 * The engine row is the studio's Node-side machinery: every feature's `engine/`
 * folder, reached as `#lib/<area>/<feature>/engine/…`. `#lib` also names the
 * browser-safe `models/` and `studio/` code the app imports freely, so that row
 * matches the specifier's shape rather than the package name.
 */
export const PACKAGE_OWNERS: PackageOwnership[] = [
  {
    package: "#lib/*/*/engine",
    matches: /^#lib\/[^/]+\/[^/]+\/engine\//,
    owners: ["infrastructure/studio-engine.server.ts"],
    why: "Engine code reads and writes the studio's projects on disk and spawns renders, so it only runs on the server. One door means one place that decides which engine calls a browser request can reach; the app calls it through a server function or a server route.",
  },
  {
    package: "@remotion/renderer",
    owners: [],
    why: "NOTHING in the web app renders a composition itself. The engine owns the renderer's browser, its worker count and its GL check; the app reaches a render through #web/infrastructure/studio-engine.server.ts.",
  },
  {
    package: "@remotion/bundler",
    owners: [],
    why: "NOTHING in the web app bundles a composition itself: that is the engine's, reached through #web/infrastructure/studio-engine.server.ts. The app's own bundle is Vite's.",
  },
];
