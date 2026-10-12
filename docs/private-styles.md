# Private styles: importing, measuring and fitting brush packs

A private style (`work/styles/<name>/`) is a bought brush pack with its palette and paper; the video-canvas skill
teaches finding, writing and painting with one. This doc is the machinery under it: how a pack is imported, how each
brush is measured and judged against its app, and how the importers are fitted.

**Importing a pack.** `studio brushes import <archive> --style <name> --pack <pack>` turns a Procreate pack (a
`.brushset`, or the zip it came in) or a Photoshop pack (an `.abr` or `.tpl`, or a zip holding them) into
`brushes/<pack>/`. Each import writes a whole generation, then switches `current` to name it by one rename, so a
reader sees the previous import or the new one, never a mix, and an import that fails leaves the previous one as it
was; older generations are deleted after the switch. `profiles/`, `fidelity/` and `reference/` sit beside the
generations and outlive them. Everything that reads a pack's files resolves `current` once
(`readStampPaintPackGeneration`). Both apps become the same brush (`StampBrush`) in the same layout:

```
brushes/<pack>/
  current      the name of the generation readers use, switched by rename; .<pack>.lock beside the pack holds
               one import at a time, a second waiting its turn
  profiles/    each brush's measured profile, a file a brush and key: <brush>-<address>.json
  fidelity/    the brush fidelity sheet, once drawn (npm run brushes:sheet)
  reference/   Photoshop's own renders of the pack's brushes (npm run photoshop -- references, docs/photoshop-capture.md)
  generations/<id>/  what one import wrote:
    tips/        each brush's tip, dark is paint, downsized; <brush>.dual.png for a dual brush's second tip;
                 round-<hardness>.png for Photoshop's computed round tips
    grains/      each brush's grain (a Photoshop texture's pattern), likewise
    previews/    each brush's own Procreate preview, to judge a render against (Photoshop files carry none)
    papers/      each .procreate canvas in the zip, as Procreate shows it, and its tooth as <paper>.grain.png
    manifest.json  each brush's source as read (Procreate settings, or a Photoshop preset and the .abr or .tpl it
                   came from), the palettes and papers; a style reads each brush from its source when it resolves
```

A Photoshop pack reads `.abr` version 6 and later (everything since Photoshop CS) and `.tpl` tool presets, whose
tool options (a Mixer Brush's wet, load and mix, the tool's flow and mode) sit beside the brush. Names Photoshop
repeats across a file's groups get the group in brackets. Its manifest has no previews, and each preset keeps its
own size in pixels; the sheet measures its brushes against `reference/`, and paints one with no reference at its own
size, unscored. The Mixer Brush's settings stay in the preset's tool options and are noted unsupported: nothing
paints wet mixing yet (vid-90). Photoshop's own sets: `Legacy Brushes.abr` and `Converted Legacy Tool Presets.abr` in
`/Applications/Adobe Photoshop 2026/Presets/Brushes/`, and `Default Brushes.abr` inside the app, in
`Adobe Photoshop 2026.app/Contents/Required/`.

The manifest holds the asset version, the files, and each brush normalized into `StampBrush`
(`lib/paint/brush/models/stamp-brush.ts`; `brush-engine.md` says where each part of the engine lives), keyed by its
name in the pack. It also records the archive's hash, the previews, the zip's `.swatches` palettes, the papers (each
with its mean colour), and per brush every setting that was approximated or dropped (`support`); the import prints a
line per brush of those.

**Profiles.** Every import measures each brush's profile before it publishes: it paints probe strokes with the
production renderer in the render browser and reads, by trace, how far past its diameter each side's paint visibly
reaches (by heading where they differ), and how a raster pass builds up, at diameters from its smallest to 128 px.
Each is stored in `profiles/` as a file of its own, addressed by the brush's name and its key: the probe protocol, a
hash of its settings, of its images' bytes, and of its style's paper and paint as probed
(`lib/paint/brush-packs/engine/stamp-brush-profile-store.ts`). A profile says what was measured, or why the brush was
refused. A reader computes each brush's key as it is now and reads the file at it, so a profile measured under any
other key is never read, and a style whose paper or paint changes finds none until they're measured again. A brush
resolved from the pack carries its profile; code that needs one refuses a brush without, naming the command that
measures it. `studio brushes import --style <name> --pack <pack>`, with no archive, measures each brush whose key
has no file and adds it, leaving the pack's generation and manifest as they are. It stores each as it's measured, so
one stopped part-way keeps what it measured. An import into a pack another import holds waits its turn, then
measures only what that one left. Nothing deletes a profile; one no brush's key reaches is a few kilobytes left
behind.

**Judging the brushes.** `npm run brushes:sheet -- --style <name> --pack <pack>` paints each brush with the studio's GPU
renderer along the stroke Procreate drew its preview with (one stamp, for a brush Procreate previews that way), at the
diameter whose thickness matches the preview's, and sets it beside that preview. A brush without a preview (every
Photoshop brush) is measured instead against its `reference/` capture, painted as Photoshop painted it: the same
stroke at the reference's own diameter, under Photoshop's simulated pressure, through the brush's dynamics or the
overrides a Brush Pose left (`lib/paint/brush-fidelity/models/brush-fidelity-target.ts`). The row's left column says
which target it is. It writes a row per brush (`rows/<brush>.png`), the rows stacked at half size (`sheet.jpg`, or
`sheet-1.jpg` on past 120 brushes) and `report.json` into `brushes/<pack>/fidelity/`, out of git because the rows
hold the pack's previews. Each row and the report measure both strokes alike
(`lib/paint/brush-fidelity/models/stroke-measure.ts`): a coverage map in 8-pixel cells, length, thickness along
the stroke, where each end reaches 80% of its peak, density, how dark the rim is against the body, grain size, edge
width (pixels from a fifth to four fifths of its density), mottle in the body (fine and coarse), and fill (a hollow
line against a solid one). Their gaps weigh into one score per brush, 0 for a perfect match, and the score grades it:

