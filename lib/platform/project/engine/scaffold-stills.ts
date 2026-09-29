// scaffold-stills.ts: a still-only project's starting stills.tsx (and brand.ts, given a kit), for new-project.ts.
//
// Its one design (skills/stills) splits the frame into a ground for a fitted headline and a full-bleed field holding
// the URL's page on a tilted card, in a brand kit's colours and display face when given one. Without a URL the field
// waits for a capture or a generated image. defineStills registers the design, its presets and its variants, and each
// still is named by those three, which is what `studio still` writes and `studio review` notes.

export function stillsStarterFiles(slug: string, url: string | undefined, title: string, brand: string | undefined): Record<string, string> {
  const hero = url
    ? `// The captured page is the hero. FOCUS is what every crop keeps whole, in the capture's page px: tighten it to the
// part the still is about (a rect from capture.ts's rects, or union() of several).
const HERO = C.home;
const FOCUS = { x: 0, y: 0, w: HERO.w, h: Math.min(HERO.h, 0.6 * HERO.w) };
`
    : '';
  const colours = brand
    ? `// The kit's roles (work/brands/${brand}/brand.ts): its primary as the ground, its accent as the field.
const GROUND = brand.colors.primary;
const FIELD = brand.colors.accent;
const PAPER = brand.colors.light;
const FACE = brand.fonts.display;`
    : `// The reel's palette: near-black ground, a full-bleed orange field, cream type. A brand kit replaces these
// (\`studio new --stills --brand <name>\`, or a brand.ts and \`import brand from '@brand'\`).
const GROUND = '#111114';
const FIELD = '#E8502A';
const PAPER = '#F4EFE6';
const FACE = ARCHIVO_FACE;`;
  const imports = ['FitText', 'StillHud', 'defineStills', 'stillDesign', 'useStillFrame', ...(url ? ['StillCard'] : []), ...(brand ? [] : ['ARCHIVO_FACE'])].sort((a, b) => a.localeCompare(b));
  return {
    ...(brand && { 'brand.ts': `// The kit this project uses. Add colors, palette or voice here to change them for this project alone.
import type { ProjectBrand } from '#lib/picture/brand/models/brand.ts';

export default { name: '${brand}' } satisfies ProjectBrand;
` }),
    'stills.tsx': `// The ${title} stills: one design at each preset, a variant per headline. The frame splits into a ground holding the
// headline, set as big as it fits, and a full-bleed field holding the hero: beside it on a wide frame (OG, YouTube),
// above it on a tall one. skills/stills says how to make it good, not just fill it in.
//   studio still ${slug} [--preset=og,youtube] [--sheet] [--check]
${brand ? "\nimport brand from '@brand';" : ''}
import { ${imports.join(', ')} } from '#studio';
${url ? "import { captures as C } from './captures/index.ts';\n" : ''}
${colours}
${hero}
type CardProps = { headline: string };

function Card({ headline }: CardProps) {
  const { w, h, u, wide, safe } = useStillFrame();
  const m = 5 * u;
  // Wide: the ground takes the left 46%, the field the rest. Tall: the copy takes the bottom of the safe area (inside a
  // story's bars), two lines' worth, and the field everything above it.
  const field = wide ? { x: 0.46 * w, y: 0, w: 0.54 * w, h } : { x: 0, y: 0, w, h: safe.y + safe.h - 0.42 * w };
  const copy = wide
    ? { x: m, y: m + 4 * u, w: field.x - 1.6 * m, h: h - 2 * m - 4 * u }
    : { x: m, y: field.h + m, w: w - 2 * m, h: safe.y + safe.h - field.h - 2 * m };
${url ? `  const cardTop = Math.max(field.y, safe.y) + 1.2 * m;
  const card = { x: field.x + 1.1 * m, y: cardTop, w: field.w - 2.2 * m, h: field.y + field.h - cardTop - 1.2 * m };
` : ''}  return (
    <div style={{ position: 'absolute', inset: 0, background: GROUND }}>
      <div style={{ position: 'absolute', left: field.x, top: field.y, width: field.w, height: field.h, background: FIELD }} />
${url
    ? '      <StillCard image={HERO} room={card} focus={FOCUS} />\n'
    : "      {/* The hero goes on the field: a capture on a StillCard, or a generated image in a CoverImage (skills/stills). */}\n"}      {/* Tall, the HUD's top is on the field: pick the ink that reads there, and the still check says if it doesn't. */}
      <StillHud ink={wide ? PAPER : { top: '#000000', bottom: PAPER }} left=${JSON.stringify(title.toUpperCase())} />
      <FitText
        name="headline" text={headline} box={copy} max={(wide ? 24 : 30) * u} min={6 * u} align="center"
        face={FACE} style={{ fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.02em', textTransform: 'uppercase', color: PAPER }}
      />
    </div>
  );
}

// Few words: a thumbnail is read at 168 px wide. Each is a variant; \`--sheet\` puts them side by side.
const HEADLINES = {
  short: ${JSON.stringify(title)},
  long: 'Say what it does for whoever sees it',
};

export default defineStills({
  card: stillDesign({
    component: Card,
    presets: ['og', 'youtube'],
    axes: { headline: ['short', 'long'] },
    props: ({ headline }) => ({ headline: HEADLINES[headline] }),
  }),
});
`,
  };
}
