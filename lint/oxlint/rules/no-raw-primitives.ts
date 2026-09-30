// ─── no-raw-primitives ──────────────────────────────────────────
//
// Makes sure: web feature code renders through the design system's primitives,
// not raw elements: no bare `<div>`, and no `View` or `Text` from react-native
// by any import or re-export spelling. A primitive takes token props only.
//
// The primitives layer (web/src/shared/ui/) must use raw elements, and the root
// route renders the document shell, so both are exempt. Give a semantic element
// its primitive's closed `as` prop (`<Box as='nav'>`) rather than an exemption.
// Platform utilities (`Platform`, `StyleSheet`) stay legal; lib/imported-names.ts
// lists the spellings deliberately left unread.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { isPrimitivesLayer, isRootRoute, isStyleSubject, SHARED_UI_SPECIFIER } from "../lib/web-design-system.ts";
import { exportedName, visitImportedNames } from "../lib/imported-names.ts";
import { sourceOrderedReports } from "../lib/source-ordered-reports.ts";

const RAW_HTML_ELEMENTS = new Set([
  "div", "span", "p", "main", "section", "header", "footer", "nav", "aside", "article",
  "ul", "ol", "li", "button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "img",
]);

const PLATFORM_MODULE = "react-native";

// The rendering primitives the design system owns. Utility APIs from the platform module
// (Platform, StyleSheet, useWindowDimensions) are deliberately absent — those are legitimate in
// feature code.
const PLATFORM_RENDERING_PRIMITIVES = new Set([
  "View", "Text", "Pressable", "TouchableOpacity", "ScrollView", "TextInput", "Image",
]);

export const noRawPrimitivesRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      rawHtmlElement:
        "Raw HTML element (highlighted) — compose from the UI primitives instead (Box/Stack/Group for layout, Text/Title for type, Button, Anchor, Image), or `<Box as='...'>` with the tag name when you need the semantic element. A raw element has no token-aware defaults, so every value on it has to be invented. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
      platformPrimitive:
        "Core react-native rendering primitive (highlighted) — import the app equivalent from {{sharedUi}} instead (Box/Stack for View, Text for Text, a Button/Pressable wrapper for touchables). Those take token props, so an off-system value cannot be passed. Utility APIs from react-native (Platform, StyleSheet, useWindowDimensions) are fine in feature code; only the rendering primitives are the design system's to own. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
      platformModuleReExport:
        "This republishes the whole react-native module under this module's name, so any importer gets View/Text/Pressable without ever naming react-native. Re-export the named utility APIs you actually need instead. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
    },
  },
  create(context, file) {
    // The root route renders the document shell (`<html>`, `<body>`), which no primitive stands in for.
    if (!isStyleSubject(file) || isPrimitivesLayer(file) || isRootRoute(file)) return {};

    // Both arms report, and the React Native one only finds its names once the whole file is
    // walked — so without a single ordering owner a file's diagnostics come out with every
    // imported name after every raw element, whatever their line numbers.
    const ordered = sourceOrderedReports(context);
    const sharedUi = { sharedUi: SHARED_UI_SPECIFIER };

    return {
      // --- React Native arm ---
      // Every name the file takes from the platform module, under react-native's own spelling —
      // so `View as Screen` and `RN.View` are the same finding as `View`.
      ...visitImportedNames(context.sourceCode, [PLATFORM_MODULE], (name, node) => {
        if (PLATFORM_RENDERING_PRIMITIVES.has(name)) {
          ordered.report({ node, messageId: "platformPrimitive", data: sharedUi });
        }
      }),

      // --- Web / DOM arm ---
      // One handler covers self-closing and has-children, with attributes or without: every
      // element has exactly one opening tag, whatever it wraps.
      JSXOpeningElement(node) {
        // A member or namespaced name (`<Foo.Bar>`, `<svg:rect>`) is never an intrinsic.
        if (node.name.type !== "JSXIdentifier") return;
        if (RAW_HTML_ELEMENTS.has(node.name.name)) {
          ordered.report({ node: node.name, messageId: "rawHtmlElement" });
        }
      },

      // `export { View } from "react-native"` hands the primitive to every importer of this
      // module without the word `import` appearing anywhere — the same leak, one keyword over.
      ExportNamedDeclaration(node) {
        if (node.source === null || node.source.value !== PLATFORM_MODULE) return;
        if (node.exportKind === "type") return;

        for (const specifier of node.specifiers) {
          if (specifier.exportKind === "type") continue;
          const source = exportedName(specifier.local);
          // `export { default as RN }` republishes the module OBJECT, which is the segment above
          // every primitive — `RN.View` on the importer's side, and this rule never reads that
          // file's react-native imports because it has none. The same laundering as `export *`,
          // and the name table cannot see it: `default` is in no primitive set.
          if (source === "default") {
            ordered.report({ node: specifier, messageId: "platformModuleReExport" });
            continue;
          }
          if (PLATFORM_RENDERING_PRIMITIVES.has(source)) {
            ordered.report({ node: specifier, messageId: "platformPrimitive", data: sharedUi });
          }
        }
      },

      ExportAllDeclaration(node) {
        if (node.source.value !== PLATFORM_MODULE) return;
        if (node.exportKind === "type") return;
        ordered.report({ node: node.source, messageId: "platformModuleReExport" });
      },

      // This rule owns `Program:exit` outright — see lib/source-ordered-reports.ts for why a
      // spread one cannot be allowed to share the key.
      "Program:exit"() {
        ordered.flushInSourceOrder();
      },
    };
  },
});
