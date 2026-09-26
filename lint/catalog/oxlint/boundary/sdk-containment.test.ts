// The rows this exercises are the rows in `lint/catalog/policy/package-owners.ts`. A project
// that prunes them prunes these cases with them — which is the point of the spec
// shipping beside the rule rather than beside the data: what is proved here is the
// READER, and the reader is the same whatever the rows say.
//
// Three rows: `#engine` (lib/engine) is owned by `infrastructure/studio-engine.server.ts`, and
// `@remotion/renderer` and `@remotion/bundler` are banned outright — the app reaches a render
// through the engine, never the renderer itself.

import { describeRule } from "../lib/rule-spec.ts";
import { sdkContainmentRule } from "./sdk-containment.ts";

const FEATURE_CONTROLLER = "/repo/web/src/features/review/controllers/review-queries.ts";
const FEATURE_UI = "/repo/web/src/features/review/ui/review-screen.tsx";
const ROUTE = "/repo/web/src/routes/media.$project.ts";
const ENGINE_DOOR = "/repo/web/src/infrastructure/studio-engine.server.ts";
const IMPORT_ENGINE = `import { readReviewArtifact } from "#engine/review/review-artifact.ts";`;

describeRule("boundary/sdk-containment", sdkContainmentRule, {
  obvious: [
    {
      name: "a feature controller reaching the engine directly rather than through the app's one door",
      filename: FEATURE_CONTROLLER,
      code: IMPORT_ENGINE,
      errors: [{ message: "#engine/review/review-artifact.ts may only be imported by #web/infrastructure/studio-engine.server.ts. lib/engine reads and writes the studio's projects on disk and spawns renders, so it only runs on the server. One door means one place that decides which engine calls a browser request can reach; the app calls it through a server function or a server route." }],
    },
    {
      name: "a route rendering a composition itself",
      filename: ROUTE,
      code: `import { renderMedia } from "@remotion/renderer";`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
  ],

  adversarial: [
    {
      name: "a client component reaching the engine, which a browser chunk can't carry",
      filename: FEATURE_UI,
      code: IMPORT_ENGINE,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a scoped package's own subpath, two separators deep",
      filename: FEATURE_CONTROLLER,
      code: `import { getCompositions } from "@remotion/renderer/dist/get-compositions";`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: ROUTE,
      code: `export const loader = async () => (await import("#engine/project/studio-project.ts")).listStudioProjects;`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a re-export hands the engine on under the feature's own name",
      filename: FEATURE_CONTROLLER,
      code: `export { buildLabCatalog } from "#engine/lab/lab-catalog.ts";`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: FEATURE_CONTROLLER,
      code: `export * from "@remotion/bundler";`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a literal require() is the same dependency, and reaches no import visitor",
      filename: FEATURE_CONTROLLER,
      code: `const engine = require("#engine/review/project-media.ts");`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a directory that merely starts with 'infrastructure' owns nothing",
      filename: "/repo/web/src/infrastructure-legacy/studio-engine.server.ts",
      code: IMPORT_ENGINE,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "a filename that merely extends an owner's does not inherit its exemption",
      filename: "/repo/web/src/infrastructure/studio-engine-legacy.server.ts",
      code: IMPORT_ENGINE,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      // The engine door is exempt for its OWN row only: a total ban has no owner to exempt.
      name: "an owner is exempt for its OWN package only, so the door is not a general permission",
      filename: ENGINE_DOOR,
      code: `import { renderMedia } from "@remotion/renderer";`,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
    {
      name: "an app entrypoint is not a category that inherits a pass — it owns the row or it does not",
      filename: "/repo/web/src/router.tsx",
      code: IMPORT_ENGINE,
      errors: [{ messageId: "rawSdkOutsideOwner" }],
    },
  ],

  legal: [
    {
      name: "the owning module is exactly where the engine belongs",
      filename: ENGINE_DOOR,
      code: `${IMPORT_ENGINE}\nexport { listStudioProjects } from "#engine/project/studio-project.ts";`,
    },
    {
      name: "the door, which is what callers are meant to import",
      filename: FEATURE_CONTROLLER,
      code: `import { readReviewArtifact } from "#web/infrastructure/studio-engine.server.ts";`,
    },
    {
      name: "the browser-side studio and models aliases have no row",
      filename: FEATURE_UI,
      code: `import { Player } from "#studio";\nimport { cueAt } from "#models/timeline/cue.ts";`,
    },
    {
      name: "a package whose name merely starts with an owned one",
      filename: FEATURE_UI,
      code: `import { Player } from "@remotion/player";\nimport { engineVersion } from "#engine-docs/version.ts";`,
    },
    {
      name: "a relative path that happens to end in an owned package's name is a file in this repo",
      filename: FEATURE_CONTROLLER,
      code: `import { engine } from "./#engine";`,
    },
    {
      name: "a test may reach the engine to build a fixture",
      filename: "/repo/web/src/features/review/controllers/review-queries.test.ts",
      code: IMPORT_ENGINE,
    },
    {
      name: "a one-off script is not part of the shipped module graph",
      filename: "/repo/web/scripts/backfill-notes.ts",
      code: IMPORT_ENGINE,
    },
  ],
});
