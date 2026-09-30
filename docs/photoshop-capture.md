# Capturing Photoshop's renders

The stamp renderer's constants are guesses until something paints the same brush and the studio measures the gap.
Photoshop can paint by script, so on the Mac it's that reference: `npm run photoshop` (harness/photoshop.ts) launches its own Photoshop 2026
in the background, paints probes or a pack's brushes onto 16-bit transparent sheets, saves them as lossless PNG and
quits, unattended. Its code is `lib/picture/photoshop-brushes/` (what to paint, where, and reading it back) over
`lib/platform/photoshop/engine/` (driving Photoshop, and putting its settings back).

```sh
npm run photoshop -- check                 # could a capture start now? changes nothing
npm run photoshop -- probes                # the probe set, about a minute
npm run photoshop -- references "<pack>.abr" --style watercolor --pack <pack>
npm run photoshop -- restore               # put back what a killed or stuck run changed (--force: see below)
```

## Graham's Photoshop comes back as it was

A run refuses to start if Photoshop is open (it's Graham's, with his documents) or an earlier run's snapshot was never
restored. Otherwise it copies the whole `~/Library/Preferences/Adobe Photoshop 2026 Settings/` folder (Brushes.psp,
MRUBrushes.psp, Patterns.psp, tool presets, prefs) and the `Adobe Photoshop 2026 Paths` file, with their hashes, into
`~/Library/Application Support/media-studio/photoshop-settings/<run>/`. It launches Photoshop with `open -g`, sets
`displayDialogs` to NO before anything else, closes its own documents as it finishes with them, and quits. When it
sees its Photoshop exit it records every settings file's hash (`exited.json`), then rewrites every file that changed,
with its old timestamps, removes any new ones, checks every hash and writes `restored.json`. Photoshop writes its
settings when it quits, which is why the restore comes after the quit, never before.

A restore never undoes someone else's session. A run's background Photoshop is still Photoshop: Graham once opened it
mid-run to install brushes, the run's quit hung behind him, and a blind restore of that run's snapshot later wiped his
191 MB brush install. So:

- the run quits only a Photoshop with no documents open and answering scripts; otherwise someone is using it, and the
  run leaves it running (never closed unsaved, never killed) with its snapshot pending;
- a restore puts back only files still exactly as the run's Photoshop left them (`exited.json`), and keeps, and
  lists, any a later session changed;
- a snapshot with no `exited.json` (the run never saw its Photoshop exit) is refused: `check` says so and what
  differs, and `restore --force` is for when no one has used Photoshop since that run;
- every file a restore overwrites or removes is first copied to the snapshot's `replaced-<time>/`, and it says where.

Until a pending snapshot is restored, no run starts.

Everything goes through ExtendScript (`osascript … do javascript`) and Action Manager descriptors: no UI clicks, no
accessibility permission.

## What a run writes

Sheets are 4096², cut into cells whose sizes and origins are multiples of 256, the period of the probe texture, so a
texture fixed to the canvas has the same phase in every cell and a cell compares with its repeat. Each sheet is saved
as it's painted and `manifest.json` once the last is, before Photoshop quits, so a Photoshop that hangs on quit loses
only the cleanup, never the capture. `manifest.json` holds:

- the Photoshop version, and its colour settings: RGB blend gamma off means paint mixes on gamma-encoded values, and
  dither on means 8-bit dithering (the sheets are 16-bit, so they have none);
- the document: RGB, 16 bits, 72 dpi, transparent, one layer;
- per item, the tool options read back after applying it, with any mismatch named. A probe is keyed by its name, its
  preset being `photoshopProbes()`'s, and the reference renderer scores it only while its read-back holds that
  preset; a pack brush's item carries its preset;
- every sheet's file and every cell's box, mark, ground, colour, pressure and stroke points;
- the times (total, painting, and per cell, with launch and quit counted);
- what isn't captured (`PHOTOSHOP_NOT_CAPTURED`): build-up, since a stroked path spends no time under a held pen,
  pressure varying within a stroke, and tilt and rotation.

`readPhotoshopCaptureCells(dir)` yields each cell's pixels with its manifest entry.

**Pressure.** A stroked path paints at pressure 0 unless told otherwise. A probe sets one pressure per stroke through
Brush Pose (size and opacity overridden), or simulated pressure (taper at both ends), or Fade over a number of steps.

## The probe set

`photoshopProbes()`, 344 probes and 900 cells, in a few minutes. Each is a plain round, or a sampled tip the run defines
(`studio-probe-tip`: a half-circle with a hard and a soft side, 112 px once Photoshop trims it; `studio-probe-wide`, a
bar 112 × 48), with one thing changed:

- single stamps of computed tips across hardness and diameter, an ellipse, and the sampled tip at sizes, angle,
  roundness and flips;
- a spacing × flow grid, and the opacity cap within one stroke (a self-crossing curve) and across two crossing strokes;
- neutral, coloured and black paint over clear, white, grey and black grounds;
- a texture (`studio-probe-ramp`, a 256×64 ramp) under each of the ten modes at depths 100 and 50, Texture Each Tip on
  and off, with a depth ladder, lower flow, scale and invert, and brightness and contrast;
