import { describeRule } from "../lib/rule-spec.ts";
import { noNestedLayerProvideRule } from "./no-nested-layer-provide.ts";

const WIRING = "lib/footage/library/engine/library-layers.ts";
const IMPORTS = `import { Layer } from "effect";\nimport { LibraryLive, CacheLive, StoreLive, FfmpegLive } from "./library-services.ts";`;

describeRule("no-nested-layer-provide", noNestedLayerProvideRule, {
  obvious: [
    {
      name: "a provide passed straight into another provide",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = Layer.provide(LibraryLive, Layer.provide(StoreLive, FfmpegLive));`,
      errors: [{ messageId: "nestedLayerProvide" }],
    },
  ],

  adversarial: [
    {
      // The spelling Effect wiring is written in. Reading only the outer call's direct arguments
      // sees a `.pipe(…)` call there and stops, so every real nest goes unreported.
      name: "nested through a pipe rather than as a direct argument",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = LibraryLive.pipe(Layer.provide(StoreLive.pipe(Layer.provide(FfmpegLive))));`,
      errors: [{ messageId: "nestedLayerProvide" }],
    },
    {
      name: "nested inside a merge between the two provides",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = Layer.provide(\n  LibraryLive,\n  Layer.merge(CacheLive, Layer.provide(StoreLive, FfmpegLive)),\n);`,
      errors: [{ messageId: "nestedLayerProvide" }],
    },
    {
      name: "provideMerge, the same edge that also passes its dependency through",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = LibraryLive.pipe(Layer.provideMerge(StoreLive.pipe(Layer.provideMerge(FfmpegLive))));`,
      errors: [{ messageId: "nestedLayerProvide" }],
    },
  ],

  legal: [
    {
      name: "the inner layer bound to a name and passed by that name",
      filename: WIRING,
      code: `${IMPORTS}\nconst storeLayer = Layer.provide(StoreLive, FfmpegLive);\nexport const libraryLayer = Layer.provide(LibraryLive, storeLayer);`,
    },
    {
      name: "sequential provides on one pipeline are flat, not nested",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = LibraryLive.pipe(Layer.provide(StoreLive), Layer.provide(FfmpegLive));`,
    },
    {
      name: "a provide method on something that isn't the Layer module",
      filename: WIRING,
      code: `import { container } from "./container.ts";\nexport const wired = container.provide("library", container.provide("ffmpeg", {}));`,
    },
    {
      name: "a merge with no provide in it",
      filename: WIRING,
      code: `${IMPORTS}\nexport const libraryLayer = Layer.mergeAll(LibraryLive, StoreLive, FfmpegLive, CacheLive);`,
    },
  ],
});
