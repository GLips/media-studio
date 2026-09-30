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

`photoshopProbes()`, 373 probes and 1023 cells, in a few minutes. Each is a plain round, or a sampled tip the run defines
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
that way. **Simulated pressure** goes by the share of the path's length: it rises straight from 0 to full at the
middle and falls to 0 at the end, but is read at 51 even pieces of each anchor-to-anchor segment, straight between
(lib/picture/photoshop-brushes/models/photoshop-stroke-pressure.ts). So a two-anchor line peaks at 50/51, 0.98, held
from 49% to 51% (run 20260930-084651 fits the ramp at rms 0.004), while the S-curve, 115 anchors 7 px apart, all but
reaches full: its paint peaks at 0.996–0.998 where a line's holds at 0.98 (`pressure size`), and colour burn over it,
which a pose at 0.98 leaves at 0.27 where no dual lands, is 0.87 there (`dual colorBurn tiny posed`, rms 0.54 → 0.07).
The piece count is fitted from the line's peak alone. It drives the brush's own pen-pressure dynamics, so a
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
- *Bristle* (`tip bristle …`; photoshop-bristle.ts). The footprint is 100 × density × (1 + 5 × density) bristle
  discs, its width across set by the shape, a flat tip's bristles in about a line. A bristle's mark is fixed in pixels
  (vid-113: about 2 px wide at both 13 and 100 px, `… streaks d13`/`d100`): its radius is 1.15 px plus 0.28 ×
  thickness diameters, and only where the bristles sit scales with the diameter. So the tip is data
  (StampBristleTip), drawn by both renderers at the diameter each deposit paints at; the pack holds no image of it.
  Each bristle touches from its own contact, later toward its rim, away from a point's axis, a curve's middle or an
  angle's near side; a long, soft one lays down wider near full pressure. The face lies across the stroke's first
  heading and holds it. Pack references of an unsized preset were painted at 100 px. Not drawn: splay that builds
  along a stroke (Round Angle Low Stiffness), a click's radial dashes, tilt, and clumping, which every capture holds
  at 0.25.

**What the controls do** (vid-105). Angle on pen pressure turns a stamp by p × 360°, and fade turns it a whole turn
over its steps; initial direction holds the first heading. A stamp strays in its own diameters, after pressure, a
pose and size jitter (vid-113: Kyle's size-jittered salts and washes spread as wide as that on their reference lines,
10–25% narrower than in the deposit's), and scatter on pen pressure keeps p of that reach, so under a pose it keeps
p² of the deposit's diameter, as the `scatter by pressure` probes read; a fade shrinks it to none over its steps.
Where size doesn't follow pressure it keeps p (`scatter by pressure unposed`, run 20260930-134958: its line's reach
at each pressure matches ours at p, twice p²'s at half pressure). With 100% size jitter a stamp strays at most about
three quarters of its own jittered width at 200%, a 10 px stamp 6 px, a 50 px one 35 (`random scatter 200 size jitter
100`), where the tip's diameter would let every stamp reach 48; and a dual's reach holds at 200%, one dual diameter
(`random dual scatter 200`: its paint's profile across the line spans ±24 px, 16 of reach and the dot's radius, and
its mass is ours within 1%). Texture Each Tip depth on pressure runs the other way: full pressure paints the
minimum depth, a fade climbs from it, and jitter takes each stamp's depth down toward it at random; a canvas texture
ignores all three. A stamp's depth enters its mode's formula as the texture's depth times its share. In the height
modes depth on pressure runs with it: a stamp at pressure p cuts at depth × p, its pose's opacity still outside the
relief (`texture height d5 by pressure`, `d50`, run 20260930-082615's `height 19`; Kyle's pastel settings at every
pose). The relief never lifts paint past the pose's opacity: a pose at 0.98 peaks at 0.9800 and 0.9 at 0.9000
(`texture height each tip posed`). Its minimum floors depth on pressure as read (`d6.27 … min 31.37`, read back as 6
and 31: masses 0.85–0.96 of Photoshop's, 0.21–0.73 without the minimum), a fade takes it down step by step (within
3% in mass), and jitter takes each stamp's depth down, never up: at depth 10 every one of 12 stamps paints under
depth 10's paint at its place, on average 0.28 of it, where uniform depth gives about 0.39 (`d10 jitter 100`, whose
rms of 0.25 is the draws).
Tilt, stylus wheel and rotation paint as off on a stroked path, Texture Each Tip depth on tilt included (`texture
depth by tilt minimum 50`, run 20260930-134958). A Brush Pose, and a stroke it lingers into, gives tilt a value: the
upright pen's, read as full tilt. That is as off for size, flow, angle, scatter and a height relief's depth, but
Texture Each Tip depth outside the height modes paints at its minimum (`… posed`, run 20260930-142634; Kyle's G Dry
Out and G Roundup references). A computed tip's short side is drawn in
whole pixels at the preset's diameter, and a squashed tip steps by it.