- a dual brush under each of its eight modes, the secondary's dabs apart and overlapping;
- wet edges; pressure on size, opacity and flow; Fade on each;
- size, opacity and count jitter, scatter and noise, painted several times each since they're random by design;
- each control a stroked path can drive (vid-105): angle on pressure, fade, initial direction, tilt, stylus wheel and
  rotation; scatter, count, roundness and Texture Each Tip depth on pressure, fade and jitter, height modes included;
  and the bristle, erodible and airbrush tips the packs use;
- vid-97's inputs painted alone beside what combines them, so a combine reads pixel for pixel off two captures: a
  soft 240 px stamp alone and under each texture mode, a dual's primary and secondary alone and combined under each
  mode, and again over a primary spaced a diameter apart, so the combine reads across primary coverage 0..1, more
  hardnesses and diameters; and probes where two stages meet (texture, dual, wet edges, opacity), which
  show their order.

**Brush Pose pressure scales size and opacity both**, whatever the brush's own dynamics say: a pose at 0.5 paints
half the diameter at half the opacity. The `pressure …` probes and a pack's reference lines at 0.25 and 0.5 are read
that way. **Simulated pressure** goes by the share of the path's length: it rises straight from 0 as if to reach full at the
middle, is cut at 0.98, never quite full, so holds from 49% to 51%, and falls to 0 over the last 49%
(lib/picture/photoshop-brushes/models/photoshop-stroke-pressure.ts; run 20260930-084651 fits 0.49 at rms 0.004). It drives the brush's own pen-pressure dynamics, so a
brush with none paints it untapered, as every reference S-curve that starts a sheet shows. Count on a control keeps
1 + floor((count − 1) × its share) stamps a step, and one at the first step, so along a simulated stroke count 2 keeps
one throughout (the `count …` probes; count 4 on fade 10 keeps 1, 3, 3, 3, 2, 2, 2, 1, 1). After a posed cell of the same brush, the pose's size and opacity overrides outlast it until the brush
is applied again (the rig applies it afresh on each sheet): size and opacity follow the simulated pressure wholly,
save that a size minimum on pen pressure counts twice (the `pressure check …` probes). The sheet paints each
reference the way it was painted.

**Noise** (vid-105, `random noise`) overlays each stamp's paint a with 0.5 + (2/3)(n − 0.5), n uniform per pixel and
fresh in every stamp: widest at half coverage, none where the tip is empty or full, and averaged down where stamps pile
up (the line's soft edge keeps a tenth of a stamp's spread). Both renderers draw n from the same u32 hash
(`tipNoiseAt`), seeded by the stamp's place.

**Small tips** (vid-105, `tip computed d… sheet`). A computed tip of 7.5 px or less is drawn at its diameter rounded
up (1.5 px paints as 2). At 1 to 3 px, hardness does nothing: the stamp is a product of one profile across and one
down, dim and spread (a 1 px stamp is four pixels at a quarter), its paint summing to about its diameter. Not yet
matched: a 1 px line at half pressure is half as dark as ours, 4 px hard sits a third of a pixel smaller than the
profile, and a squashed small tip (Graphite Pencil, 32% round) is read as the round one squashed.

**Airbrush** (vid-105, `tip airbrush …`; photoshop-airbrush.ts). Pressure is the nozzle's distance: the spray is a disc
of radius D(1 − p)/2 + 1 px whatever a pose's size, landing evenly at hardness 100 and with a soft rim at 1.
Granularity 0 sprays smoothly, its flow keeping a line as dark at every pressure; granularity 100 throws 2×1 px grains
(`tip.pixels`), their count growing as the diameter^1.2 (`scatter.countGrowth`), spread over the disc
(`scatter.distribution`); past splat size 1, soft drops of random size. An unposed probe stamp reads as full pressure
to the spray, where our reference paints it at 0, so that cell misses. Not yet read: cutoff angle and streakiness
(invisible in every capture), granularity between 0 and 100, the rim at other sizes than the preset's, and an
airbrush dual. A dense grain spray is hundreds of stamps a pixel.

**Pressed tips** (vid-105). Erodible and bristle tips touch the paper as they're pressed: StampBrush's `tip.pressed`
holds a contact image beside the footprint, the pressure from which each texel lays paint, over a ramp `softness` wide
(`pressedTip`, on both renderers). A pose sizes neither; it scales their opacity. An unposed probe stamp reads as
pressed harder than our reference's 0, so those cells miss.

- *Erodible* (`tip erodible …`; photoshop-erodible.ts). The footprint is the shape's outline through a 2 px box. A
  texel of height h touches once the pen sinks the tip a + b·p/D below its top (a 0.042 of the height, b 2.1 px), so
  a big tip touches almost whole at once and a small one grows in. Unworn: Photoshop wears the tip along a stroke,
  faster at lower simulated hardness (US 10,217,253 claims that wear), and the importer doesn't simulate it, so at 48%
  the probes' lines paint wider than ours. Lino Crayon's and Pencil's custom maps paint too wide.
