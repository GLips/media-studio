# Private painting styles

A stamp-paint style is one folder, `work/styles/<name>/`, the only place it lives. Its brushes come from a pack
someone bought, and the licence covers their copy, so a style stays in your workspace, never the studio. Any project
in `work/projects/` can paint with it, and a project can use several.

```
work/styles/<name>/
  style.ts     the style: `export default { … } satisfies StampPaintStyle` (lib/picture/stamp-styles/models/style.ts)
  <name>.md    how to paint in this style; guidance about the pack's brushes stays here, private
  fidelity.ts  a note per brush on how and why it differs from its Procreate preview
  fidelity-grades.json  each brush's score and grade (close, rough, off), written by npm run brushes:sheet
  brushes/     each pack's imported assets, in brushes/<pack>/ (studio brushes import). Not in git: each machine imports its own copy
```

`style.ts` names each pack its brushes come from, by its folder in `brushes/`, with a `source` that says where the pack
was bought; the brushes it paints with, by its own names for them, each a brush in a pack; its palette; and its paper:

```ts
import type { StampPaintStyle } from '#lib/picture/stamp-styles/models/style.ts';

export default {
  packs: { vvds: { source: 'VVDS Realistic Watercolor Studio, bought on Creative Market (E13434.zip)' } },
  brushes: { wash: { pack: 'vvds', brush: 'Wet Wash' }, blotch: { pack: 'vvds', brush: 'Blotch 03' } },
  palette: { sky: '#8fb3d9', earth: '#7a5c3e' },
  paper: { color: '#f4efe4' },
} satisfies StampPaintStyle;
```

**Using one.** A project names the styles it paints with in its `project.ts`, then imports them as `#styles/<name>/…`:

```ts
export default { capability: 'silent', styles: ['wash'] } satisfies ProjectDeclaration;
```

```tsx
import type washStyle from '#styles/wash/style.ts';
import { stampPaintStyle } from '#studio';

export const wash = stampPaintStyle<typeof washStyle>('wash');
```

`stampPaintStyle` is the style as the bundle carries it: its brushes resolved to their pack's `StampBrush`es, palette
and paper, with every image a brush or the paper uses served beside it. Before each bundle the studio writes
`generated/stamp-paint-styles.ts` (imported as `@stamp-paint-styles`) from the styles `project.ts` names; asking for
one it doesn't name throws. Paint with it in a recipe and draw it with `StampPainting` (skills/video-canvas). A style
can keep a module beside `style.ts` that paints the way its pack's author does, as `work/styles/watercolor/paint.ts`
does, so every project paints in it alike.

check:arch refuses an import of a style the project doesn't name, and public code importing any style. A style may
import the studio's `models` and `studio` code, never a project or `engine` code.

**Importing a pack.** `studio brushes import <archive> --style <name> --pack <pack>` turns a Procreate pack (a
`.brushset`, or the zip it came in) or a Photoshop pack (an `.abr` or `.tpl`, or a zip holding them) into
`brushes/<pack>/`, replacing what an earlier import wrote there and leaving the rest (`fidelity/`, `reference/`).
Both become the same brush (`StampBrush`) in the same layout:

```
brushes/<pack>/
  tips/        each brush's tip, dark is paint, downsized; <brush>.dual.png for a dual brush's second tip;
               round-<hardness>.png for Photoshop's computed round tips
  grains/      each brush's grain (a Photoshop texture's pattern), likewise
  previews/    each brush's own Procreate preview, to judge a render against (Photoshop files carry none)
  fidelity/    the brush fidelity sheet, once drawn (npm run brushes:sheet)
  reference/   Photoshop's own renders of the pack's brushes (npm run photoshop -- references, docs/photoshop-capture.md)
  papers/      each .procreate canvas in the zip, as Procreate shows it, and its tooth as <paper>.grain.png
  manifest.json  each brush's source as read (Procreate settings, or a Photoshop preset and the .abr or .tpl it
                 came from), the palettes and papers; a style reads each brush from its source when it resolves
```

