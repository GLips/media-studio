# Private painting styles

A stamp-paint style is one folder, `work/styles/<name>/`, the only place it lives. Its brushes come from a pack
someone bought, and the licence covers their copy, so a style stays in your workspace, never the studio. Any project
in `work/projects/` can paint with it, and a project can use several.

```
work/styles/<name>/
  style.ts     the style: `export default { … } satisfies StampPaintStyle` (lib/picture/stamp-paint/models/style.ts)
  <name>.md    how to paint in this style; guidance about the pack's brushes stays here, private
  brushes/     each pack's imported assets, in brushes/<pack>/. Not in git: each machine imports its own copy
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

**Missing brushes.** An import writes `brushes/<pack>/manifest.json`: the asset version, the files it wrote, and each
brush normalized into the studio's brush definition (`StampBrush`, lib/picture/stamp-paint/models/stamp-brush.ts).
(The importer, `studio brushes import`, isn't built yet.)
Before each bundle, every style the project names is checked: a pack that isn't imported, a file its manifest lists
that's gone, a brush `brushes` names that its pack lacks, or a manifest from an older asset version stops the bundle,
listing each with the pack's `source`, which says where to get it. Import the pack again from your copy.

**Keeping packs out of git.** `studio workspace init` ignores `styles/*/brushes/`. check:arch refuses a tracked file
under a style's `brushes/` in the workspace, and a tracked brush archive (`.brushset`, `.abr`) anywhere in the studio,
except a test fixture you made yourself and listed in `lint/structural/checks/brush-assets.ts`.