- *Bristle* (`tip bristle …`; photoshop-bristle.ts). The footprint is about 234 × density bristle discs, its width
  across set by the shape and a flat tip 0.13 d deep. Each bristle touches from its own contact, later toward its rim,
  away from a point's axis, a curve's middle or an angle's near side. Past about 0.7 a long, soft one lays down wider.
  The face lies across the stroke's first heading and holds it. Pack references of an unsized preset were painted at
  100 px. Not drawn: splay that builds along a stroke (Round Angle Low Stiffness), a click's radial dashes, tilt, and
  clumping, which every capture holds at 0.25.

**What the controls do** (vid-105). Angle on pen pressure turns a stamp by p × 360°, and fade turns it a whole turn
over its steps; initial direction holds the first heading. Scatter on pen pressure keeps p² of its reach (in the
deposit's diameters, as uncontrolled scatter is), and a fade shrinks it to none over its steps. Texture Each Tip depth on pressure runs the other way: full pressure paints the
minimum depth, a fade climbs from it, and jitter takes each stamp's depth down toward it at random; a canvas texture
ignores all three. A stamp's depth enters its mode's formula as the texture's depth times its share. In the height
modes depth on pressure runs with it: a stamp at pressure p cuts at depth × p, its pose's opacity still outside the
relief (`texture height d5 by pressure`, `d50`, run 20260930-082615's `height 19`; Kyle's pastel settings at every
pose); their minimum, fade and jitter are unprobed.
Tilt, stylus wheel and rotation read full on a stroked path, the same as off. A computed tip's short side is drawn in
whole pixels at the preset's diameter, and a squashed tip steps by it.

**Jitter** (vid-105, run 20260930-111705 and the `random count …` probes). Size jitter spreads a stamp's size either
way around what pressure gives it, s × (1 + j(2u − 1)), what passes the full diameter folding back under it: at full
pressure that's the uniform 1 − j·u it always read as, and at p = 0.5 a 100% jitter reaches the full diameter. Each
step is its first stamp's spacing at that jittered size. Count jitter spreads a step's count the same way, from 0 to
twice the count at 100%, unfolded. A lingering pose's opacity drops opacity jitter: posed lines paint alike copy for
copy. A texture's brightness darkens the pattern before invert, so an inverted pattern's brightness takes paint away.
A sample's diameter is its longer side and its stamp keeps its proportions, a dual's too (`tip sampled wide …`, `dual
wide …`, on a second rig sample 112 × 48). It steps by the lesser of its roundness and its narrower side's share of its
longer, in whole pixels at the preset's diameter: 64 px steps as 27, 128 px at roundness 50% as 55 (one probe; a
roundness that squashes the narrower side is unexplained). Photoshop turns each dual dab a random way whatever its
settings, which a round dual never showed; the dual cells match in mass (within 5%), not pixel for pixel. A height
relief's depth jitter and fade paint within 0.1; its minimum wouldn't take (Photoshop read 25/40 back as 40/63).

A run also paints a sample of probes (`PHOTOSHOP_REPEAT_SAMPLE`, one of each kind) twice more on sheets of their own,
at the same places, and compares them. Everything but the random scatter probe has come back identical to the bit,
so one capture of a deterministic probe is enough. `--only` and `--repeat` narrow a run; `--repeat none` skips it.

Runs land in `work/styles/<style>/brushes/photoshop-probes/<run>/`, out of git like the rest of `brushes/`.

## A pack's references

`npm run photoshop -- references` loads the `.abr` into Photoshop as the whole brush list, then paints every preset:

- one stamp at pressure 1;
- a straight stroke at pressures 0.25, 0.5 and 1;
- the S-curve Procreate draws its previews along, with simulated pressure;
- two overlapping strokes.

They're black on transparent, into `work/styles/<style>/brushes/<pack>/reference/`, which the run replaces. A brush
paints at its own size, capped at 640 px. Some presets have no size of their own (Legacy's Watercolor Wash) and take
whatever the tool had, so the run paints them at 100 px and says so. Photoshop selects a preset reliably only by name,
so a preset whose name repeats an earlier one's isn't captured; the manifest lists them. A pack takes 0.2 to 0.4 s a
cell, with the time spent on big brushes.

`studio brushes import` leaves `reference/` be, so capture before or after importing. `npm run brushes:sheet` measures
each brush of the pack that has no Procreate preview against its S-curve here (docs/private-styles.md).

## Gotchas

- Never `set` a tip through the Brsh target: Photoshop swaps any sampled tip for a soft computed round, silently. Set it
  as the Brsh object inside the whole tool options (`setBrushTip`). The read-back check catches this.
- Selecting a preset by index doesn't follow the order `presetNames` lists them in. Select by name.
- A global ExtendScript function named `colorSettings` breaks the whole script with "Error 1220: Illegal Argument, line 0".
- Selecting a preset keeps whatever it doesn't set from the one before, so each item starts from a plain round.
