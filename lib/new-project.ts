// new-project.ts: starts a video project that opens in the Studio on its first run. `studio new` runs it.
//
// Writes projects/<yyyy-mm>-<slug>/ with a capture script for the URL's home page, a two-line script, and a video
// built from the kit (a motion title and a glass-card outro). The command then captures the page and estimates the
// lines' timing, so video.tsx compiles before anything is voiced. Replace the middle with the story.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_PROJECTS_DIR } from './studio-project.ts';

/** Writes a new project's starting files and returns its directory. Fails if the project already exists. */
export function scaffoldStudioProject({ slug, url, title }: { slug: string; url: string; title?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`the slug must be lowercase words joined by dashes, not ${slug}`);
  const name = title || slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
  const month = new Date().toISOString().slice(0, 7);
  const dir = join(STUDIO_PROJECTS_DIR, `${month}-${slug}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(starterFiles(slug, url, name))) writeFileSync(join(dir, file), content);
  return dir;
}

function starterFiles(slug: string, url: string, title: string): Record<string, string> {
  return {
    'capture.ts': `// Defines every shot the ${title} video shows. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   studio capture ${slug} [--only=home,…]   films them (it imports the default export)
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

shots.still('home', { setup: (page) => open(page, ${JSON.stringify(url)}), height: 1600 });

// Each state the story needs, as a still (setup reaches it; rects are what scenes point at), e.g.
//   shots.still('detail', { setup: …, rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });
// or, where a cut would jump, a take that films the move, e.g.
//   shots.take('open-menu', { setup: …, perform: (rec) => rec.click('.menu', { mark: 'open', rects: { menu: '.menu' } }) });

export default shots;
`,

    'voiceover.json': `${JSON.stringify({
      voice: 'Callirrhoe',
      lines: [
        { id: 'intro', text: `Here's a quick look at ${title}.` },
        { id: 'outro', text: 'That’s it. Thanks for watching.', paragraph: true },
      ],
    }, null, 2)}\n`,

    'video.tsx': `// The ${title} video. Scene times are seconds from each scene's start; \`s.line(id).at(f)\` is the moment a fraction
// \`f\` of the way through a voiced line, so beats stay on their words when the voice is re-timed.

import {
  Capture, EndCard, GlassCard, MotionTitle, Wash, W, camTop, defineScene, defineVideo, easeOut, seg, view,
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
        <GlassCard k={seg(s.t, 0.4, 1.3, easeOut) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} eyebrow="IN SHORT"
          points={['The first takeaway', 'The second takeaway']} accent={ACCENT} ink={INK} />
        <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title={${JSON.stringify(title)}} bg={INK} />
      </>
    );
  },
});

export default defineVideo({ title: ${JSON.stringify(title)}, voice, scenes: [title, outro] });
`,
  };
}
