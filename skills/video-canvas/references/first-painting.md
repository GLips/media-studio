# A first painting

From an empty project to a painting checked, painted and shown in a scene. Each step ends on what tells you it's done.

## 1. Read the worked example

`$(studio home)/lib/paint/document/models/meadow.painting.ts`: read it whole before writing your own. A 640 × 360
watercolour on cotton paper (absorbency 0.5), one property (`hillTopPx`, 150..260 on a 10 px step), two layers:

- `landscape`: wash `sky` floods the sky's box run 30 px past the paper's edges at water 0.85 through the *even*
  `detail` brush, then charges a `treeline` stroke into it `on: 'wet'` through the `charge` round, clipped to the
  sky; wash `hill` floods the hill through the `wash` brush.
- `cloud`: one feathered ellipse at strength 0.15, in a layer of its own so it can drift.

What lands, and why:

| Application | Lands at (model s) | Why then | What you see |
|---|---|---|---|
| `sky-flood` | 0 | first, no `on` | a flat blue wash, walled by its crisp outline |
| `treeline` | 0 | `wet` holds: its core lies on the flood's full contact, above shiny | earth feathering into the wet sky: a soft treeline |
| `hill-flood` | 203.9 | a later wash of `landscape` starts once the layer's earlier washes have set | an earth fill with a crisp edge, mixing half the sky's film where it crosses it (one layer mixes) |
| the cloud | 203.9 | next in the sheet's order; the layer boundary dries nothing | a pale feathered ellipse glazed over the sky |

For a hill the sky shows through as a glaze, the hill goes in a layer of its own with `on: 'dry'` on its flood:
without it, it would land at 0 into the wet sky. Changing `hillTopPx` re-solves from the hill on; the sky keeps its
solve.

Done when you can say why the treeline is soft and the hill's edge crisp.

## 2. Wire the project

- `project.ts` names every style the painting brushes with: `styles: ['watercolor']`. A style it leaves out is
  refused by the check and missing from the bundle. No style on this machine: `${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/styles.md`.
- A source one scene uses sits in that scene's folder (`scenes/meadow/meadow.painting.ts`); one several scenes share
  is listed in `project.ts`'s `shared`.
- A source loads in plain Node, so it imports models only, never `#studio`: types from
  `#lib/paint/document/models/painting-document.ts` and `painting-properties.ts`, pigments from
  `#lib/paint/materials/models/paint-watercolour-pigments.ts`, `seededRandom` from
  `#lib/picture/motion/models/random.ts`. A helper module it imports is a model too, named `*-model.ts`.
- Paper, brushes and mixes shared by several sources go in one kit model (`scenes/<scene>/paint-kit-model.ts`).

Done when `project.ts` names the style and the source's folder exists.

## 3. Write the source

```ts
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { BrushRef, Mix, PaintingDocument, Paper } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';

export const properties = {
  hillTopPx: { type: 'number', unit: 'paper px', min: 150, max: 260, step: 10, default: 200 },
} as const satisfies PropertySchema;

const COTTON: Paper = { color: '#f4f2ed', grain: { image: { style: 'watercolor', pack: 'vvds', file: 'papers/vvds-watercolor-canvas-3.grain.png' }, scale: 1, depth: 0.35 }, absorbency: 0.5 };
const EVEN: BrushRef = { style: 'watercolor', brush: 'detail' };
const SKY_BLUE: Mix = { parts: [{ pigment: WATERCOLOUR_PIGMENTS.ultramarine, amount: 1 }], strength: 0.45 };

export default function meadow({ hillTopPx }: PropertyValues<typeof properties>): PaintingDocument {
  return {
    widthPx: 640, heightPx: 360, paper: COTTON, medium: 'watercolour',
    layers: [{ key: 'landscape', washes: [{ key: 'sky', applications: [/* … */] }] }],
  };
}
```

Properties are `number` (`min`, `max`, optional `step`), `boolean` or `enum`. Give numbers a `step`: each distinct
value is a solve. Plan the lights and the order of washes first (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/techniques.md`); the rules water follows are in
`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-model.md`.

Done when the factory reads nothing but its values and imports.

## 4. Check, then paint

1. `studio paint check <source>`: every problem the check sees without the GPU, a line each with its box in document
   px. Fix until it prints the summary with 0 errors. 0 errors means none *it* can see: `on` gates are left to a solve.
2. `studio paint check <source> --solve`: solves on the GPU and prints each wash's start, damp window and set time,
   and each application's landing time with the `on` it waited for. Read it against what you meant: a charge meant to
   feather in landing after the flood set is a plan gone wrong, even when nothing failed. It writes the painting and
   each layer's film as PNGs.
3. `studio paint still <source> [--set name=value] [--at <s>]`: the PNG, in the project's `out/check/`. Read it at the
   size it will be seen.

Done when the check is clean, every landing time is the one you planned, and the still reads right at delivery size.

## 5. Show it in a scene

A scene shows paintings through `<PaintedShot>`: a camera and planes, each plane a depth and a source.

```tsx
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { layersOf, painting, PaintedShot, sceneForTimelineClock, sceneSecondsOf, type PaintedShotProps } from '#studio';
import type { StoryboardSceneClock } from '#lib/timing/storyboard/models/storyboard.ts';
import { storyboardTimeline } from '#lib/timing/storyboard/models/storyboard-timeline.ts';
import { storyboard } from '../storyboard.ts';
import * as meadow from './meadow/meadow.painting.ts';

const meadowShot: PaintedShotProps = {
  // The frame, and 2 px of margin past each side (whole and even; more for blur or a move).
  camera: { stage: stampStage({ width: 1920, height: 1080 }, 2), fov: 30, lens: { bloom: 0 } },
  span: sceneSecondsOf(storyboardTimeline(storyboard).clock('meadow')).span,
  planes: [{
    id: 'meadow', depth: 1, source: layersOf(painting(meadow, { hillTopPx: 200 }), ['landscape', 'cloud']),
    lay: { kind: 'cover', box: { x0: 0, y0: 0, x1: 640, y1: 360 } },
  }],
};

export const meadowScene = (clock: StoryboardSceneClock<typeof storyboard, 'meadow'>) =>
  sceneForTimelineClock(clock, { render: (s) => <PaintedShot shot={meadowShot} t={s.t} /> });
```

- The stage is the frame: at rest a plane's document px are frame px. The back plane must cover what the frame shows
  of it, or the shot is refused (`meadow.lay`). The 640 × 360 study is laid with a `cover`, three times its px and
  soft for it; paint a scene's back at the frame's size or larger and it needs no lay. A painting meant to sit small
  inside the frame goes on a nearer plane (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/shots.md`).
- Keep the shot a module constant (or built once per scene binding): `PaintedShot` reloads when its identity changes.
- `studio paint check <project>` compiles every painted shot without the GPU and prints motion warnings; `studio look
  <project> --sheet <seconds>` shows frames from the composition, and `--set <factory>.<property>=<value>` shows a
  painting at another value in place.

Done when the project check is clean and a look sheet shows the painting where the storyboard puts it.
