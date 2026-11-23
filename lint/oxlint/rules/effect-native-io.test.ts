import { describeRule } from "../lib/rule-spec.ts";
import { effectNativeIoRule } from "./effect-native-io.ts";

const ENGINE = "lib/footage/library/engine/library-store.ts";

describeRule("effect-native-io", effectNativeIoRule, {
  obvious: [
    {
      name: "reading the disk through node:fs",
      filename: ENGINE,
      code: `import { readFileSync } from "node:fs";\nexport const readItem = (path: string) => readFileSync(path, "utf8");`,
      errors: [{ messageId: "nodeIoModule" }],
    },
    {
      name: "running a process through node:child_process",
      filename: "lib/footage/transcript/engine/whisper-run.ts",
      code: `import { execFileSync } from "node:child_process";\nexport const runWhisper = (args: string[]) => execFileSync("whisper-cli", args);`,
      errors: [{ messageId: "nodeIoModule" }],
    },
  ],

  adversarial: [
    {
      name: "the promise flavour, unprefixed",
      filename: ENGINE,
      code: `import { readFile } from "fs/promises";\nexport const readItem = (path: string) => readFile(path, "utf8");`,
      errors: [{ messageId: "nodeIoModule" }],
    },
    {
      name: "a dynamic import, which no import declaration carries",
      filename: ENGINE,
      code: `export const readItem = async (path: string) => (await import("node:fs")).readFileSync(path, "utf8");`,
      errors: [{ messageId: "nodeIoModule" }],
    },
    {
      name: "a launcher re-exported by a first-party helper",
      filename: "lib/footage/library-media/engine/proxy-encode.ts",
      code: `import { spawn } from "#lib/platform/process/engine/process-run.ts";\nexport const encode = (args: string[]) => spawn("ffmpeg", args);`,
      errors: [{ messageId: "processLauncher" }],
    },
  ],

  legal: [
    {
      name: "the Effect services the message points to",
      filename: ENGINE,
      code: `import { Effect, FileSystem } from "effect";\nexport const readItem = Effect.fn("LibraryStore.readItem")(function* (path: string) {\n  const fs = yield* FileSystem.FileSystem;\n  return yield* fs.readFileString(path);\n});`,
    },
    {
      name: "a type-only import is erased",
      filename: ENGINE,
      code: `import type { Stats } from "node:fs";\nexport const isLarge = (stats: Stats) => stats.size > 1e9;`,
    },
    {
      name: "the engine of a feature not yet on Effect",
      filename: "lib/footage/capture/engine/capture-shots.ts",
      code: `import { readFileSync } from "node:fs";\nexport const readShot = (path: string) => readFileSync(path);`,
    },
    {
      name: "the feature's own spec, which builds fixtures on disk",
      filename: "lib/footage/library/engine/library-store.test.ts",
      code: `import { writeFileSync } from "node:fs";\nexport const seed = (path: string) => writeFileSync(path, "{}");`,
    },
  ],
});
