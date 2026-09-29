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

Procreate imports the set as **Studio probes <hash>**, 88 brushes (with the two bridge brushes), and draws each one's preview in its Brush Library. But
neither gets a preview back to the Mac:

- An exported `.brushset` carries no rendered previews. Procreate writes `QuickLook/Thumbnail.png` only for a brush
  that shipped with one, and the probes ship without.
- The Brush Library's previews are too small and too low-resolution to read a single stamp's gradient from, so
  screenshots of them don't do either.

So the probes need a full-size render from Procreate: each one painted on a canvas and exported.

## Capturing on the iPad (parked, vid-96)

The reference target moved to scripted Photoshop on the Mac, so this rig is parked. It's kept for Procreate packs
later. `studio brushes capture --archive <pack>` drives Procreate on a USB-connected 12.9-inch iPad in landscape. It
lays the probes out as named layers on 4096² canvases (`models/procreate-capture-plan.ts`), paints them with synthetic
finger touches, exports every layer at once (Share › PNG Files), and pulls the PNGs and a `manifest.json` into
`work/styles/<style>/brushes/procreate-captures/<run>/`.

One-time setup on the Mac:

1. `uv tool install pymobiledevice3` (USB file transfer into Procreate's shared folder).
2. Xcode, the iPad trusted, Developer Mode on and Auto-Lock off.
3. `studio brushes capture --setup --team <id>` builds and signs WebDriverAgent. A Personal Team's profile lasts a
   week, so rebuild when the runner stops launching. Trust the developer certificate on the iPad once.
4. Point Procreate's Save to Files at On My iPad › Procreate once by hand. The picker remembers it.

What works, on Procreate 5.4.14 and iPadOS 17.7:

- Template import, layer naming, hiding the background, and colour by hex.
- Brush-set import through the Files app. Procreate's own Brushes folder doesn't auto-import, and its gallery Import
  greys out `.brushset`.
- Painting, and export of every layer as 4096² 8-bit sRGB PNGs with straight alpha, named in the XMP `dc:title`.
- The screen maps to 4 canvas px a point, with the canvas's left edge at 169.875 pt. WebDriverAgent drops a touch's
  fraction of a point, so the driver snaps to whole points and records where each landed.
- A 5-probe pilot took 6.4 min, about 30 s a probe, most of it in panels.

Left open:

- The pilot's marks came back as 27×2 px slivers, and its lines came back empty. The probe base's size or shape keys,
  or the finger's taps and strokes, don't yet give a round stamp. Check it by hand with one probe first.
- `PROCREATE_FULL_SIZE_DIAMETER` still needs calibrating from the size ladder.
- The repeat variation hasn't been measured.

## Reading them

Once there's a render to read, the sheet paints each probe as the studio reads it beside Procreate's preview, and scores it. The stamp probes are
transfer functions: the preview's alpha at (x, y) is the paint for tip value x and grain (or dual) value y, each 0 to
1 across the stamp. A saw grain repeats four times down its tile, so its period reads off the preview too, and that
period gives the grain's scale against the stamp. The fitter weighs the probes with the pack it fits, so a constant
that matches the pack only by accident against Procreate's own behaviour loses.