A Photoshop pack reads `.abr` version 6 and later (everything since Photoshop CS) and `.tpl` tool presets, whose
tool options (a Mixer Brush's wet, load and mix, the tool's flow and mode) sit beside the brush. Names Photoshop
repeats across a file's groups get the group in brackets. Its manifest has no previews, and each preset keeps its
own size in pixels; the sheet measures its brushes against `reference/`, and paints one with no reference at its own
size, unscored. The Mixer Brush's settings are carried in the brush's `wetMix` and
noted unsupported: nothing paints wet mixing yet (vid-90). Don't import a pack whose licence limits its brushes to
Photoshop (True Grit's does). Photoshop's own sets: `Legacy Brushes.abr` and `Converted Legacy Tool Presets.abr` in
`/Applications/Adobe Photoshop 2026/Presets/Brushes/`, and `Default Brushes.abr` inside the app, in
`Adobe Photoshop 2026.app/Contents/Required/`.

The manifest holds the asset version, the files, and each brush normalized into the studio's brush definition
(`StampBrush`, lib/picture/stamp-paint/models/stamp-brush.ts), keyed by its name in the pack. It also records the
archive's hash, the previews, the zip's `.swatches` palettes, the papers (each with its mean colour), and per brush
every setting that was approximated or dropped (`support`); the import prints a line per brush of those. Copy colours
into `palette` and a paper into `paper` (`image` for its photograph, `grain` for its tooth) in style.ts.

**Judging the brushes.** `npm run brushes:sheet -- --style <name> --pack <pack>` paints each brush with the studio's GPU
renderer along the stroke Procreate drew its preview with (one stamp, for a brush Procreate previews that way), at the
diameter whose thickness matches the preview's, and sets it beside that preview. A brush without a preview (every
Photoshop brush) is measured instead against its `reference/` capture, painted as Photoshop painted it: the same
stroke at the reference's own diameter, under Photoshop's simulated pressure, through the brush's dynamics or the
overrides a Brush Pose left (lib/picture/brush-fidelity/models/brush-fidelity-target.ts). The row's left column says
which target it is. It writes a row per brush (`rows/<brush>.png`), the rows stacked at half size (`sheet.jpg`, or
`sheet-1.jpg` on past 120 brushes) and `report.json` into `brushes/<pack>/fidelity/`,
out of git because the rows hold the pack's previews. Each row and the report measure both strokes alike
(lib/picture/brush-fidelity/models/stroke-measure.ts): a coverage map in 8-pixel cells, length, thickness along
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
(lib/picture/brush-fidelity/engine/brush-fidelity-score.ts). A whole pack
drawn to its own `fidelity/` also writes each brush's score and grade into the style's `fidelity-grades.json`, which
git keeps. `--brush a,b` draws only those; `--out <dir>` writes elsewhere, to keep a sheet from before a change to the
renderer or the importer and compare.

The style's `fidelity.ts`, which git keeps, holds a note per brush on how and why it differs, which a score can't say:

```ts
import type { StampPaintStyleFidelity } from '#lib/picture/brush-fidelity/models/brush-fidelity-style.ts';

export default {
  vvds: { 'Pigment Dark Brush': 'an even dark scaly texture in Procreate, which comes from wet mixing' },
} satisfies StampPaintStyleFidelity;
```

Re-draw after changing how a brush is painted or read, and re-read the notes of any brush whose grade moved.

**Fitting the importer.** Where Procreate's meaning isn't known (how big a grain's tile is, how wide and dark a wet
rim, how far each glaze mode builds within its stroke, how flow and depth curve), the importer reads a setting by a
constant of its `ProcreateReading`, checked in as `lib/picture/procreate-brushes/models/procreate-reading.ts`.
Photoshop's pipeline was identified stage by stage from probe captures (vid-97), so its importer reads almost every
setting exactly; what's left, how far 100% scatter strays and how far 100% angle jitter turns (at least a whole turn
each way), sits in its `PhotoshopReading`, `lib/picture/photoshop-brushes/models/photoshop-reading.ts`. Each reading's
ranges, which brushes a constant touches and which are held out are in `lib/picture/brush-fidelity/models/brush-readings.ts`.

