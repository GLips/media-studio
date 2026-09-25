// new-project.ts: starts a video project that opens in the Studio on its first run, or a stills project (`--stills`).
// `studio new` runs it.
//
// Writes projects/<yyyy-mm>-<slug>/ with a capture script, a two-line script, and a video built from the kit. Given a
// URL, the capture script films it as `home` and the video titles over it (a motion title, a glass-card outro), and
// the command captures it. Without one, the capture script has no shots and the video uses no capture, for a site
// that needs a sign-in or a server written first. Either way the command estimates the lines' timing, so video.tsx
// compiles before anything is voiced. Replace the middle with the story.
//
// A stills project gets a capture script and a stills.tsx whose one design (skills/stills) splits the frame into a
// ground for a fitted headline and a full-bleed field holding the URL's page on a tilted card, in a brand kit's colours
// and display face when given one. Without a URL the field waits for a capture or a generated image.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_PROJECTS_DIR, STUDIO_ROOT } from './studio-project.ts';

/**
 * Writes a new project's starting files and returns its directory. `stills` makes a stills project, in the kit
 * `brands/<brand>/` if given. Fails if the project already exists or the kit doesn't.
 */
export function scaffoldStudioProject({ slug, url, title, stills, brand }: { slug: string; url?: string; title?: string; stills?: boolean; brand?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`the slug must be lowercase words joined by dashes, not ${slug}`);
  if (brand && !stills) throw new Error('--brand is for a stills project (--stills); a video names its kit in its own brand.ts');
  if (brand && !existsSync(join(STUDIO_ROOT, 'brands', brand, 'brand.ts'))) {
    const kits = readdirSync(join(STUDIO_ROOT, 'brands')).filter((d) => existsSync(join(STUDIO_ROOT, 'brands', d, 'brand.ts')));
    throw new Error(`there's no brands/${brand}/brand.ts (brands/ has ${kits.join(', ') || 'none'}; brands/CLAUDE.md says how to make one)`);
  }
  const name = title || slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
  const month = new Date().toISOString().slice(0, 7);
  const dir = join(STUDIO_PROJECTS_DIR, `${month}-${slug}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  const files = stills ? stillsStarterFiles(slug, url, name, brand) : starterFiles(slug, url, name);
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
  return dir;
}

function captureScript(slug: string, url: string | undefined, title: string, stills: boolean) {
  const firstShot = url
    ? `shots.still('home', { setup: (page) => open(page, ${JSON.stringify(url)}), height: ${stills ? 1200 : 1600} });\n\n`
    : `// \`studio probe ${slug} <url>\` shows a page as these shots will see it, with selectors for its elements.\n`;
  // A still crops into a page and fills a story's 1080 px with a few hundred page px, so stills film at 3×.
  return `// Defines every shot the ${title} ${stills ? 'stills show' : 'video shows'}. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   studio capture ${slug} [--only=home,…]   films them (it imports the default export)
import { captureShots, type Page } from '#engine/capture/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }${stills ? ', scale: 3' : ''} });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

${firstShot}${stills
    ? `// Each state a still shows, as a still with the rects a design crops to, e.g.
//   shots.still('product', { setup: …, rects: { photo: '.product img', price: '.price' }, height: 1200 });`
    : `// Each state the story needs, as a still (setup reaches it; rects are what scenes point at), e.g.
//   shots.still('detail', { setup: …, rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });
// or, where a cut would jump, a take that films the move, e.g.
//   shots.take('open-menu', { setup: …, perform: (rec) => rec.click('.menu', { mark: 'open', rects: { menu: '.menu' } }) });`}

export default shots;
`;
}

function starterFiles(slug: string, url: string | undefined, title: string): Record<string, string> {
  return {
    'capture.ts': captureScript(slug, url, title, false),

    'voiceover.json': `${JSON.stringify({
      voice: 'Callirrhoe',
      lines: [
        { id: 'intro', text: `Here's a quick look at ${title}.` },
        { id: 'outro', text: 'That’s it. Thanks for watching.', paragraph: true },
      ],
    }, null, 2)}\n`,

    'video.tsx': url ? capturedVideo(title) : uncapturedVideo(title),
  };
}

function capturedVideo(title: string) {
  return `// The ${title} video. Scene times are seconds from each scene's start; \`s.line(id).at(f)\` is the moment a fraction
// \`f\` of the way through a voiced line, so beats stay on their words when the voice is re-timed.

import {
  Capture, EndCard, GlassCard, MotionTitle, Wash, W, camTop, defineScene, defineVideo, motionCurves, seg, view,
} from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';

const INK = '#1c365e';
const ACCENT = '#b82b2b';

const title = defineScene({
  id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0,
  render: (s) => <MotionTitle s={s} shot={C.home} eyebrow="WALKTHROUGH" title={${JSON.stringify(title)}} accent={ACCENT} />,
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4,
  render: (s) => {
    const blur = seg(s.t, 0, 1.0);
    return (
      <>
        <Capture view={view(C.home, camTop(C.home))} blur={34 * blur} />
        <Wash color="22, 40, 70" from={0.62 * blur} to={0.38 * blur} x0={0} x1={W} />
        <GlassCard k={seg(s.t, 0.4, 1.3, motionCurves.linear) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} eyebrow="IN SHORT"
          points={['The first takeaway', 'The second takeaway']} accent={ACCENT} ink={INK} />
        <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title={${JSON.stringify(title)}} bg={INK} />
      </>
    );
  },
});

export default defineVideo({ title: ${JSON.stringify(title)}, voice, scenes: [title, outro] });
`;
}

// Cards on a solid ground until there are captures: swap in MotionTitle and a Capture behind the outro once
// capture.ts films the site.
function uncapturedVideo(title: string) {
  return `// The ${title} video. Scene times are seconds from each scene's start; \`s.line(id).at(f)\` is the moment a fraction
// \`f\` of the way through a voiced line, so beats stay on their words when the voice is re-timed.
// Nothing here uses a capture yet: once capture.ts films the site, import { captures as C } from './captures/index.ts'.

import { EndCard, GlassCard, H, Text, W, defineScene, defineVideo, motionCurves, seg } from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';

const INK = '#1c365e';
const ACCENT = '#b82b2b';
const Ground = () => <div style={{ position: 'absolute', inset: 0, background: INK }} />;

const title = defineScene({
  id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0,
  render: (s) => (
    <>
      <Ground />
      <Text text="WALKTHROUGH" x={W / 2} y={H / 2 - 80} size={28} color="rgba(255, 255, 255, 0.72)" align="center" k={seg(s.t, 0.2, 0.9, motionCurves.linear)} />
      <Text text={${JSON.stringify(title)}} x={W / 2} y={H / 2 + 20} size={96} align="center" k={seg(s.t, 0.4, 1.2, motionCurves.linear)} />
    </>
  ),
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4,
  render: (s) => (
    <>
      <Ground />
      <GlassCard k={seg(s.t, 0.4, 1.3, motionCurves.linear) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} eyebrow="IN SHORT"
        points={['The first takeaway', 'The second takeaway']} accent={ACCENT} ink={INK} />
      <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title={${JSON.stringify(title)}} bg={INK} />
    </>
  ),
});

export default defineVideo({ title: ${JSON.stringify(title)}, voice, scenes: [title, outro] });
`;
}

function stillsStarterFiles(slug: string, url: string | undefined, title: string, brand: string | undefined): Record<string, string> {
  const hero = url
    ? `// The captured page is the hero. FOCUS is what every crop keeps whole, in the capture's page px: tighten it to the
// part the still is about (a rect from capture.ts's rects, or union() of several).
const HERO = C.home;
const FOCUS = { x: 0, y: 0, w: HERO.w, h: Math.min(HERO.h, 0.6 * HERO.w) };
`
    : '';
  const colours = brand
    ? `// The kit's roles (brands/${brand}/brand.ts): its primary as the ground, its accent as the field.
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
    'capture.ts': captureScript(slug, url, title, true),
    ...(brand && { 'brand.ts': `// The kit this project uses. Add colors, palette or voice here to change them for this project alone.
import type { ProjectBrand } from '../../lib/models/brand/brand.ts';

export default { name: '${brand}' } satisfies ProjectBrand;
` }),
    'stills.tsx': `// The ${title} stills: one design at each preset, a variant per headline. The frame splits into a ground holding the
// headline, set as big as it fits, and a full-bleed field holding the hero: beside it on a wide frame (OG, YouTube),
// above it on a tall one. skills/stills says how to make it good, not just fill it in.
//   studio still ${slug} [--preset=og,youtube] [--sheet] [--check]
${brand ? "\nimport brand from '@brand';" : ''}
import { ${imports.join(', ')} } from '../../lib/studio/api.ts';
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
