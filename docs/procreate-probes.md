# Probing Procreate's renderer

Nothing published says how Procreate paints: how a grain blend combines with a stamp, how a dual combines, how the
rendering modes build within a stroke, how wide and dark a wet edge is. So the studio measures it. `studio brushes
probes` writes a brush set of probes (`lib/picture/stamp-paint/models/procreate-probes.ts`), each a plain round brush
with one setting changed. Procreate's render of each probe is the readout. Once one comes back full size, the probes
go through the brush fidelity sheet and `studio brushes fit` like any other pack, so the importer's constants are
fitted to them as well as to a bought pack's previews.

Most probes preview as a single stamp. The tip ramps from no paint at its left to full paint at its right, and the
grain (or dual tip) saws from none to full down its height, so one preview draws a blend's whole transfer. Stroke
probes read what only a stroke shows: overlap within a half-flow stroke per rendering mode, wet and burnt edges, flow,
pressure, taper, and how stamps turn.

## Writing the set

```sh
studio brushes probes --archive ~/Downloads/E13434.zip --brush "Smooth Ink Pen" --out studio-probes.brushset
```

Each probe's `Brush.archive` is the template brush's, with the probe's settings written over it. That way it holds every
key and class Procreate expects. Each setting keeps the type the template stores it as: Procreate drops a brush whose
key has the wrong type (a real where it keeps a bool), and imports the set empty if it drops them all. Any single
brush (not a dual) from a pack you own will do. The set has no previews: whatever preview comes back is Procreate's own.

## What Procreate gives back

Procreate imports the set as **Studio probes**, 65 brushes, and draws each one's preview in its Brush Library. But
neither gets a preview back to the Mac:

- An exported `.brushset` carries no rendered previews. Procreate writes `QuickLook/Thumbnail.png` only for a brush
  that shipped with one, and the probes ship without.
- The Brush Library's previews are too small and too low-resolution to read a single stamp's gradient from, so
  screenshots of them don't do either.

So the probes can't yet be read. They need a full-size render from Procreate, such as each probe drawn on a canvas and
exported, and that round trip isn't worked out. Until then the importer's reading is fitted to a bought pack's own
previews alone.

## Reading them

Once there's a render to read, the sheet paints each probe as the studio reads it beside Procreate's preview, and scores it. The stamp probes are
transfer functions: the preview's alpha at (x, y) is the paint for tip value x and grain (or dual) value y, each 0 to
1 across the stamp. A saw grain repeats four times down its tile, so its period reads off the preview too, and that
period gives the grain's scale against the stamp. The fitter weighs the probes with the pack it fits, so a constant
that matches the pack only by accident against Procreate's own behaviour loses.
