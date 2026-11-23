// ─── effect-native-io ──────────────────────────────────────────
//
// Makes sure: the engine of an Effect-native feature (EFFECT_NATIVE_FEATURES
// in studio-tree.ts), and its CLI verbs, reach files, processes and the
// network only through Effect services (FileSystem, Path, ChildProcessSpawner,
// StudioFfmpeg), so a test swaps any of them for a layer and every failure
// arrives typed instead of thrown from Node.
//
// It reports Node's disk, process, network, stream and thread modules in any
// spelling; a process launcher (`spawn`, `execFileSync`, …) imported by name
// from any module; and the promise-world ffmpeg owner.
//
// NEGATIVE SPACE: a type-only import is erased and silent. Specs, models and
// studio code aren't read: a model has no I/O, which model-purity holds.
// ──────────────────────────────────────────────────────────────────────

import { defineSourceRule } from "../lib/rule-file.ts";
import { isTypeOnlyDeclaration, visitModuleSources, type ModuleSourceNode } from "../lib/module-source-visitor.ts";
import { exportedName } from "../lib/imported-names.ts";
import { effectNativePlace } from "../../policy/studio-tree.ts";

const NODE_IO_MODULES = new Set([
  "fs", "fs/promises", "child_process",
  "http", "https", "http2", "net", "dgram", "readline", "readline/promises", "stream", "stream/promises", "worker_threads",
]);
const PROCESS_LAUNCHERS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
/** Its exports spawn ffmpeg as a raw ChildProcess and hand back promises; StudioFfmpeg does the same work as a service. */
const PROMISE_FFMPEG_OWNER = "#lib/platform/ffmpeg/engine/ffmpeg.ts";

const isNodeIoModule = (specifier: string) => NODE_IO_MODULES.has(specifier.replace(/^node:/, ""));
const isReportedModule = (specifier: string) => isNodeIoModule(specifier) || specifier === PROMISE_FFMPEG_OWNER;

export const effectNativeIoRule = defineSourceRule({
  meta: {
    type: "problem",
    messages: {
      nodeIoModule:
        "{{specifier}} reaches the disk, a process or the network around Effect, so its failures throw instead of arriving typed and no test can swap it. Use FileSystem, Path or ChildProcessSpawner from the studio's runtime, StudioFfmpeg for ffmpeg, and Effect's Stream for a stream.",
      processLauncher:
        "{{name}} starts a process around Effect, so its failure throws instead of arriving typed and no test can swap it. Spawn through ChildProcessSpawner, or StudioFfmpeg for ffmpeg.",
      promiseFfmpeg:
        "ffmpeg.ts runs ffmpeg as a raw ChildProcess behind promises, so its failures arrive untyped and no test can swap it. Yield StudioFfmpeg (#lib/platform/ffmpeg/engine/studio-ffmpeg.ts) instead.",
    },
  },
  create(context, file) {
    const place = effectNativePlace(file.path, file.position);
    if (place !== "engine" && place !== "verb") return {};

    const reportModule = (source: ModuleSourceNode, specifier: string) => {
      if (isTypeOnlyDeclaration(source.parent)) return;
      if (isNodeIoModule(specifier)) context.report({ node: source, messageId: "nodeIoModule", data: { specifier } });
      else if (specifier === PROMISE_FFMPEG_OWNER) context.report({ node: source, messageId: "promiseFfmpeg" });
    };
    return {
      ...visitModuleSources(reportModule),
      // Replaces the spread's ImportDeclaration arm, so it answers for the module and for its names.
      ImportDeclaration(node) {
        reportModule(node.source, node.source.value);
        // From a module already reported: one edit, one finding.
        if (node.importKind === "type" || isReportedModule(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const name = exportedName(specifier.imported);
          if (PROCESS_LAUNCHERS.has(name)) context.report({ node: specifier, messageId: "processLauncher", data: { name } });
        }
      },
    };
  },
});