`npm run brushes:fit -- --packs watercolor/vvds` fits every constant of the packs' app at once against every targeted
training brush of the packs given (all of one app), by the sheet's summed score, with each brush that ends up further
off than it started counted again. It's deterministic, takes a few minutes, and writes the reading module; re-draw the
packs' sheets after (a brush is read from its source when a style resolves it, so nothing is imported again). The
constants are the same for every brush of every pack: a brush is never tuned alone, so what fits one pack holds for
the next. `npm run brushes:diagnose -- --packs watercolor/photoshop-legacy,…` tries each constant brush by brush and
says whether the brushes agree on a value; it writes nothing. Kyle T. Webster's packs and a fifth of every other
Photoshop pack are held out of both. A Photoshop import notes each setting a brush has at a value the probes never
covered as `unprobed`, the one place its reading is a guess.

**Same pixels.** A painting draws on the GPU through WebGPU, in half floats, and GPUs round floats differently, so
what's promised depends on where it renders:

- On one machine (one GPU, driver and Chrome) a frame looks the same however it's reached: cold, after other frames,
  or with other tabs drawing beside it. It is held to the bar every GPU scene is: `studio repeatable` checks all
  three and passes over 50 dB PSNR. A few pixels may land a level apart from one draw to the next, most often on a
  renderer's first draw, and that's rounding, not a bug; the check says "identical" when no pixel moved, but doesn't
  ask for it. A frame that depends on what its tab drew before (an unseeded stream, a stale target) falls far below
  the bar.
- Across machines, never compare pixels. The same recipe can differ by a level or two where stamps overlap, which
  reads the same but fails a byte or snapshot comparison. Judge by eye (the fidelity sheet, `--strip`).
- A video's slices render on one machine. Each render snapshot records the GPU it drew on (`gpu`: WebGL's renderer
  and WebGPU's adapter), and `studio render --join` refuses slices from more than one.

A render's browser must have a hardware WebGPU adapter as well as hardware GL, and a render fails without one
(lib/output/render/engine/render-browser.ts). WebGPU exists only in a secure context: Remotion's `http://localhost`
page is one, `about:blank` isn't. The renderer needs the adapter's `texture-formats-tier2` feature (its compute passes
read and write half-float targets in place).

**Speed.** `studio profile <project> --frames a:b` times each frame's painting on the GPU and its whole render. The
watercolor landscape (84 deposits, 1.5M stamps, 1920×1080) paints in about 67 ms a frame on an M1 Max (WebGPU on
Metal), loads in about 0.4 s, and renders in about 102 ms in one tab and 88 ms in two, so the painting dominates and
capture is the rest. Holding each frame until WebGPU has checked its draw for errors (so a broken draw fails its own
frame) is about 12 ms of that in one tab and 10 ms in two. Its cost follows the stamps'
area: a denser brush spacing or bigger stamps cost in proportion.

**Missing brushes.** Before each bundle, every style the project names is checked. It stops the bundle, listing each
problem with the pack's `source` (which says where to get it), when a pack isn't imported, a file its manifest lists is
gone, `brushes` names a brush its pack lacks, the paper names a file its pack lacks, or a manifest is from an older
asset version. Import the pack again from your copy.

**Keeping packs out of git.** `studio workspace init` ignores `styles/*/brushes/`. check:arch refuses a tracked file
under a style's `brushes/` in the workspace, and a tracked brush archive (`.brushset`, `.abr`) anywhere in the studio,
except a test fixture you made yourself and listed in `lint/structural/checks/brush-assets.ts`.
