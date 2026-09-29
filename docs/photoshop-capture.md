# Capturing Photoshop's renders

The stamp renderer's constants are guesses until something paints the same brush and the studio measures the gap.
Photoshop can paint by script, so on the Mac it's that reference: `studio photoshop` launches its own Photoshop 2026
in the background, paints probes or a pack's brushes onto 16-bit transparent sheets, saves them as lossless PNG and
quits, unattended. Its code is `lib/picture/photoshop-capture/` (what to paint, where, and reading it back) over
`lib/platform/photoshop/engine/` (driving Photoshop, and putting its settings back).

```sh
studio photoshop check                     # could a capture start now? changes nothing
studio photoshop probes                    # the probe set, about a minute
studio photoshop references "<pack>.abr" --style watercolor --pack <pack>
studio photoshop restore                   # put settings back after a run that was killed
```

## Graham's Photoshop comes back as it was

A run refuses to start if Photoshop is open (it's Graham's, with his documents) or an earlier run's snapshot was never
restored. Otherwise it copies the whole `~/Library/Preferences/Adobe Photoshop 2026 Settings/` folder (Brushes.psp,
MRUBrushes.psp, Patterns.psp, tool presets, prefs) and the `Adobe Photoshop 2026 Paths` file, with their hashes, into
`~/Library/Application Support/media-studio/photoshop-settings/<run>/`. It launches Photoshop with `open -g`, sets
`displayDialogs` to NO before anything else, closes its own documents unsaved, and quits. Then it rewrites every file
that changed, with its old timestamps, removes any new ones, checks every hash and writes `restored.json`. Photoshop
writes its settings when it quits, which is why the restore comes after the quit, never before. A run that's killed
leaves its snapshot pending: `studio photoshop restore` puts it back, and until then no run starts.

Everything goes through ExtendScript (`osascript … do javascript`) and Action Manager descriptors: no UI clicks, no
accessibility permission.

## What a run writes

Sheets are 4096², cut into cells whose sizes and origins are multiples of 256, the period of the probe texture, so a
texture fixed to the canvas has the same phase in every cell and a cell compares with its repeat. `manifest.json`
holds:

- the Photoshop version, and its colour settings: RGB blend gamma off means paint mixes on gamma-encoded values, and
  dither on means 8-bit dithering (the sheets are 16-bit, so they have none);
- the document: RGB, 16 bits, 72 dpi, transparent, one layer;
- per item, the settings asked for and the tool options read back after applying them, with any mismatch named;
- every sheet's file and every cell's box, mark, ground, colour, pressure and stroke points;
- the times (total, painting, and per cell, with launch and quit counted);
- what isn't captured (`PHOTOSHOP_NOT_CAPTURED`): build-up, since a stroked path spends no time under a held pen,
  pressure varying within a stroke, and tilt and rotation.

`readPhotoshopCaptureCells(dir)` yields each cell's pixels with its manifest entry.

**Pressure.** A stroked path paints at pressure 0 unless told otherwise. A probe sets one pressure per stroke through
Brush Pose (size and opacity overridden), or simulated pressure (taper at both ends), or Fade over a number of steps.

## The probe set

`photoshopProbes()`, 129 probes, 335 cells in about 60 s. Each is a plain round, or a sampled tip the run defines
(`studio-probe-tip`: a half-circle with a hard and a soft side, 112 px once Photoshop trims it), with one thing changed:

- single stamps of computed tips across hardness and diameter, an ellipse, and the sampled tip at sizes, angle,
  roundness and flips;
- a spacing × flow grid, and the opacity cap within one stroke (a self-crossing curve) and across two crossing strokes;
- neutral, coloured and black paint over clear, white, grey and black grounds;
- a texture (`studio-probe-ramp`, a 256×64 ramp) under each of the ten modes at depths 100 and 50, Texture Each Tip on
  and off, with a depth ladder, lower flow, scale and invert, and brightness and contrast;
- a dual brush under each of its eight modes, the secondary's dabs apart and overlapping;
- wet edges; pressure on size, opacity and flow; Fade on each;
- size jitter, scatter and noise, painted several times each since they're random by design.

A run also paints a sample of probes (`PHOTOSHOP_REPEAT_SAMPLE`, one of each kind) twice more on sheets of their own,
at the same places, and compares them. Everything but the random scatter probe has come back identical to the bit,
so one capture of a deterministic probe is enough. `--only` and `--repeat` narrow a run; `--repeat none` skips it.

Runs land in `work/styles/<style>/brushes/photoshop-probes/<run>/`, out of git like the rest of `brushes/`.

## A pack's references

`studio photoshop references` loads the `.abr` into Photoshop as the whole brush list, then paints every preset:

- one stamp at pressure 1;
- a straight stroke at pressures 0.25, 0.5 and 1;
- the S-curve Procreate draws its previews along, with simulated pressure;
- two overlapping strokes.

They're black on transparent, into `work/styles/<style>/brushes/<pack>/reference/`, which the run replaces. A brush
paints at its own size, capped at 640 px. Some presets have no size of their own (Legacy's Watercolor Wash) and take
whatever the tool had, so the run paints them at 100 px and says so. Photoshop selects a preset reliably only by name,
so a preset whose name repeats an earlier one's isn't captured; the manifest lists them. A pack takes 0.2 to 0.4 s a
cell, with the time spent on big brushes.

`studio brushes import` replaces the pack's whole folder, `reference/` with it: capture after importing.

## Gotchas

- Never `set` a tip through the Brsh target: Photoshop swaps any sampled tip for a soft computed round, silently. Set it
  as the Brsh object inside the whole tool options (`setBrushTip`). The read-back check catches this.
- Selecting a preset by index doesn't follow the order `presetNames` lists them in. Select by name.
- A global ExtendScript function named `colorSettings` breaks the whole script with "Error 1220: Illegal Argument, line 0".
- Selecting a preset keeps whatever it doesn't set from the one before, so each item starts from a plain round.
