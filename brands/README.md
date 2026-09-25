# Brand kits

One folder per client, `brands/<name>/`, the only place its brand lives. Its stills and videos share it.

```
brands/<name>/
  brand.ts          colours, fonts, logos, voice: `export default { … } satisfies Brand` (lib/brand.ts)
  logo-light.svg    the logo in white (or its light version), for dark grounds
  logo-dark.svg     the logo in its own colour, for light grounds
  fonts/            the font files brand.ts names. Not in git: each machine adds its own
```

**Using one.** A project names its kit in `projects/<p>/brand.json`, `{ "name": "<name>" }`, and imports it:

```tsx
import brand from '@brand';
import { BrandLogo, FitText } from '../../lib/studio/api.ts';

<div style={{ background: brand.colors.primary }}>
  <BrandLogo brand={brand} ground={brand.colors.primary} box={logoBox} />
  <FitText face={brand.fonts.display} style={{ color: brand.colors.light, fontWeight: 800 }} … />
</div>
```

Reach for the colour roles (`primary`, `secondary`, `accent`, `dark`, `light`) before `palette`. A design built on
roles works for any kit. `brand.fonts.text.family` goes in a `fontFamily`. BrandLogo picks whichever logo stands off
the ground more. A project with a kit gets its voice and palette added to every `studio gen image` prompt.
`projects/2026-09-buy-box-stills` is the worked example.

**Missing fonts.** If a kit's font or logo file is missing, the bundle stops and lists each file with the face's
`source`, which says where to get it.

**Making one from a client's product repo.** Read the repo's tokens once and write them in: its colour scale (a
Tailwind config, `:root` custom properties, a Shopify theme's settings), its font stack and weights, and its logo
(often an inline SVG snippet). Put the logo in both versions as SVGs with a `viewBox`, so it scales. Write
`snapshot.from` naming the files you read, and `on` with the date. The kit is a copy and is never linked to the repo.
When it goes stale, read the repo again.

Set `stretch` on a face only if the font has a width axis. FitText narrows only within that range, and a face without
one just shrinks.

Write the voice as two or three plain sentences: who the brand talks to, how it sounds, and what its images show. It
isn't enforced.
