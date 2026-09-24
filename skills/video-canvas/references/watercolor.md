# Watercolour

Hand-painted: flat washes and bleeding watercolour fills, charcoal hatching, tapered ink lines that boil, on warm
paper with grain. `lib/paint/watercolor.tsx`; the working example is `projects/2026-09-paint-test/video.tsx`.

```tsx
<Watercolor t={s.t} paint={(w) => {
  w.paper();
  w.boilSeed('sky');
  w.paint(w.rectPts(-40, -40, 2000, 700, 20), { fill: PAL.sky, fillOp: 120, bleed: 0.25, ink: null });
  w.boilSeed('sun');
  w.glow(1380, 300, 220);
  w.paint(w.ellPts(1380, 300, 90, 90, 30, 3), { wash: PAL.ochre, ink: PAL.clayDk, sw: 1.2 });
}} />
```

## The medium

- **Everything is paint.** Shapes go through `w.paint(pts, options)`, lines through `w.inkLine(pts, weight, colour,
  brush)`. Plain p5 shapes (`rect`, `ellipse`, `fill()`) look like 2000s Flash next to it.
- **The line work boils.** Jitter re-seeds 15 times a second (`BOIL`), so each drawing holds for two frames at 30 fps.
  That's the look; don't fight it. Call `w.boilSeed('name')` before each separate element, or a moving element shifts
  the random stream and everything drawn after it jitters every frame.
- **Flat 2D.** Depth comes from overlap, scale and colour (farther is smaller, bluer, paler), never a 3D projection.
- **Light is added, not painted.** p5.brush mixes colours like pigment: yellow over blue turns green, and a thin wash
  over light turns grey. Use `w.glow(x, y, r, colour)` for anything that shines. It barely shows on light grounds.
- **Soft palette.** `PAL` has the kit's colours. No pure black or white: `PAL.ink` and `PAL.cream` / `PAL.paper`.
- **One shape, one outline.** Build a thing from as few outlines as possible; a tail is one `w.ribbon(...)`, not five
  circles.

## `paint` options

| Option | Does |
|---|---|
| `wash`, `washOp` | Flat colour, 0–255 opacity (255 is exact; lower mixes). For anything solid |
| `fill`, `fillOp`, `bleed`, `tex`, `border` | Watercolour with bleeding edges and pigment texture. `bleed` ~0.05–0.3, `tex` ~0.3–0.9. Skies, hills, shading |
| `hatch: { d, a, o, b, c, w }` | Hatching: distance, angle, `{ rand, gradient }`, brush (`'charcoal'`, `'HB'`), colour, weight. Sparingly |
| `ink`, `sw`, `br` | Outline colour (default `PAL.ink`; `null` for none), weight ~0.4–2, brush |
| `curv` | 0–1: smooth the outline through the points |

Brushes: the kit's `'ink'`, `'inkfine'`, `'dry'`, and p5.brush's `'2B'`, `'HB'`, `'charcoal'`, `'marker'`, `'pen'`,
`'cpencil'`, `'rotring'`, `'spray'`.

Shapes: `w.rectPts`, `w.ellPts`, `w.through(pts)` (a smooth curve through points), `w.ribbon(path, w0, w1)` (a tapered
outline along a path). To draw a line on, slice its points by progress, keeping at least two (a spline needs them):
`path.slice(0, Math.max(2, Math.round(path.length * k)))`, and draw nothing while `k` is 0.

## Transitions

`w.brushWipe(k)`: fat strokes sweep across (k 0 → 0.5), then drag off (0.5 → 1). Cut under full cover: the outgoing
scene paints 0 → 0.5 over its last beat; the incoming one, with `cut: true`, paints 0.5 → 1 over its first. Over a
capture, the incoming side needs an `on="clear"` layer.

## Over captures

An ink loop around a price, an underline under a phrase, an arrow: an `on="page"` layer, anchored to the word. See
`paintInkRing` in the test project: a loop that overshoots where it closes, drawn on over about 0.7 s, starting 0.4 s before the word.

## Tells

- Jittery lines: something still re-boiling every frame, because no `boilSeed` came before it.
- Muddy green-grey light: yellow painted over blue. Use `glow`.
- Plain shapes, gradients or digital glows mixed into the paint.
- Pure black or white.
- Every element outlined at the same weight: vary `sw`, and leave backgrounds unoutlined.

## Cost

About 100 ms a frame for a dense painting, 60 ms for ink over a capture. Hundreds of fills and strokes are fine;
thousands aren't.
