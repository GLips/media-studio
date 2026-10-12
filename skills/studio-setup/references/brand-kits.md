# Brand kits

One folder per client, `work/brands/<name>/`, the only place its brand lives; its stills and videos share it.

```
work/brands/<name>/
  brand.ts          colours, fonts, logos, voice: `export default { … } satisfies Brand`
  logo-light.svg    the logo in white (or its light version), for dark grounds
  logo-dark.svg     the logo in its own colour, for light grounds
  fonts/            the font files brand.ts names, outside git: each machine adds its own, since most are licensed
```

## Using one

A project names its kit in its own `brand.ts`, and may change the kit's colours, palette or voice there. Fonts and
logos come with files, so a project that needs others names another kit:

```ts
import type { ProjectBrand } from '#lib/picture/brand/models/brand.ts';

export default {
  name: 'acme',
  colors: { accent: '#ff3b3b' },
} satisfies ProjectBrand;
```

tsc checks it against the kit, and the bundle refuses a field or colour role that doesn't exist. Edits to it or to the
kit show in an open preview; naming another kit needs the preview restarted. Scenes and stills import it:

```tsx
import brand from '@brand';
import { BrandLogo, FitText } from '#studio';

<div style={{ background: brand.colors.primary }}>
  <BrandLogo brand={brand} ground={brand.colors.primary} box={logoBox} />
  <FitText face={brand.fonts.display} style={{ color: brand.colors.light, fontWeight: 800 }} … />
</div>
```

Design with the colour roles (`primary`, `secondary`, `accent`, `dark`, `light`) and reach for `palette` last: a
design built on roles works in any kit. `brand.fonts.text.family` goes in a `fontFamily`. `BrandLogo` picks whichever
logo stands off the ground more.

A missing font or logo file stops the bundle with a list of each one and its face's `source`, which says where to get
it.

## Making one from a client's product repo

Read the repo's tokens once and write them in: its colour scale (a Tailwind config, `:root` custom properties, a
Shopify theme's settings), its font stack and weights, and its logo (often an inline SVG snippet). Save the logo in
both versions as SVGs with a `viewBox`, so it scales. Set `snapshot.from` to the files you read and `on` to today's
date. The kit is a copy, never linked to the repo: when it goes stale, read the repo again.

Set `stretch` on a face only when the font has a width axis: `FitText` narrows within that range, and a face without
one just shrinks.

Write the voice as two or three plain sentences for whoever writes the brand's copy: who it talks to, how it sounds,
and what its images show. Nothing checks it.
