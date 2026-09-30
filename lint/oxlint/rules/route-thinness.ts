// ─── route-thinness ──────────────────────────────────────────────────
//
// Makes sure: No web route imports server-only code: a `.server` module in
// web/src/infrastructure/ (the app's door into lib's engine) or lib engine code.
// A route file runs in the browser too, so that import drags Node machinery
// into the client bundle. Data comes through a feature's barrel.
//
// The target is placed by studio-tree.ts after `#` and relative specifiers are
// expanded, so neither spelling slips past. A package specifier names no
// position and is not read.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, importedPosition, webPlaceOf } from "../lib/rule-file.ts";
import { visitModuleSources } from "../lib/module-source-visitor.ts";

export const routeThinnessRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      serverOnlyImportInRoute:
        "Routes are isomorphic thin adapters: {{specifier}} is {{kind}}, which is server-only. Import data through the feature's barrel (#web/features/<feature>/index.ts), which reaches the server through its controllers.",
    },
  },
  create(context, file) {
    if (webPlaceOf(file.position)?.place !== "route") return {};

    return visitModuleSources((source, specifier) => {
      const target = importedPosition(file, specifier, context.cwd);
      if (target?.kind !== "web-server" && target?.kind !== "engine") return;
      context.report({
        node: source,
        messageId: "serverOnlyImportInRoute",
        data: { specifier, kind: target.kind === "engine" ? "lib engine code" : "a web .server module" },
      });
    });
  },
});