**Jitter** (vid-105, run 20260930-111705 and the `random count …` probes). Size jitter spreads a stamp's size either
way around what pressure gives it, s × (1 + j(2u − 1)), what passes the full diameter folding back under it: at full
pressure that's the uniform 1 − j·u it always read as, and at p = 0.5 a 100% jitter reaches the full diameter. Each
step is its first stamp's spacing at that jittered size. Count jitter spreads a step's count the same way, from 0 to
twice the count at 100%, unfolded, rounded (the ends half as likely), and its first step lays one stamp, as a
controlled count's does (every copy of the `random count …` probes). Those probes lay 0.93–1.01 of that rule's
expected paint, within the spread of 68 steps; a single seed of ours read 1.16 by chance. Beside a control, jitter
spreads the controlled count (count 1 at full pressure lays 0, 1, 2 at ¼, ½, ¼; count 2 lays 0 to 4) and empties a
further share of the steps, about 0.15 at half pressure and 0.45 at a quarter at 100%, count 1 and count 2 alike,
since both control to one stamp there (`random count 1 by pressure jitter 100`, `random count 2 …`, run
20260930-134958: over 952 steps; a count with no jitter never empties one). At 50% it empties none: `random count 1
by pressure jitter 50` (run 20260930-142634) lays exactly one stamp on all 476 steps at every pose, where j(1 − p)³
would empty 10 and 57 of them. So the share is read as (2j − 1)(1 − p)³, emptying only past 50%, where a jittered
count can round to none; between 50% and 100% its shape is unprobed. Roundness jitter over a minimum is scaled into it: 40% jitter over a 60% minimum keeps every stamp at
0.84 or rounder (`random roundness jitter 40 minimum 60`, the least of 36 stamps 0.84), not 0.6.
A lingering pose's opacity drops opacity jitter, whether opacity's own control is off or pen pressure (`random
opacity jitter 60 by pressure posed`): posed lines paint alike copy for copy. A texture's brightness darkens the pattern before invert, so an inverted pattern's brightness takes paint away.
A sample's diameter is its longer side and its stamp keeps its proportions, a dual's too (`tip sampled wide …`, `dual
wide …`, on a second rig sample 112 × 48). It steps by its narrower side's share of its longer, its roundness left out, in
whole pixels at the preset's diameter: 64 px steps as 27, 128 px at roundness 50% as 55, a square sample at roundness
50% and spacing 200% every 256 px, the wide one at roundness 25% every ~110, a square dual at 64 px and roundness 50%
every 128 (run 20260930-134958). Tall samples step by their narrow side as wide ones do. Photoshop turns each dual dab a random way whatever its
settings, which a round dual never showed, spread evenly all the way round (`dual wide sparse`: 32 dabs, one
chirality); its flip mirrors about half of them at random (`… flip`: 14 of 33), not all. Its scatter strays across the
stroke up to half its own diameter, a wide sample's longer side (±32 px at 64 px) and a dual bigger than the brush past
the brush's half (`dual wide scatter across`, `dual big scatter across`). The dual cells match in mass (within 1%), not
pixel for pixel. A 3 px sampled dab paints the same mass as ours over twice the pixels, softer (`dual sampled tiny
apart`, unmatched). A height relief's minimum wouldn't take at first (Photoshop read 25/40 back as 40/63).

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
- A height-mode texture set by script with a minimum depth over about 30 doesn't take: 25/40 read back as 40/63 and
  10/50 as 50/20, while 6/31 held. The same settings loaded from an .abr hold (every pack preset's read-back matches
  its file), so it's the scripting, not the importer's reading. The read-back check names it.
