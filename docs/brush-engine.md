# The brush engine

Stamp painting is split by body of knowledge: what a brush is and how it paints, what each app's brushes mean, the
styles that carry a pack into a project, and how close a painted brush comes to the app's own. Each is a feature under
`lib/picture/`, each importing only those below it:

```
brush-fidelity     → stamp-styles, photoshop-brushes, procreate-brushes, stamp-paint
stamp-reference    → stamp-styles, photoshop-brushes, stamp-paint
stamp-styles       → photoshop-brushes, procreate-brushes, stamp-paint, platform/zip
photoshop-brushes  → procreate-brushes, stamp-paint
procreate-brushes  → stamp-paint, platform/zip
stamp-paint
```

**stamp-paint** is the engine, and knows no app. `models/stamp-brush.ts` is the brush (`StampBrush`: a tip, spacing,
dynamics keyed by target and sensor, scatter, rotation, grain, dual, edges, accumulation); `stamp-placement.ts`
places its stamps along a stroke by one rule (`buildStamp`), reading dynamics through `stamp-dynamics.ts` (each
step's and stamp's context, what each sensor reads from it, each response); a new sensor or target is an entry in
`StampTargetSensors` and its signal there; `coverage-formulas.ts` and `stamp-deposit-stages.ts`
define every blend, accumulation and the order a deposit resolves in, once, for the GPU and the CPU reference alike;
`stamp-paint-recipe.ts` is the painting a scene writes, with its paper. `studio/` is the WebGPU renderer, its uniform
layout and the compositor.

**procreate-brushes** reads a Procreate brush's settings into a `StampBrush` (`procreate-brush.ts`, by the constants
of `procreate-reading.ts`), and the stroke Procreate draws its previews along. Its `engine/` reads binary plists and
`.procreate` canvases.

**photoshop-brushes** reads Photoshop's: the preset schema in Photoshop's own units (`photoshop-preset.ts`), the
`.abr` reader and descriptor codec, the normalizer (`photoshop-brush.ts`, by `photoshop-reading.ts`, which resolves every source of pressure,
the brush's, the options bar's and a lingering pose's, into the brush's dynamics by one precedence), computed round
tips, and the capture rig that has Photoshop paint probes and references (docs/photoshop-capture.md). It imports
procreate-brushes only for the S-curve its references are painted along, Procreate's preview stroke.

**stamp-styles** is a pack on disk and a style in a project: the manifest (`stamp-paint-pack.ts`), `StampPaintStyle`,
the importers, the bundle's styles and `StampPainting`. It is its own feature because a pack and its importer read
both apps' brushes; inside either app's feature, that app would import the other back.

**brush-fidelity** holds a painted brush against its target, a Procreate preview or a Photoshop reference capture
(`brush-fidelity-target.ts`): one measure (`stroke-measure.ts`), one scorer (`brush-fidelity-score.ts`) that the
sheet, the fit, the diagnostic and the guard all use, one versioned report of a sheet (`brush-fidelity-report.ts`,
naming the source, reading and scorer it was drawn under) that the fit's baselines and the guard read, and each app's
reading registered for fitting (`brush-readings.ts`). `npm run brushes:sheet`, `brushes:fit` and `brushes:diagnose` run it (docs/private-styles.md).

**stamp-reference** is the slow CPU renderer the GPU is held to, stage by stage, against Photoshop's probe captures
(`node harness/stamp-reference.ts probes <run>`). It covers coverage only: no colour, paper or blurred rims.

`lib/platform/zip/` reads the zips packs come in. `lint/policy/studio-tree.ts` declares the areas; check:arch holds
each feature to its roles and refuses a cycle between features.
