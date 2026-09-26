// ─── placement/deprecated-paths ─────────────────────────────────────────
//
// Makes sure: No file imports a path that a migration removed. You move
// `#/db/` under `#/infrastructure/` once and it stays moved, because the next
// import of `#/db/*` fails the lint and the message names the directory that
// holds the code now. You do not search the tree for old paths after each
// change an agent writes.
//
// Each deprecated path keeps its own messageId. The message is the fix
// instruction, thus it names the old path and the exact directory the code
// moved to. One shared "this path is deprecated" message sends the reader
// somewhere else for the answer.
//
// Delete an entry only after the last import of that path is gone. An entry
// removed while agents still write the old path from memory is the point where
// the migration reverses, and no report follows.
//
// The rule reads the specifier and says the old path is gone. Whether the new
// path is one this file may import at all is boundary/import-policy's finding.
//
// SCOPE, and it is the same for every TREE-SCOPED rule in this catalog — which
// is every rule but `testing/no-module-mocking`, whose subject is a test file and
// which is therefore enabled globally. This rule is silent outside the declared
// trees, and silent on the files `isArchitectureExemptSourcePath` names inside
// them — tests, scripts, generated and ambient modules. Neither
// silence is coverage. `lib/define-tree-rule.ts` owns both, which is why no rule
// body checks either one.
// ──────────────────────────────────────────────────────────────────────

import { defineTreeRule } from "../lib/define-tree-rule.ts";
import { visitModuleSources } from "../lib/module-source-visitor.ts";

// The lab and the review screen moved out of the repo's top-level `lab/` (a Vite app of its own)
// into this tree's features. An agent that remembers the old app reaches it by a relative climb,
// which names the same directory from every importing file, so the row matches the path segment
// anywhere in the specifier rather than an alias head. Closed on a slash or the end, so a live
// module whose name merely starts the same way (`lab/app-shell`) does not inherit it.
const DEPRECATED_PATHS = [
  { pattern: /(^|\/)lab\/(review\/)?app(\/|$)/u, messageId: "labAppMoved" },
] as const;

export const deprecatedPathsRule = defineTreeRule({
  meta: {
    type: "problem",
    messages: {
      labAppMoved:
        "lab/app and lab/review/app moved into the web app: the lab is #web/features/lab/index.ts and the review screen #web/features/review/index.ts. Import the feature's barrel.",
    },
  },
  create(context) {
    return visitModuleSources((source, specifier) => {
      for (const row of DEPRECATED_PATHS) {
        if (row.pattern.test(specifier)) {
          context.report({ node: source, messageId: row.messageId });
          return;
        }
      }
    });
  },
});
