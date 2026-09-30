// ─── server-fn-placement ──────────────────────────────────────
//
// Makes sure: the name createServerFn appears only in a web feature's
// controllers/ (web/src/features/<name>/controllers/), so every endpoint a
// feature exposes is in one directory. Its subject is the name, wherever it is,
// so it reads lib and projects too.
//
// The name, not the call shape: an aliased import or `start.createServerFn()`
// would pass a call match, and the import itself reports. Whether the function
// checks its input is server-fn-validation's finding; what else the module
// exports is no-plain-export-in-server-fn-module's.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule, webPlaceOf } from "../lib/rule-file.ts";
import { visitIdentifierNamed } from "../lib/identifier-occurrences.ts";

const SERVER_FN_FACTORY = "createServerFn";

export const serverFnPlacementRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      serverFnOutsideControllers:
        "createServerFn must be placed in a web feature's controllers/. Server functions are application delivery endpoints. Move this to web/src/features/<name>/controllers/.",
    },
  },
  create(context, file) {
    // The position, not a path: a top-level `web/src/controllers/` is no
    // feature's layer, and neither is a `legacy-controllers/`.
    const place = webPlaceOf(file.position);
    if (place?.place === "feature" && place.layer === "controllers") return {};

    return visitIdentifierNamed(SERVER_FN_FACTORY, (node) => {
      context.report({
        node,
        messageId: "serverFnOutsideControllers",
      });
    });
  },
});
