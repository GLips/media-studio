# Diagnosing a painting

When a wash looks wrong, a solve fails, a shot warns or a render stalls. Every message names its path and, mostly,
its fix: do what it says. This page is for what a message can't say.

## The ladder: cheapest look first

1. `studio paint check <source> [--set …]`: shape, keys, mixes, brushes and assets against the project's styles, and
   `on`s that can *never* hold, without the GPU. Each line: `<owner>.<field>: <message> [x0,y0 → x1,y1]`, the box in
   document px.
2. `studio paint check <source> --solve [--at <s>]`: solves on the GPU and prints, sheet by sheet, each wash's start,
   damp window and set time, and each application's landing time with the `on` it waited for. Writes `painting.png`
   and `films/<layer>.png` (each film alone on its paper): a film that looks right alone and wrong in the painting is
   meeting another layer's water.
3. `studio paint diff <source> --to name=value` (or an edited copy): which washes re-solve, before anything solves.
4. `studio paint still`, then `studio paint check <project>` for the shots (motion warnings, painting-in-time keys),
   then `studio look`.
5. `studio profile <project> --frames a:b --costs`: what each frame solved and cost.

Whatever draws on the GPU queues for the studio's lease, one look or solve and one render at once, and says so while
it waits; `studio gpu` shows who holds it.

## A wash that looks wrong

| You see | Likely cause | Do |
|---|---|---|
| a charge sits on top with a hard edge instead of feathering | it landed after the flood lost its shine: something before it in the sheet's order waited, or the flood was at default water | flood at 0.85+ with an even brush; lay the charge sooner, ahead of what waits |
| a glaze mingles into the wash under it | the glaze landed into the base's water: a layer boundary dries nothing | its first application `on: 'dry'` |
| a pale overlay turns muddy or olive | it's in the base's layer, so it mixes | give it a layer of its own |
| a wash dulls to grey or brown | complementaries mixing in one film (burnt sienna into ultramarine): within a layer every application mixes into the paint there (pickup 0.5), so every pass greys it more | find the layer by its film (`--solve`'s `films/<layer>.png`); keep the hues in separate layers, one glazing the other, or charge the second only where the grey is meant |
| a wash reads dirty, speckled dark in the grain | a granulating pigment (ultramarine, burnt umber, cerulean) at a strong load on deep grain | a weaker load, a non-granulating pigment (phthalo), or shallower grain |
| a gradient goes grey in the middle | a field of mixes grades pigment amounts | grade one mix's strength; change hue across layers |
| a pale gouache passage reads chalky | gouache lightens with white | reserve the paper for light; cap the film for a veil |
| a gouache passage fading to "nothing" fades to white | strength 0 is titanium white | fade by `load` or `opacityCap` |
| dark blotches where marks overlap | capped films add up per application | plan by their sum; lay one application for an even film |
| a bloom barely shows | surplus under 0.2 over damp, or nothing open under it | wetter drop; drop it while the wash is open |
| a reserve still shows paint | the reserve binds only its own application | give every application of the wash (and its prewet) the same footprints |
| bare specks along a wash's edge at the paper's edge | a flood's tip breaks along its outline | run the outline 30 px past the paper |
| an edge reads narrower than written | ramps read over part of their width | about 1.6 W in watercolour, 3.3 W in gouache |
| a moved element's surroundings change too | it's on shared paper: each pose re-solves its sheet from it, its water meeting the wash | an own sheet, or accept the shift |

## A solve that fails

A refusal prints after the check's summary and names the first five applications it leaves unscheduled.

- **`on 'wet'` short of 95%** names its reason, the first that fits: *never wetted on this sheet* (lay it over the
  flood); *the water dried past shiny before it lands* (something between waited: lay it sooner, or flood wetter; at a
  fixed `at`, move it earlier); *it crosses a lift* (charge before lifting); *nothing under it is shiny* (flood
  wetter); else *part of its core lies where the water falls away*: a flood's rim or a textured brush's flecks. Inset
  the charge from the rim, feather it or the flood, or flood with an even brush.
- **`on 'damp'` never over 95% at once**: its core spans paper drying at different rates; split it along the boxes
  printed, so each part lies on paper drying alike. `--solve` also prints a wash *never damp over 95% of it at once*
  when its brush's flecks or a feather leave it uneven; a `damp` into it waits on its own core.
- **A fixed `at` whose `on` doesn't hold then** is judged there alone: move the `at` to where `--solve` says the paper
  is as you need, or drop the `on`.
- **Decided within rounding** (warning): the `on` holds by a hair, and another GPU may place it a step apart. Make it
  wetter or drier by a little.
- **A fill refused for want of a profile**: run the command it names (`studio brushes import --style <s> --pack <p>`,
  no archive), which measures only what's missing.

## Shots that warn or refuse

**Motion warnings** come from `paint check` and every render; they're never refusals.

- **A speed jump**: a key met at another speed than it's left at reads as a knock. Ease into the key (`'out'`,
  `'inOut'`) or `between: 'smooth'`; a knock that's meant says `snap: true` on its key.
- **Fast with the shutter shut**: moving more than the frame's width in 7 s (11.4 px a frame at 1920 px, 24 fps)
  strobes. Slow it, or open the shutter.
- **A hold's steps past that pace**: a held drawing holds through its shutter, so its step strobes under any shutter.
  Hold it on ones, or slow it.
- **A pop**: visibility changing by 0.9 or more within a frame. Fade over a few frames; a pop that's meant stays
  reported.

**Refusals worth knowing**: the back painted short of what the frame reads (apply the fix it prints, worked out for
the lay as written); a painting in time's `drawings` below what its first, last and cut moments need, or a warning
that it leaves a turn undrawn (allow more); a mix naming a pigment by its name (give `WATERCOLOUR_PIGMENTS.<name>`);
a stacking context or transform between a canvas and its shot; a span not the scene's (`sceneSecondsOf(clock).span`);
`warm` written in frames (it's scene seconds).

## Renders that stall or crash

A painting project renders a chunk of frames per fresh browser, warming the chunk's solves first. A chunk whose page
stalls (no solve finished and the GPU silent for 90 s) or crashes is drawn again in halves, down to a lone frame,
which fails the render, named with its scene. For a frame that fails alone: `studio profile <project> --frames
N:N --costs` shows what it holds; a frame stuck at the same solve every time is a bug to report with the line.

## Same pixels

- On one machine a frame looks the same however it's reached: `studio repeatable <project> <times>` renders chosen
  times cold, after other frames and beside other tabs, and passes over 50 dB. A few pixels a level apart is rounding;
  a frame far below the bar depends on what its tab drew before (an unseeded stream, a stale target).
- Across machines never compare pixels: GPUs round half floats differently where stamps overlap. Judge by eye.
