// ─── vendor-component-containment ───────────────────────────────
//
// Makes sure: every use of a wrapped @mantine/core component goes through the
// app's wrapper in web/src/shared/ui/, by import, named re-export or star
// re-export, so swapping the library or adding a convention touches the
// wrapper alone.
//
// A wrapper with no WRAPPED_COMPONENTS row isn't enforced: write the row with
// the wrapper. Its `why` is the diagnostic text. Don't add a second exempt file
// to a row; a call site needing the original names a prop the wrapper lacks.
// NEGATIVE SPACE: one exact specifier, so a subpath (`@mantine/core/Textarea`)
// passes.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { type ESTree } from "@oxlint/plugins";
import { isPrimitiveModule, isStyleSubject, SHARED_UI_SPECIFIER } from "../lib/web-design-system.ts";
import { exportedName, visitImportedNames } from "../lib/imported-names.ts";
import { sourceOrderedReports } from "../lib/source-ordered-reports.ts";

const VENDOR_MODULE = "@mantine/core";

/** The wrapper module for each contained component, in the primitives layer (web/src/shared/ui/). */
const WRAPPED_COMPONENTS: Record<string, { wrapperModule: string; why: string }> = {
  TextInput: {
    wrapperModule: "text-input",
    why: "The shared input suppresses password-manager autofill by default and permits explicit autocomplete tokens for fields that need them.",
  },
  Textarea: {
    wrapperModule: "textarea",
    why: "The app wrapper carries the convention every compose box shares (Enter submits, Shift+Enter inserts a newline, via onEnter); importing the library component directly reintroduces a field that hand-rolls or omits it.",
  },
};

export const vendorComponentContainmentRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      unwrappedVendorComponent:
        "Import {{component}} from {{wrapper}}, not {{vendor}}. {{why}} Only the wrapper itself may import the original. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
      vendorStarReExport:
        "A star re-export of {{vendor}} republishes every wrapped component under this module's name, so an importer reaches the unwrapped original without ever naming the library. Re-export the specific components you mean instead. See web/src/shared/ui/ (theme.stylex.ts holds the tokens).",
    },
  },
  create(context, file) {
    if (!isStyleSubject(file)) return {};

    // The import arm only finds its names once the whole file is walked, so without a single
    // ordering owner every one of them lands after every re-export diagnostic, whatever the lines.
    const ordered = sourceOrderedReports(context);

    const reportIfWrapped = (node: ESTree.Node, component: string) => {
      const wrapped = WRAPPED_COMPONENTS[component];
      if (wrapped === undefined) return;
      // The wrapper module MUST import the original — it is the one file that may.
      if (isPrimitiveModule(file, wrapped.wrapperModule)) return;
      ordered.report({
        node,
        messageId: "unwrappedVendorComponent",
        data: {
          component,
          wrapper: `${SHARED_UI_SPECIFIER}${wrapped.wrapperModule}.tsx`,
          why: wrapped.why,
          vendor: VENDOR_MODULE,
        },
      });
    };

    return {
      // The library's name for the component, not the local one, so `Textarea as MantineTextarea`
      // cannot dodge the check. The table is keyed on exact names, so `TextareaProps` and
      // `TextareaAutosize` are different components rather than prefix matches.
      ...visitImportedNames(context.sourceCode, [VENDOR_MODULE], (component, node) => {
        reportIfWrapped(node, component);
      }),

      // `export { Textarea } from "@mantine/core"` hands the unwrapped component to every importer
      // of this module without the word `import` appearing anywhere — the same bypass, one
      // keyword over.
      ExportNamedDeclaration(node) {
        if (node.source === null || node.source.value !== VENDOR_MODULE) return;
        if (node.exportKind === "type") return;

        for (const specifier of node.specifiers) {
          if (specifier.exportKind === "type") continue;
          reportIfWrapped(specifier, exportedName(specifier.local));
        }
      },

      ExportAllDeclaration(node) {
        if (node.source.value !== VENDOR_MODULE) return;
        if (node.exportKind === "type") return;
        // A star re-export names no specifier to blame, and republishes every wrapped component
        // at once — including ones added to the table later.
        ordered.report({
          node: node.source,
          messageId: "vendorStarReExport",
          data: { vendor: VENDOR_MODULE },
        });
      },

      // This rule owns `Program:exit` outright — see lib/source-ordered-reports.ts for why a
      // spread one cannot be allowed to share the key.
      "Program:exit"() {
        ordered.flushInSourceOrder();
      },
    };
  },
});
