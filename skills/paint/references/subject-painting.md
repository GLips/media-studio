# Painting a subject automatically

A subject supplies named parts, materials, features and frames in page pixels. Its painter interprets them.

## Start from the nearest look

Import `lineLook` from `#styles/watercolor/subject-painter.ts`. Inspect `printLook(lineLook)`.
Thin both ink passes with `lineLook.with({ inkWeight: 0.6 })`, or recolour the outline alone:

```ts
const blue = deriveLook(lineLook, {
  name: 'blue-contour', replace: { contour: c => c.with({ colour: '#2455bb' }) },
})
```

Place `lookPlanes` in your PaintedShot. Publish private recipes with `defineLook` and `lookDraw`.
Name independent passes `fill`, `guides`, `contour`, `features`, `shadow` and `ground` where they apply.
For a one-off or wash study, [paint by hand](${CLAUDE_PLUGIN_ROOT}/skills/paint/references/first-painting.md).

## Painting a subject

```ts
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { paintSubject, requireSubjectPainting } from '#lib/paint/subject-painting/models/paint-subject.ts';
import { clapperSubject, CLAPPER_SUBJECT_FRAME } from '#brands/media-studio/characters/clapper/clapper-subject.ts';
import { watercolorSubject } from '#styles/watercolor/subject-painter.ts';

export default function clapper(): PaintingDocument {
  const { layers } = requireSubjectPainting(paintSubject(clapperSubject('hero', 'happy'), watercolorSubject, { light: 'cel' }));
  return { widthPx: CLAPPER_SUBJECT_FRAME.width, heightPx: CLAPPER_SUBJECT_FRAME.height, medium: 'watercolour', paper: { color: '#f4f2ed', absorbency: 0.5 }, layers: [...layers] };
}
```

- Painters: `watercolorSubject` and `lineSubject` from `#styles/watercolor/subject-painter.ts`, `gouacheSubject` from
  `#styles/gouache/subject-painter.ts`; list the style in the project's `styles`. `studio api` gives each painter's
  options (`WATERCOLOR_SUBJECT_DEFAULTS` and so on).
- `light`, from the subject's own key: `soft` (glazes that save the lit side and shade the whole mass), `cel` (one
  hard terminator) or `cel-full` (half-tone, shade and core).
- `contours` inks the silhouette and wherever one part lies in front of another (watercolour only where two materials
  meet: a seam inside one form is left to the washes). On in watercolour, off in gouache; a character designed with
  outlines wants it on. Each silhouette stretch is inked with its own part's `lineWeight`, `lineColor` and `edge`.
- Line art holds every outline, thinning where it faces the key; `edge: 'soft'` or `'lost'` lets it break.
- Over footage, wrap the painting in `subjectFigureCard`, so the figure keeps its whites and ends in a soft edge,
  and place it with `shotFigure`.
- `requireSubjectPainting` throws `paintSubject`'s problems; `studio paint check` names the parts behind each.
- Make style, light and pose properties; check each pairing with `--set`.

Your own subject: `defineSubjectFromThree` (an annotated three.js scene) or `definePrimitiveSubject` (a posed
primitive figure); `checkSubject` says what's wrong. Painters read three tags (`SUBJECT_WELL_KNOWN_TAGS`): `eye`,
a drawn `pupil`, a blush landmark `cheek`.

## Retuning, replacing, finishing

Overrides go after the options, in order, picking targets by name: `selectPart('glove-left')`, `selectFeature`,
`selectFeatureGroup('face')`, `selectMaterial`, `selectTag`.

```ts
paintSubject(subject, gouacheSubject, { light: 'soft' }, [
  subjectIntent(selectPart('glove-left'), { localColor: '#cfc3ae' }),   // what it is: colour, emphasis, edge
  subjectTune(selectPart('glove-left'), { shadowDepth: 1.8 }),          // how the painter treats it: its controls only
  subjectReplace(selectFeatureGroup('face'), { slot: 'all', frame: 'face', ground: 'over', paint: handPaintedFace }),
]);
```

- **Retune** with `subjectIntent` (`localColor`, `preserveLocalColor` to hold a brand colour exact, `emphasis`, `edge`)
  or `subjectTune` (the painter's controls: `shadowDepth`, `mute`, `texture`, `lineWeight`, `lineColor`, `blush`,
  watercolour's `bleed`; line art's `tool`, `detail`, `overshoot`). A tune splits only the passes that read it, keyed
  by its part, so trying another value moves no seed. `shadowDepth: 0` lays no shade. Tunes that clash on one target
  are an `invalid-options` error.
- **Replace** with `subjectReplace`: the painter leaves those targets in `slot` (`all`, or one slot, as `accents` for
  the eyes) to your `paint`, at that slot's depth. With `frame`, `subjectFramePoint(frame, { x, y })` maps frame units
  to the page; a face frame puts the eyes at x = ±1 and the mouth at y = 1, so a drawn face follows the head. Key
  layers with the `paintKey` it hands you.
- **`ground`** says what a replacement paints on. `'keep'` (the default) keeps the paper the painter kept under its
  targets, for a transparent glaze; `'over'` lets the washes run under an opaque or darker one; `{ reserve: area }`
  keeps paper in a shape of its own, as a winking eye.
- **Finish** with your own layers after: `[...layers, ...yours]`, placed by `findSubjectPart` and `subjectAreaBox`.
- **One piece alone**: `subjectShowingOnly(subject, [selectPart('glove-left')])` hides the other parts, so an effect
  can read a hand apart from its body; layers group by pass, not part.

In gouache, reserve a dark's region from the light under it, or it greys; in watercolour, a light drawn by hand needs
paper kept: a replacement's `ground`, or `reserves`.

## Adding a style

A style paints subjects once a `subject-painter.ts` in its folder binds `watercolorSubjectPainter`,
`gouacheSubjectPainter` or `lineSubjectPainter` to its brushes (watercolour's pigments, gouache's paper colour too). A
new medium needs a painter from `defineSubjectPainter`: slots back to front, defaults, tunable controls, and a `paint`
that plans from `paintedParts` and `paintedFeatures`, keeps the paper replacements ask for (`keepsGround`,
`reservedGrounds`), and keys every layer with `subjectPaintKey` from what it paints, never an option's value: studio
work, not a project's.
