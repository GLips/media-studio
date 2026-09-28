# Brand kits

One folder per client, `work/brands/<name>/`, the only place its brand lives. Its stills and videos share it.

```
work/brands/<name>/
  brand.ts          colours, fonts, logos, voice: `export default { … } satisfies Brand` (lib/models/brand/brand.ts)
  logo-light.svg    the logo in white (or its light version), for dark grounds
  logo-dark.svg     the logo in its own colour, for light grounds
  fonts/            the font files brand.ts names. Not in git: each machine adds its own
```

**Using one.** A project names its kit in `work/projects/<p>/brand.ts`, and can change the kit's colours, palette or
voice for itself there. Fonts and logos come with files, so a project that needs others names another kit:

```ts
import type { ProjectBrand } from '#models/brand/brand.ts';

export default {
  name: 'acme',
  colors: { accent: '#ff3b3b' },
} satisfies ProjectBrand;
```

`tsc` checks it against the kit's type, and the bundle refuses a field or colour role that doesn't exist. Edits to it or
to the kit show in an open Studio; naming another kit needs the Studio restarted. Then import it:

```tsx
import brand from '@brand';
import { BrandLogo, FitText } from '#studio';

<div style={{ background: brand.colors.primary }}>
  <BrandLogo brand={brand} ground={brand.colors.primary} box={logoBox} />
  <FitText face={brand.fonts.display} style={{ color: brand.colors.light, fontWeight: 800 }} … />
</div>
```

Reach for the colour roles (`primary`, `secondary`, `accent`, `dark`, `light`) before `palette`. A design built on
roles works for any kit. `brand.fonts.text.family` goes in a `fontFamily`. BrandLogo picks whichever logo stands off
the ground more.

**Missing fonts.** If a kit's font or logo file is missing, the bundle stops and lists each file with the face's
`source`, which says where to get it.

**Making one from a client's product repo.** Read the repo's tokens once and write them in: its colour scale (a
Tailwind config, `:root` custom properties, a Shopify theme's settings), its font stack and weights, and its logo
(often an inline SVG snippet). Put the logo in both versions as SVGs with a `viewBox`, so it scales. Write
`snapshot.from` naming the files you read, and `on` with the date. The kit is a copy and is never linked to the repo.
When it goes stale, read the repo again.

Set `stretch` on a face only if the font has a width axis. FitText narrows only within that range, and a face without
one just shrinks.

Write the voice as two or three plain sentences for whoever writes the brand's copy: who it talks to, how it sounds,
and what its images show. It isn't enforced.
