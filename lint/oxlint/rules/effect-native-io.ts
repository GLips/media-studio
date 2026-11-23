// ─── effect-native-io ──────────────────────────────────────────
//
// Makes sure: the engine of an Effect-native feature (EFFECT_NATIVE_FEATURES
// in studio-tree.ts) reaches files and processes only through Effect services:
// FileSystem and Path from the studio's runtime, ChildProcessSpawner, and
// StudioFfmpeg for ffmpeg. So a test swaps any of them for a layer, and every
// failure arrives typed in the error channel instead of thrown from Node.
//
// It reports an import of `node:fs`, `node:fs/promises` or
// `node:child_process` in any spelling, and a process launcher (`spawn`,
// `execFileSync`, …) imported by name from any module.
//
// NEGATIVE SPACE: a type-only import is erased and silent. Specs and the
// feature's models and studio code aren't read: a model has no I/O at all,
// which model-purity holds.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { isTypeOnlyDeclaration, visitModuleSources, type ModuleSourceNode } from "../lib/module-source-visitor.ts";
import { exportedName } from "../lib/imported-names.ts";
import { effectNativeRole } from "../../policy/studio-tree.ts";

const NODE_IO_MODULES = new Set(["fs", "fs/promises", "child_process"]);
const PROCESS_LAUNCHERS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);

const isNodeIoModule = (specifier: string) => NODE_IO_MODULES.has(specifier.replace(/^node:/, ""));

export const effectNativeIoRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      nodeIoModule:
        "{{specifier}} reaches the disk or a process around Effect, so its failures throw instead of arriving typed and no test can swap it. Use FileSystem, Path or ChildProcessSpawner from the studio's runtime, or StudioFfmpeg for ffmpeg.",
      processLauncher:
        "{{name}} starts a process around Effect, so its failure throws instead of arriving typed and no test can swap it. Spawn through ChildProcessSpawner, or StudioFfmpeg for ffmpeg.",
    },
  },
  create(context, file) {
    if (effectNativeRole(file.position) !== "engine") return {};

    const reportNodeIo = (source: ModuleSourceNode, specifier: string) => {
      if (!isNodeIoModule(specifier) || isTypeOnlyDeclaration(source.parent)) return;
      context.report({ node: source, messageId: "nodeIoModule", data: { specifier } });
    };
    return {
      ...visitModuleSources(reportNodeIo),
      // Replaces the spread's ImportDeclaration arm, so it answers for the module and for its names.
      ImportDeclaration(node) {
        reportNodeIo(node.source, node.source.value);
        // From node's own modules the import has already reported: one edit, one finding.
        if (node.importKind === "type" || isNodeIoModule(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const name = exportedName(specifier.imported);
          if (PROCESS_LAUNCHERS.has(name)) context.report({ node: specifier, messageId: "processLauncher", data: { name } });
        }
      },
    };
  },
});
