# Probing Procreate's renderer

Nothing published says how Procreate paints: how a grain blend combines with a stamp, how a dual combines, how the
rendering modes build within a stroke, how wide and dark a wet edge is. So the studio measures it. `studio brushes
probes` writes a brush set of probes (`lib/picture/stamp-paint/models/procreate-probes.ts`), each a plain round brush
with one setting changed. Procreate's preview of each probe is the readout. Brought back as a pack, the probes go
through the brush fidelity sheet and `studio brushes fit` like any other pack, so the importer's constants are fitted
to them as well as to a bought pack's previews.

Most probes preview as a single stamp. The tip ramps from no paint at its left to full paint at its right, and the
grain (or dual tip) saws from none to full down its height, so one preview draws a blend's whole transfer. Stroke
probes read what only a stroke shows: overlap within a half-flow stroke per rendering mode, wet and burnt edges, flow,
pressure, taper, and how stamps turn.

## Writing the set

```sh
studio brushes probes --archive ~/Downloads/E13434.zip --brush "Smooth Ink Pen" --out studio-probes.brushset
```

Each probe's `Brush.archive` is the template brush's, with the probe's settings written over it. That way it holds every
key and class Procreate expects. Any single brush (not a dual) from a pack you own will do. The set has no previews:
whatever preview comes back is Procreate's own.

## Getting Procreate's previews back (about five minutes, on the iPad)

1. AirDrop `studio-probes.brushset` to the iPad and open it in Procreate. It imports as a set called **Studio probes**,
   65 brushes named Probe 01 to Probe 65.
2. Open the Brush Library and look at the set. Each probe should show a preview: a stroke, or one stamp for the
   stamp probes. If a probe shows nothing, open it in Brush Studio and close it again (Done), which makes Procreate
   draw its preview.
3. Tap the set's name, then **Share**, and AirDrop the `.brushset` back to the Mac.
4. On the Mac:

   ```sh
   unzip -l "Studio probes.brushset" | grep -c Thumbnail.png   # 65 means Procreate wrote every preview
   studio brushes import "Studio probes.brushset" --style procreate-probes --pack probes
   studio brushes sheet --style procreate-probes --pack probes
   ```

If the count is 0, exporting doesn't write previews. In that case take a screenshot of the Brush Library showing the
set at full screen (it takes three or four, scrolling), without zooming, and send those instead. The previews are
smaller there but read the same way.

## Reading them

The sheet paints each probe as the studio reads it beside Procreate's preview, and scores it. The stamp probes are
transfer functions: the preview's alpha at (x, y) is the paint for tip value x and grain (or dual) value y, each 0 to
1 across the stamp. A saw grain repeats four times down its tile, so its period reads off the preview too, and that
period gives the grain's scale against the stamp. The fitter weighs the probes with the pack it fits, so a constant
that matches the pack only by accident against Procreate's own behaviour loses.
