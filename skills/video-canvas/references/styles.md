# Painting styles

A painted look comes from a **private style**: a pack of brushes someone bought, with its palette and paper. The
licence covers the buyer's copy, so a style lives only in the workspace, `$(studio home)/work/styles/<name>/`, never in
the studio. Any project can paint with it, and a project can use several.

## Finding one

`ls "$(studio home)/work/styles/"`. No folder there means no painted look on this machine: say so, and offer what
the studio's React code can draw (SVG strokes, masks, three.js) or importing a pack the user owns.

```
work/styles/<name>/
  style.ts               the style: its packs, brushes by its own names, palette and paper
  <name>.md              how to paint in it: which brushes do what, the pack's workflow, what didn't carry over
  fidelity-grades.json   each brush graded against its source app's own render
  fidelity.ts            a note per brush on how and why it differs
  brushes/<pack>/        each pack's imported assets; not in git, each machine imports its own
```

Read `<name>.md` before painting for its brush judgment. Some speak the recipe path's terms (`paint.ts` groups,
glazes by `opacity`, `reserve`) or call wet mixing missing: for water, mixing and glazes in a document,
`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-model.md` is the rule. Prefer brushes graded `close` (reads as its
preview at a glance); read the `fidelity.ts` note before leaning on a `rough` one's look (plainly different in some
way); avoid `off` ones (shape, density or texture wrong).

`studio brushes describe --style <name>` prints each brush as numbers to plan by: how much of its size, opacity and
flow it keeps at pressure 0.3, 0.6 and 1; its visible width over its diameter; the smallest diameter its profile holds
(plan nothing finer); and whether it catches the paper's peaks. The packs are private, so these numbers live only on
this machine.

## Using one

A project names the styles it paints with: `export default { capability: 'silent', styles: ['watercolor'] }` in its
`project.ts`. A painting document then names brushes as `{style: '<name>', brush: '<its name in style.ts>'}` and papers
as `{style, pack, file}`. check:arch refuses an import of a style the project doesn't name. Before each bundle every
named style is checked, and a pack not imported, a file gone or a brush its pack lacks stops it, naming the pack's
`source`: import the pack again from your copy.

## Making one

1. Import the pack: `studio brushes import <archive> --style <name> --pack <pack>`, from a Procreate `.brushset` (or
   the zip it came in) or a Photoshop `.abr` or `.tpl` (or a zip holding them). It measures each brush's profile on
   the GPU, a few seconds a brush, and prints what of each brush's settings didn't carry over. Skip a pack whose
   licence limits its brushes to one app. A Photoshop Mixer Brush's wet mixing doesn't carry over.
2. Write `style.ts`, copying colours and a paper from the import's `manifest.json`:

   ```ts
   import type { StampPaintStyle } from '#lib/paint/style/models/style.ts';

   export default {
     packs: { vvds: { source: 'VVDS Realistic Watercolor Studio, bought on Creative Market (E13434.zip)', media: 'wet' } },
     brushes: { wash: { pack: 'vvds', brush: 'Wet Wash' }, blotch: { pack: 'vvds', brush: 'Blotch 03' } },
     palette: { sky: '#8fb3d9', earth: '#7a5c3e' },
     paper: { color: '#f4efe4' },
   } satisfies StampPaintStyle;
   ```

   A pack's `source` says where it was bought, which is what a missing-pack error shows. Its `media` (`wet` or `dry`;
   Photoshop's brushes don't say) is what a fill defaults to: a wet brush floods, a dry one strokes. A brush whose
   media differs from its pack's says its own.
3. Write `<name>.md`: which brushes do what, and how the pack's author paints with them.
4. Paint a test still with each brush you'll lean on (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/first-painting.md`), and judge it against the pack's
   previews (Procreate: `brushes/<pack>/generations/<the id in current>/previews/`) or Photoshop's own renders
   (`brushes/<pack>/reference/`).

Done when a document naming the style passes `studio paint check` and its still reads like the pack.

`studio workspace init` ignores `styles/*/brushes`, and check:arch refuses a tracked file under a style's `brushes/`:
the pack's files stay out of git.
