// ─── The studio web app's structural-tier configuration ──────────────
//
// The one place this project moves a knob in the whole-tree tier. Everything
// about WHERE the architecture is lives in `../policy/declared-trees.ts`; what
// is here is numbers, names and manifests that say nothing about the shape of
// the tree. See `config.ts` for the rule and the reasoning behind it.
//
// Spread `defaultCheckConfigs`, then replace whole values. No deep merge, so an
// override reads in the diff as the complete value it stands in for.
//
// ──────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { type ArchitectureConfig, defaultCheckConfigs } from "./config.ts";

// The repo root: this file sits at lint/catalog/structural/.
const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const THEME_MODULE = resolve(PROJECT_ROOT, "web/src/shared/ui/theme.stylex.ts");

export const architectureConfig: ArchitectureConfig = {
  projectRoot: PROJECT_ROOT,

  checks: {
    ...defaultCheckConfigs,

    "api/barrel-purity": {
      ...defaultCheckConfigs["api/barrel-purity"],
      // The Node-side machinery a browser chunk can't carry. `#engine` is lib/engine, which the app
      // reaches through `infrastructure/studio-engine.server.ts` alone; the rest are the renderer,
      // the bundlers and the dev server lib/engine drives.
      serverOnlyPackages: ["#engine", "@remotion/renderer", "@remotion/bundler", "@remotion/install-whisper-cpp", "esbuild", "vite"],
      // createServerOnlyFn cuts the chain as createServerFn does: Start's compiler replaces its body with a throwing
      // stub in the client build and drops the imports only it used. The features' server-route responders use it.
      serverFnBoundary: {
        ...defaultCheckConfigs["api/barrel-purity"].serverFnBoundary,
        calls: [...defaultCheckConfigs["api/barrel-purity"].serverFnBoundary.calls, "createServerOnlyFn"],
      },
    },

    "health/file-size": {
      ...defaultCheckConfigs["health/file-size"],
      roots: ["web/src"],
    },

    "style/shadow-source": {
      ...defaultCheckConfigs["style/shadow-source"],
      // The app styles with StyleX rather than stylesheets, so the inventory is a
      // stylex.create module of named shadows, in `shared/ui/` with the theme.
      allowedFile: "shared/ui/shadows.ts",
    },

    "style/token-equality": {
      ...defaultCheckConfigs["style/token-equality"],
      // READ out of the theme module rather than imported from it, and never
      // restated here — the point of both spellings is that the enforcer cannot
      // drift from the thing it guards, and a copy of the scale in this file
      // would go stale the first time a token moves.
      //
      // Why not the import the catalog's header describes: a `.stylex.ts` module
      // is not loadable outside StyleX's Babel pass. `stylex.defineVars` is
      // `function stylexDefineVars() { throw … }` at runtime, so an import here
      // would crash the whole tier before any check ran — and even post-compile
      // it yields `var(--x…)` references rather than the CSS lengths this check
      // compares against. The literals in the source ARE the scale; nothing else
      // in the toolchain ever holds them as values.
      //
      // The four prop/key lists stay exactly as shipped: `assertGoverningConfig`
      // throws on an empty one, and each entry is regex source.
      spacingScale: stylexScale("spacing"),
      radiusScale: stylexScale("radius"),
    },
  },
};

/**
 * One `stylex.defineVars({ … })` scale, read out of the theme module's source as
 * the literals a human wrote.
 *
 * Every failure here THROWS rather than returning an empty object, and that is
 * the whole reason this is a function instead of three lines inline. An empty
 * scale is the documented silent state of `style/token-equality` — it walks every
 * style surface and reports nothing — so a rename, a moved file, or a value
 * spelled as an expression would take the check off with a green run and no
 * diff. `runStructuralChecks` calls `assertGoverningConfig` for exactly this
 * class of value and has no case for the scales, so this is where it belongs.
 */
function stylexScale(exportName: string): Record<string, string | number> {
  const source = readFileSync(THEME_MODULE, "utf8");
  const parsed = parseSync(THEME_MODULE, source, { lang: "ts" });

  for (const statement of parsed.program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== "Identifier" || declarator.id.name !== exportName) continue;
      if (declarator.init?.type !== "CallExpression") break;
      const [argument] = declarator.init.arguments;
      if (argument?.type !== "ObjectExpression") break;

      const scale: Record<string, string | number> = {};
      for (const property of argument.properties) {
        if (property.type !== "Property") continue;
        const key = property.key.type === "Identifier" ? property.key.name : undefined;
        const value = property.value.type === "Literal" ? property.value.value : undefined;
        if (key === undefined) continue;
        if (typeof value !== "string" && typeof value !== "number") continue;
        scale[key] = value;
      }
      if (Object.keys(scale).length > 0) return scale;
      break;
    }
  }

  throw new Error(
    `style/token-equality found no "${exportName}" scale in ${THEME_MODULE}. It expects a ` +
      `top-level \`export const ${exportName} = stylex.defineVars({ token: "1rem", … })\` whose ` +
      `values are string or number literals. An empty scale is this check's silent state — it ` +
      `walks every style surface and reports nothing — so the miss is raised here instead of ` +
      `arriving as a clean run.`,
  );
}
