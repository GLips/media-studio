// new-project.ts: starts a project that passes check:arch, typecheck and its tests from its first commit, of any
// capability. `studio new` runs it; new-project.test.ts proves each kind.
//
// Writes work/projects/<yyyy-mm>-<slug>/ with a project.ts declaring the capability and a capture script, which films
// the URL as `home` if given one and otherwise starts empty, for a site that needs a sign-in or a server first. A timed
// project gets timeline.ts, its retime test and a scene file per scene, blocked in flat pieces on its cues. A
// still-only one gets a stills.tsx registering one design.
//
// Negative space: it writes no render snapshot and no timing report; a project's first `studio render --animatic`
// writes the snapshot `studio review` reads.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT_CAPABILITIES, type ProjectCapability } from '../models/capability.ts';
import { stillsStarterFiles } from './scaffold-stills.ts';
import { timedStarterFiles } from './scaffold-timed.ts';
import { STUDIO_BRANDS_DIR, STUDIO_PROJECTS_DIR } from './studio-project.ts';
import { assertStudioWorkspace } from './studio-workspace.ts';

export type NewStudioProject = { slug: string; capability: ProjectCapability; url?: string; title?: string; brand?: string };

/** Writes a new project's starting files and returns its directory. Fails if the project already exists or the kit doesn't. */
export function scaffoldStudioProject({ slug, capability, url, title, brand }: NewStudioProject): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`the slug must be lowercase words joined by dashes, not ${slug}`);
  if (!PROJECT_CAPABILITIES.includes(capability)) throw new Error(`the capability is one of ${PROJECT_CAPABILITIES.join(', ')}, not ${capability}`);
  if (brand && capability !== 'still-only') throw new Error('--brand is for a still-only project; a video names its kit in its own brand.ts');
  assertStudioWorkspace();
  if (brand && !existsSync(join(STUDIO_BRANDS_DIR, brand, 'brand.ts'))) {
    const kits = existsSync(STUDIO_BRANDS_DIR) ? readdirSync(STUDIO_BRANDS_DIR).filter((d) => existsSync(join(STUDIO_BRANDS_DIR, d, 'brand.ts'))) : [];
    throw new Error(`there's no work/brands/${brand}/brand.ts (${kits.length ? `the kits are ${kits.join(', ')}` : 'there are no kits yet'}; docs/brand-kits.md says how to make one)`);
  }
  const name = title || slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
  const month = new Date().toISOString().slice(0, 7);
  const dir = join(STUDIO_PROJECTS_DIR, `${month}-${slug}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  const stills = capability === 'still-only';
  const files: Record<string, string> = {
    'project.ts': projectDeclaration(name, capability),
    'capture.ts': captureScript(slug, url, name, stills),
    ...(stills ? stillsStarterFiles(slug, url, name, brand) : timedStarterFiles(slug, name, capability)),
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

const CAPABILITY_NOTES: Record<ProjectCapability, string> = {
  'music-led': 'its bars cut to the music',
  'voice-led': 'its scenes laid on the voiced lines',
  'still-only': 'stills alone, no video',
  mixed: 'voiced scenes around a section cut to the music',
  silent: 'scenes of fixed length, with no voice, music or sound',
};

function projectDeclaration(title: string, capability: ProjectCapability) {
  return `// What ${title} is: ${CAPABILITY_NOTES[capability]}. check:arch holds this to what the project binds (its timeline's
// grid and voice, its stills), so a project that takes on a part it didn't declare changes this line on purpose.
import type { ProjectDeclaration } from '#lib/platform/project/models/capability.ts';

export default { capability: '${capability}' } satisfies ProjectDeclaration;
`;
}

function captureScript(slug: string, url: string | undefined, title: string, stills: boolean) {
  const firstShot = url
    ? `shots.still('home', { setup: (page) => open(page, ${JSON.stringify(url)}), height: ${stills ? 1200 : 1600} });\n\n`
    : `// \`studio probe ${slug} <url>\` shows a page as these shots see it, with its selectors.\n`;
  // Only a first shot calls it: an unused helper would fail lint from the project's first commit.
  const openHelper = url
    ? `const open = async (page: Page, url: string) => {\n  await page.goto(url, { waitUntil: 'load' });\n  await page.waitForTimeout(2500);\n};\n\n`
    : '';
  // A still crops into a page and fills a story's 1080 px with a few hundred page px, so stills film at 3×.
  return `// Defines every shot the ${title} ${stills ? 'stills show' : 'video shows'}. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   studio capture ${slug} [--only=home,…]   films them (it imports the default export)
import { captureShots${url ? ', type Page' : ''} } from '#lib/footage/capture/engine/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }${stills ? ', scale: 3' : ''} });
${openHelper}${firstShot}${stills
    ? `// Each state a still shows, as a still with the rects a design crops to, e.g.
//   shots.still('product', { setup: …, rects: { photo: '.product img', price: '.price' }, height: 1200 });`
    : `// Each state the story needs is a still: setup reaches it, and scenes point at its rects.
//   shots.still('detail', { setup: …, rects: { button: '.buy' } });
// Where a cut would jump, a take films the move.
//   shots.take('open-menu', { setup: …, perform: (rec) => rec.click('.menu', { mark: 'open' }) });`}

export default shots;
`;
}
