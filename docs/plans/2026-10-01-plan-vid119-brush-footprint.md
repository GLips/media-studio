# Plan: a brush knows its footprint, and a fill is one plan (vid-119)

Agreed with Graham and Codex (session 01a0f826, rounds 5–9) on 2026-10-01. It replaced the vid-119 spike, which
showed the shape works: brushed, natural edges at every diameter, pine tiers intact. This page describes what landed.

## The problem underneath

Narrow fills came out clipped, blotchy or soft because nothing knew how far a brush's paint reaches. Each place that
needed it guessed half the nominal diameter, each wrong in its own way. A brush's visible reach is 0.27 d (filler) to
0.75 d (very wet brush). Every one of these reads its measure now:

| Was a guess | Where | Reads |
| --- | --- | --- |
| A flood's edge stroke d/2 inside | `stamp-fill.ts`, `stamp-fill-plan.ts` | the visible offset, by heading and side |
| A strokes fill's marks d/2 inside | `stamp-fill-strokes.ts` strokeRoom | the visible offset, by heading and side |
| Water on a disc of d/2 per stamp | `stamp-wet-contact.ts` | the tip's contact |
| A wet window d/2 round each stamp | `stamp-wetness.ts` window | the tip's support |
| Motion bounds d/2 round each stamp | `paint-motion-compile.ts` | the tip's support |
| A flood body eased from a probe stroke | `stamp-fill.ts` | rows of the brush's own strokes, half its visible width apart |
| Whether a flood carries water | `StampPaintMedia` | the deposit's water, resolved once |

The flood's reveal front (`stampFloodFront`) overbounds by a full diameter on purpose, read from support.

## The domain, as data

Three measures; one number for all three would trade one bug for another:

- **Visible offset**: how far a firm, untapered stroke's paint reaches from its centreline, half the coverage of the
  central reference, per side, by diameter and heading. Protocol 9 reads it on pooled, smoothed sections across the
  stroke, so one bristle gap doesn't set a side. Fills plan with it.
- **Support**: the farthest any faint texel can land, from the exact mip bytes the GPU samples. Bounds read it.
- **Contact**: where the tool touched the paper, as continuous tip coverage over half its strongest paint, pressed;
  opacity, grain, flow and colour are paint. Water reads it.

What holds them:

- **`StampBrushProfile`** (per brush, in the pack manifest), measured at import through the production renderer: its
  key and provenance, the diameters it holds, `edge` (left and right offsets by heading) and `support`. A consumer refuses a missing or stale profile, interpolates between samples and
  never extrapolates.
- **Tip levels**: canonical mip bytes made on the CPU and uploaded as they are. The hull and contact read the same
  bytes.
- **One room model** (`stamp-fill-plan.ts`): a mark's footprint is its reach toward every direction
  (`stampMarkSupport`), read from the profile's edge by heading and side at one diameter. Where a mark may lie is the
  region eroded by that footprint (`stampFootprintAgainst`): positive where it clears the outline. Every fill reads
  its room this way.
  - Which way a mark heads sets its footprint: an edge run turns with the outline on its right; a ridge, a row that
    turns back and a scribble may run either way, so they fit both; a hatch row and a guided mark head their own way.
  - A turning tip's end cap isn't measured; its footprint takes a half disc of each side's reach ahead and behind. A
    flat tip can overshoot a sharp corner by its unmeasured cap (vid-154).
  - A disc's footprint, every way alike, is its offset, so a profile with one offset at every heading plans as a disc.
- **A flood's plan** (`planStampFloodRuns`): geometry only.
  - The edge run sits on the region eroded by the edge stroke's footprint, so a lopsided or squarish tip's paint
    still ends on the outline. A lopsided tip turns its nearer-reaching side out (the plan reads it mirrored and its
    loops run backwards), so the stroke's body lies at the line and a long faint side, a bristle tail, over the
    inside.
  - Ridges run where the shape is narrower, each point at the largest diameter whose own footprint (the profile
    interpolated there, not the full one scaled) fits.
  - A ridge narrows no further than the profile's least measured diameter (`smallest`, px). Below it the profile
    says nothing of how far paint reaches. Extrapolating would guess, so where that diameter's footprint doesn't fit
    no paint goes; where its narrow way fits, a ridge runs though its mean reach is wider.
  - Its local scale is a grid, each point its nearest run point's.
- **A flood's inside** (`placeStampFlood`): rows of the same firm strokes within the edge contour, half the visible
  width apart (the mean offset); a dry brush's and the dual's a quarter diameter apart at most. Every row runs the
  same way and shares the deposit's one start turn, as a stroke's stamps do: per-row turns of a lopsided tip met in
  dark lines.
- **A flood's barrier**: its region, which its paint and water stop at as at a line of dry paper, prewet paper too.
  A lost edge (`edge.lost.reach`) ramps the barrier out instead. Later deposits that cross the line aren't stopped by
  it, and a strokes fill has none.
- **A strokes fill's room** (`strokeRoom`): one for every pattern, by the same footprints. The contour pattern's
  outer ring sits on the eroded region as a flood's edge run does.
- **Water**: a deposit says how much it carries, or its medium's `defaultWater`. `StampPaintMedia` resolves it once
  per painting, for both mixings, with each group's medium. The renderer and the washes read the same binding. A
  flood's water lands where its paint lands, by its rows' and edge runs' touch within its barrier, not over its region.
- **Contact** (`stamp-wet-contact.ts`): stamps join by their most on a fine grid, then each lattice cell averages, so
  two halves of a cell touch it whole. A stamp's touch is one formula, `stampTipTouch`. Its WGSL twin runs per
  pixel in the renderer's touch, and the gate holds the two together.
  - The GPU's contact is per pixel, not read from the lattice, because the flow runs paint by it. A lattice cell's
    contact would run paint a cell past the tool, onto paper a later deposit lands on half dry.
- **Effect scale**:
  - The flow reaches by the plan's scale grid, point by point, through its per-pair rule (symmetric, so paint is
    conserved).
  - The drying rim sizes each lattice point by the contact-weighted tool diameter there, the paper's existing water
    included, so a pre-wetted wash keeps its rim. A barrier's line is the rim's edge, abrupt. A flood its barrier
    holds stands as a puddle there (`stampFloodHeldWetness`), so it rims on dry paper too; a lost edge holds none.
  - Bloom sizes its front, lobes and streaks by the local scale at each pixel. Its transport's Gaussians are
    separable, so they spread by the deposit's widest, its full diameter's.

### Scaled runs of a bristle brush

A bristle tip is drawn once per deposit, at its diameter, and a ridge's scaled stamps shrink that image. The plan
evaluates the offset at the scaled diameter, which the profile measured on a tip drawn there. Measured on Photoshop
bristle presets (shapes 0, 1, 2, 5 and 9, sparse to dense, thin to thick), the two agree to within a pixel. That holds
from 16 px up and stays within 1.5 px down to 2 px, where the raster's own half-pixel steps dominate. So the plan
reads the profile as it is. Neither tip variants along a run nor a bristle-only offset rule earns its complexity.

## Elsewhere

A knockout's loosening reads each underlying medium's rewetting, not the lifter's (vid-130 follow-up). It lands
separately, keeping vid-139's residue laws.
