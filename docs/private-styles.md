# Private painting styles

A stamp-paint style is one folder, `work/styles/<name>/`, the only place it lives. Its brushes come from a pack
someone bought, and the licence covers their copy, so a style stays in your workspace, never the studio. Any project
in `work/projects/` can paint with it, and a project can use several.

```
work/styles/<name>/
  style.ts     the style: `export default { … } satisfies StampPaintStyle` (lib/picture/stamp-paint/models/style.ts)
  <name>.md    how to paint in this style; guidance about the pack's brushes stays here, private
  brushes/     each pack's imported assets, in brushes/<pack>/ (studio brushes import). Not in git: each machine imports its own copy
```

`style.ts` names each pack its brushes come from, by its folder in `brushes/`, with a `source` that says where the pack
was bought; the brushes it paints with, by its own names for them, each a brush in a pack; its palette; and its paper:

```ts
import type { StampPaintStyle } from '#lib/picture/stamp-paint/models/style.ts';

export default {
  packs: { vvds: { source: 'VVDS Realistic Watercolor Studio, bought on Creative Market (E13434.zip)' } },
  brushes: { wash: { pack: 'vvds', brush: 'Wet Wash' }, blotch: { pack: 'vvds', brush: 'Blotch 03' } },
  palette: { sky: '#8fb3d9', earth: '#7a5c3e' },
  paper: { color: '#f4efe4' },
} satisfies StampPaintStyle;
```

**Using one.** A project names the styles it paints with in its `project.ts`, then imports them as `#styles/<name>/…`:

```ts
export default { capability: 'silent', styles: ['wash'] } satisfies ProjectDeclaration;
```

```tsx
import wash from '#styles/wash/style.ts';
```

check:arch refuses an import of a style the project doesn't name, and public code importing any style. A style may
import the studio's `models` and `studio` code, never a project or `engine` code.

**Importing a pack.** `studio brushes import <archive> --style <name> --pack <pack>` turns a Procreate pack (a
`.brushset`, or the zip it came in) into `brushes/<pack>/`, replacing what's there:

```
brushes/<pack>/
  tips/        each brush's tip, dark is paint, downsized; <brush>.dual.png for a dual brush's second tip
  grains/      each brush's grain, likewise
  previews/    each brush's own Procreate preview, to judge a render against
  papers/      each .procreate canvas in the zip, as Procreate shows it, and its tooth as <paper>.grain.png
  manifest.json
```

The manifest holds the asset version, the files, and each brush normalized into the studio's brush definition
(`StampBrush`, lib/picture/stamp-paint/models/stamp-brush.ts), keyed by its name in the pack. It also records the
archive's hash, the previews, the zip's `.swatches` palettes, the papers (each with its mean colour), and per brush
every setting that was approximated or dropped (`support`); the import prints a line per brush of those. Copy colours
into `palette` and a paper into `paper` (`image` for its photograph, `grain` for its tooth) in style.ts.

**Missing brushes.** Before each bundle, every style the project names is checked. It stops the bundle, listing each
problem with the pack's `source` (which says where to get it), when a pack isn't imported, a file its manifest lists is
gone, `brushes` names a brush its pack lacks, the paper names a file its pack lacks, or a manifest is from an older
asset version. Import the pack again from your copy.

**Keeping packs out of git.** `studio workspace init` ignores `styles/*/brushes/`. check:arch refuses a tracked file
under a style's `brushes/` in the workspace, and a tracked brush archive (`.brushset`, `.abr`) anywhere in the studio,
except a test fixture you made yourself and listed in `lint/structural/checks/brush-assets.ts`.
