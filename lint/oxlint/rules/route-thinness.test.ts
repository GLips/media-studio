import { describeRule } from "../lib/rule-spec.ts";
import { routeThinnessRule } from "./route-thinness.ts";

const ROUTE = "web/src/routes/projects.tsx";
const SERVER_MODULE = "#web/infrastructure/studio-engine.server.ts";

describeRule("route-thinness", routeThinnessRule, {
  obvious: [
    {
      name: "a route reaching past the feature barrel to the engine door",
      filename: ROUTE,
      code: `import { studioEngine } from "${SERVER_MODULE}";`,
      errors: [{ message: `Routes are isomorphic thin adapters: ${SERVER_MODULE} is a web .server module, which is server-only. Import data through the feature's barrel (#web/features/<feature>/index.ts), which reaches the server through its controllers.` }],
    },
    {
      name: "a route importing lib engine code",
      filename: ROUTE,
      code: `import { renderStill } from "#lib/output/render/engine/render-still.ts";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
  ],

  adversarial: [
    {
      name: "a relative specifier reaches the same module",
      filename: ROUTE,
      code: `import { studioEngine } from "../infrastructure/studio-engine.server.ts";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a dynamic import is a call expression, not an import declaration",
      filename: ROUTE,
      code: `export const loader = async () => (await import("${SERVER_MODULE}")).studioEngine;`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "a star re-export names no binding to notice",
      filename: ROUTE,
      code: `export * from "${SERVER_MODULE}";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
    {
      name: "the root route is a route like any other",
      filename: "web/src/routes/__root.tsx",
      code: `import { studioEngine } from "${SERVER_MODULE}";`,
      errors: [{ messageId: "serverOnlyImportInRoute" }],
    },
  ],

  legal: [
    {
      name: "the feature barrel, which is how a route is meant to get data",
      filename: ROUTE,
      code: `import { ProjectsPage } from "#web/features/projects/index.ts";`,
    },
    {
      name: "a lib models module, which loads anywhere",
      filename: ROUTE,
      code: `import { landingArtifactOf } from "#lib/output/review/models/review-artifact.ts";`,
    },
    {
      name: "a client-safe infrastructure module",
      filename: ROUTE,
      code: `import { queryClient } from "#web/infrastructure/providers/query-client.ts";`,
    },
    {
      name: "a feature controller may reach the server",
      filename: "web/src/features/projects/controllers/project-listings.ts",
      code: `import { studioEngine } from "${SERVER_MODULE}";`,
    },
    {
      name: "a route's test may reach across every boundary",
      filename: "web/src/routes/projects.test.tsx",
      code: `import { studioEngine } from "${SERVER_MODULE}";`,
    },
  ],
});
