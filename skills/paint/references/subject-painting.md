# Painting a subject automatically

A figure with a model behind it (a character built in three.js, a posed primitive figure) can be painted whole by a
style's **subject painter**: you say which figure and which style, and the painter lays every wash, light, feature and
line. Two things stay apart. The **subject** says what the figure is and what shows: its parts, materials, features
(eyes, a mouth, a brow) and frames, by name, in page pixels. The **painter** decides how a style paints it.

## When to paint automatically, and when by hand

Paint automatically when a figure has a subject (a brand character often ships one beside its model) and the style has a
painter: the same source then paints it in every style, pose and light, and a new pose costs nothing. Paint by hand
(the [first painting](${CLAUDE_PLUGIN_ROOT}/skills/paint/references/first-painting.md) way) for a one-off figure with no model, a painting whose washes are the point
(wet-in-wet blooms where you chose them), or a look no painter has. Between the two: paint automatically, then retune,
replace or finish, below.

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
- `light` is `soft` (a feathered gradation), `cel` (one hard terminator) or `cel-full` (half-tone, shade and core). The
  light comes from the subject's own key; a three.js subject takes its scene's.
- `contours` inks the silhouette and wherever one part lies in front of another. Watercolour's default is on, gouache's
  off: a brand character drawn with outlines wants it on in every style.
- `requireSubjectPainting` throws `paintSubject`'s problems, formatted. `studio paint check` names the parts behind a
  problem on a layer it made, unless you copied it (`{ ...layer }`).
- Make style, light, pose and expression properties, so one source shows every pairing: check each with `--set`.

A subject of your own: `defineSubjectFromThree` from an annotated three.js scene (each mesh a part, a region, a path or
unpainted), or `definePrimitiveSubject` from a posed primitive figure; `checkSubject` says what's wrong with one. Painters
read three tags (`SUBJECT_WELL_KNOWN_TAGS`): `eye`, a drawn `pupil`, a blush landmark `cheek`.

## Retuning, replacing, finishing

Overrides go after the options, in order. A selector picks targets by name, typed against the subject:
`selectPart('glove-left')`, `selectFeature('mouth')`, `selectFeatureGroup('face')`, `selectMaterial('charcoal')`,
`selectTag('limb')`.

```ts
paintSubject(subject, gouacheSubject, { light: 'soft' }, [
  subjectIntent(selectPart('glove-left'), { localColor: '#cfc3ae' }),   // what it is: colour, emphasis, edge
  subjectTune(selectPart('glove-left'), { shadowDepth: 1.8 }),          // how the painter treats it: its controls only
  subjectReplace(selectFeatureGroup('face'), { slot: 'all', frame: 'face', paint: handPaintedFace }),
]);
```

- **Retune** with `subjectIntent` (`localColor`, `preserveLocalColor` to hold a brand colour exact, `emphasis`, `edge`)
  or `subjectTune` (the painter's per-target controls: `shadowDepth`, `mute`, `texture`, `lineWeight`, `lineColor`,
  `blush`, watercolour's `bleed` past the silhouette; line art's `tool`, `detail`, `lineWeight`, `lineColor`,
  `overshoot` past each stroke's ends). A retuned part washes apart; every other key stays put.
- **Replace** with `subjectReplace`: the painter stops painting those targets in `slot` (`all`, or one of its slots,
  as `accents` for only the eyes), and your `paint` draws in their place, at that slot's depth. With `frame`, `paint`
  gets the frame's basis: `subjectFramePoint(frame, { x, y })` maps frame units to the page, and
  `subjectFrameUnitPx(frame)` gives a unit's size. A face frame puts the eyes at x = ±1 and the mouth at y = 1, so a
  hand-drawn face follows the head through every pose. Key your layers with the `paintKey` it hands you.
- **Finish** with ordinary layers after the painting's: `[...layers, ...yours]`. Place them from the subject:
  `findSubjectPart(subject, 'glove-right')` and `subjectAreaBox` of its area.

In gouache, paint a dark on a light by reserving the dark's region from the light (`reserves`), or it lifts the light
and greys; watercolour never covers, so a hand-drawn light needs paper kept for it.

## Adding a style

A style paints subjects once it binds a painter to its brushes: a `subject-painter.ts` in the style's folder calling
`watercolorSubjectPainter`, `gouacheSubjectPainter` or `lineSubjectPainter` with its brushes (and, for watercolour, its
pigments; for gouache, its paper's colour). A new medium needs a new painter, made with `defineSubjectPainter`: its
slots back to front, its defaults, the controls a tune may set, and a `paint` that plans from `paintedParts` and
`paintedFeatures` (never a replaced or hidden target) and keys every layer with `subjectPaintKey`. That's studio work,
not a project's.
