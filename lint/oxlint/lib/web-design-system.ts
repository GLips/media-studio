// The web app's design system, as the style rules see it. Their subject is the review app's UI, so
// each asks here first: a Remotion scene or a lib studio component styles frames, not the app, and
// no style rule reads it.

import { webPlaceOf, type RuleFile } from "./rule-file.ts";

/** The token table: the one module that must spell raw values, because it defines them. */
const THEME_MODULE = "theme.stylex.ts";

/** Where the primitives live, spelled as an importer writes it. */
export const SHARED_UI_SPECIFIER = "#web/shared/ui/";

const fileNameOf = (file: RuleFile) => file.path.slice(file.path.lastIndexOf("/") + 1);

/** A web/src/ file that renders the app's UI: anywhere in the app but the token table. */
export function isStyleSubject(file: RuleFile): boolean {
  const place = webPlaceOf(file.position);
  if (place === undefined) return false;
  return !(place.place === "shared-ui" && fileNameOf(file) === THEME_MODULE);
}

/** web/src/shared/ui/: the primitives turn token props into real declarations, so they write what the rules ban elsewhere. */
export function isPrimitivesLayer(file: RuleFile): boolean {
  return webPlaceOf(file.position)?.place === "shared-ui";
}

/** TanStack Router's root route, which renders the document shell (`<html>`, `<body>`) no primitive can stand in for. */
export function isRootRoute(file: RuleFile): boolean {
  return webPlaceOf(file.position)?.place === "route" && fileNameOf(file) === "__root.tsx";
}

/** The primitives-layer module named `name` (without extension). */
export function isPrimitiveModule(file: RuleFile, name: string): boolean {
  return isPrimitivesLayer(file) && fileNameOf(file).replace(/\.tsx?$/, "") === name;
}