| grade   | score        | reads as                                        |
| ------- | ------------ | ----------------------------------------------- |
| `close` | 0.2 or less  | its preview, at a glance                        |
| `rough` | up to 0.45   | the brush, plainly different in some way        |
| `off`   | above 0.45   | not the brush: shape, density or texture wrong  |

A gap anyone would call plain adds about 0.1 (`STROKE_SCORE_WEIGHTS` says how much each measure counts), and a brush
that paints nothing against its target scores 2. The sheet, the fit and the diagnostic all score a brush this one way
(`lib/paint/brush-fidelity/engine/brush-fidelity-score.ts`). A whole pack drawn to its own `fidelity/` also writes
each brush's score and grade into the style's `fidelity-grades.json`, which git keeps. `--brush a,b` draws only
those; `--out <dir>` writes elsewhere, to keep a sheet from before a change to the renderer or the importer and
compare.

The style's `fidelity.ts`, which git keeps, holds a note per brush on how and why it differs, which a score can't say:

```ts
import type { StampPaintStyleFidelity } from '#lib/paint/brush-fidelity/models/brush-fidelity-style.ts';

export default {
  vvds: { 'Pigment Dark Brush': 'an even dark scaly texture in Procreate, which comes from wet mixing' },
} satisfies StampPaintStyleFidelity;
```

Re-draw after changing how a brush is painted or read, and re-read the notes of any brush whose grade moved.

**Fitting the importer.** Where Procreate's meaning isn't known (how big a grain's tile is, how wide and dark a wet
rim, how far each glaze mode builds within its stroke, how flow and depth curve), the importer reads a setting by a
constant of its `ProcreateReading`, checked in as `lib/paint/procreate-brushes/models/procreate-reading.ts`.
Photoshop's pipeline is identified stage by stage from probe captures (`photoshop-capture.md`), so its importer reads
almost every setting exactly; what's left, how far 100% scatter strays and how far 100% angle jitter turns (at least
a whole turn each way), sits in its `PhotoshopReading`, `lib/paint/photoshop-brushes/models/photoshop-reading.ts`.
Each reading's ranges, which brushes a constant touches and which are held out are in
`lib/paint/brush-fidelity/models/brush-readings.ts`.

`npm run brushes:fit -- --packs watercolor/vvds` fits every constant of the packs' app at once against every targeted
training brush of the packs given (all of one app), by the sheet's summed score, with each brush that ends up further
off than its last sheet showed counted again. It needs each pack's whole sheet drawn under today's source, reading and
scorer, which `report.json` records, and refuses one that isn't, saying which sheet to draw again. It's
deterministic, takes a few minutes, and writes the reading module; re-draw the packs' sheets after (a brush is read
from its source when a style resolves it, so nothing is imported again). The constants are the same for every brush
of every pack: a brush is never tuned alone, so what fits one pack holds for the next. `npm run brushes:diagnose --
--packs watercolor/photoshop-legacy,…` tries each constant brush by brush and says whether the brushes agree on a
value; it writes nothing. Kyle T. Webster's packs and a fifth of every other Photoshop pack are held out of both. A
Photoshop import notes each setting a brush has at a value the probes never covered as `unprobed`, the one place its
reading is a guess.

**Same pixels.** A painting draws on the GPU through WebGPU, in half floats, and GPUs round floats differently, so
what's promised depends on where it renders:

- On one machine (one GPU, driver and Chrome) a frame looks the same however it's reached: cold, after other frames,
  or with other tabs drawing beside it. It is held to the bar every GPU scene is: `studio repeatable` checks all
  three and passes over 50 dB PSNR. A few pixels may land a level apart from one draw to the next, most often on a
  renderer's first draw, and that's rounding; the check says "identical" when no pixel moved, but doesn't ask for
  it. A frame that depends on what its tab drew before (an unseeded stream, a stale target) falls far below the bar.
- Across machines, judge by eye (the fidelity sheet, `--strip`): the same painting can differ by a level or two where
  stamps overlap, which reads the same but fails a byte or snapshot comparison.
- Each render snapshot records the GPU it drew on (`gpu`: WebGL's renderer and WebGPU's adapter). A remote render's
  pieces may come from several, joined with every GPU named; the difference is too small to see where they meet.

A render's browser must have a hardware WebGPU adapter as well as hardware GL, and a render fails without one
(`lib/platform/browser/engine/render-browser.ts`). WebGPU exists only in a secure context: Remotion's
`http://localhost` page is one, `about:blank` isn't. The renderer needs the adapter's `texture-formats-tier2` feature
(its compute passes read and write half-float targets in place).

**Speed.** `studio profile <project> --frames a:b` times each frame's painting as traced and its whole render. In a
painted frame the painting dominates and capture is the rest, and the painting's cost follows the stamps' area: a
denser brush spacing or bigger stamps cost in proportion. Holding each frame until WebGPU has checked its draw for
errors, so a broken draw fails its own frame, is a fixed part of every frame.

**Keeping packs out of git.** `studio workspace init` ignores `styles/*/brushes`. check:arch refuses a tracked file
under a style's `brushes/` in the workspace, and a tracked brush archive (`.brushset`, `.abr`) anywhere in the studio,
except a test fixture you made yourself and listed in `lint/structural/checks/brush-assets.ts`.
